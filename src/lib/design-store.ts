/* The Design pane's state per project: the design list, the open design, how each
   frame rendered, the user's undo stack, and the review loop — every design turn end
   becomes a version, goes through the gate and the critique, and the store sends the
   next step. Mirrors notes-store: module Maps, one subscribe, no React. */
import {
  designsList, designRead, designFrameBase, designVersions, designCanvasSave, designRename, designSetKind,
  designTrash, designUntrash, designsOrderSave, designCreate, designSnapshot, onDesignsChanged,
  designRestore, designBranch, designRootPath, designContextFiles, designReviewVersion, designLintRead,
  designReviewSettings, designReviewSettingsSet, designReviewState, designReviewStateSet, designQuestionsAnswer,
  designCritiqueRead, designFileRead, designVersionMark, type VersionMeta,
} from "./ipc";
import { parseDesign, type CanvasFile, type Design, type DesignKind, type DesignRow } from "./design-model";
import {
  laneKey, agentSessionFor, subscribeAgent, sendAgentMessage, startAgentSession, resumeAgentSession, cancelAgentTurn,
  type AgentEntry,
} from "./agent-session";
import {
  DEFAULT_SETTINGS, initialReviewState, parseCritique, parseLint, parseQuestions, parseReviewState, parseSettings,
  parseTokens, questionsPending, type CritiqueRound, type Finding, type LintReport, type PromptKind, type Questions,
  type ReviewSettings, type ReviewState, type TokensPlan,
} from "./design-review-model";
import { afterTurn, MAX_LINT_PASSES, onAccept, onSend, onStop, resumeAfterRestart } from "./design-loop";
import {
  answersMessage, continuePrompt, critiqueFixPrompt, critiquePrompt, fixAllMinorPrompt, fixFindingPrompt,
  lintFixPrompt, resolveBlockerPrompt, skipMessage,
} from "./design-prompts";
import { toastError } from "@/overlays/toasts";
import { every } from "@/lib/scheduler";

export type FrameState = { kind: "placeholder" } | { kind: "rendering" } | { kind: "rendered"; height: number } | { kind: "failed"; message: string; line: number };
export type UndoEntry = { label: string; undo: () => Promise<void>; redo: () => Promise<void> };
export interface DesignProject {
  rows: DesignRow[]; order: Record<string, string[]>; active: string | null; design: Design | null; canvas: CanvasFile;
  bad: boolean; frameStates: Record<string, FrameState>; base: string | null; versions: VersionMeta[]; reloadTick: number;
  /** the designs folder as an absolute, canonical path — the message prefix names it */
  rootPath: string | null;
  undo: UndoEntry[]; redo: UndoEntry[]; seenTurnEnds: number;
  /** the version History has selected to compare against the newest, or null
   *  when the History panel isn't comparing anything — DesignCanvas splits
   *  into two halves while this is set (Task 19) */
  compare: number | null;
  /** the slug a `sendDesignMessage` turn was sent for — the turn-end snapshot
   *  targets this, not whatever the user has since clicked over to */
  turnSlug: string | null;
  /** bumped on every non-reload `openDesign`; a slower, older call that lands
   *  after a newer one started is dropped instead of clobbering it */
  openToken: number;
  /** the open design's review loop (`.review/state.json`), persisted on every step */
  review: ReviewState;
  /** the effective review settings for the open design (project, then its override) */
  settings: ReviewSettings;
  /** the open design's own override, null when it follows the project */
  settingsScope: { project: Partial<ReviewSettings> | null; design: Partial<ReviewSettings> | null };
  /** the director's files: its questions form and its token plan */
  questions: Questions | null;
  tokens: TokensPlan | null;
  /** every critique round so far, round 1 first */
  critiques: CritiqueRound[];
  /** the gate's report on the newest version */
  lint: LintReport | null;
  /** the scorecard is open in the right column */
  scoreOpen: boolean;
  /** the finding the canvas outlines, picked from the scorecard */
  pin: { frame: string; selector: string; text: string } | null;
  /** the "getting the review tools ready" card shows (Task 15 decides when) */
  toolsCard: boolean;
  /** a critique turn ended without its round file */
  critiqueMissing: boolean;
  /** the project's context files the prefix names (PRODUCT.md, DESIGN.md); null until the first send */
  context: string[] | null;
}

/** The review fields a freshly opened design starts from, before its files are read. */
const blankReview = () => ({
  review: initialReviewState(), settings: DEFAULT_SETTINGS, settingsScope: { project: null, design: null }, questions: null, tokens: null,
  critiques: [] as CritiqueRound[], lint: null, scoreOpen: false, pin: null, critiqueMissing: false,
});

const projects = new Map<string, DesignProject>();
const subs = new Set<() => void>();
let ready = false;
const notify = () => { for (const cb of subs) cb(); };
const emptyCanvas = (): CanvasFile => ({ positions: {}, viewport: null });

export function designProjectFor(dir: string): DesignProject {
  ensure();
  let p = projects.get(dir);
  if (!p) {
    // Seed the counter from the design lane's OWN turnEnds — an already-running
    // session's past turns are not new turns this store needs to version.
    const seenTurnEnds = agentSessionFor(laneKey(dir, "design")).turnEnds;
    p = {
      rows: [], order: {}, active: null, design: null, canvas: emptyCanvas(), bad: false, frameStates: {}, base: null, rootPath: null,
      versions: [], reloadTick: 0, undo: [], redo: [], seenTurnEnds, turnSlug: null, openToken: 0, compare: null,
      ...blankReview(), toolsCard: false, context: null,
    };
    projects.set(dir, p);
  }
  return p;
}

export function subscribeDesigns(cb: () => void): () => void { ensure(); subs.add(cb); return () => subs.delete(cb); }

/** Closing a project forgets its design state (the next open starts fresh). */
export function evictDesignProject(dir: string): void {
  if (projects.delete(dir)) notify();
}

function ensure() {
  if (ready) return;
  ready = true;
  void onDesignsChanged((e) => {
    const p = projects.get(e.dir);
    if (!p) return;
    // The director's own files only feed the thread's cards: reload just those.
    const director = e.paths.filter(isDirectorFile);
    if (director.length > 0 && p.active === e.slug) reloadDirectorFiles(e.dir, e.slug, director).catch(() => {});
    // a pan or zoom rewrites canvas.json (via its .tmp sibling) — nothing the
    // list or the open design shows changed
    const rest = e.paths.filter((x) => !isDirectorFile(x) && x !== "canvas.json" && x !== "canvas.json.tmp");
    if (e.paths.length > 0 && rest.length === 0) return;
    loadDesigns(e.dir).catch(() => {});
    if (p.active === e.slug) openDesign(e.dir, e.slug, true).catch(() => {});
  });
  subscribeAgent(() => {
    for (const [dir, p] of projects) {
      const s = agentSessionFor(laneKey(dir, "design"));
      // An idle-stop or a restart resets the session's own counter (blank());
      // follow it down so the NEXT real turn still reads as new, instead of
      // sitting forever above a seenTurnEnds that can no longer be reached.
      if (s.turnEnds < p.seenTurnEnds) p.seenTurnEnds = s.turnEnds;
      if (s.turnEnds > p.seenTurnEnds) {
        p.seenTurnEnds = s.turnEnds;
        // The turn belongs to whichever design it was sent for; fall back to
        // the open design only when no send recorded one (e.g. a turn kicked
        // off outside sendDesignMessage).
        const slug = p.turnSlug ?? p.active;
        p.turnSlug = null;
        if (slug) snapshotTurn(dir, slug).catch((e) => toastError("The review stopped", String(e).slice(0, 110)));
      }
    }
  });
}

/** `root` is the absolute designs folder: in a linked worktree it isn't under the
 *  session's cwd, so a relative `.chronicle/designs/` would name the wrong folder.
 *  `context` names the project's context files (PRODUCT.md, DESIGN.md) on a second line. */
export function designPrefix(slug: string, root: string, context: string[]): string {
  const line = `[design: ${slug} · ${root.replace(/\/+$/, "")}/${slug}/]`;
  return context.length > 0 ? `${line}\n[context: ${context.join(", ")} — read these first]` : line;
}

export function summaryOf(entries: AgentEntry[]): string {
  const last = [...entries].reverse().find((e) => e.kind === "assistant") as { text?: string } | undefined;
  const text = (last?.text ?? "").trim();
  const m = text.match(/^[\s\S]*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim().slice(0, 200);
}

/* ---------- reading the director's files ---------- */

const isDirectorFile = (rel: string) => rel === "questions.json" || rel === "tokens.json" || rel.startsWith("critique/");
/** the bad JSON already toasted, per file — one toast per change, not one per read */
const badJson = new Map<string, string>();

/** A director-owned JSON file, parsed; absent or unreadable → null, broken JSON → null and one toast. */
async function readDesignJson(dir: string, slug: string, rel: string): Promise<unknown> {
  const raw = await designFileRead(dir, slug, rel).catch(() => null);
  if (raw == null) return null;
  const key = `${dir}\0${slug}\0${rel}`;
  try {
    const v: unknown = JSON.parse(raw);
    badJson.delete(key);
    return v;
  } catch {
    if (badJson.get(key) !== raw) {
      badJson.set(key, raw);
      toastError(`Couldn't read ${rel}`, `${slug}/${rel} isn't valid JSON yet`);
    }
    return null;
  }
}

const readQuestions = async (dir: string, slug: string) => parseQuestions(await readDesignJson(dir, slug, "questions.json"));
const readTokens = async (dir: string, slug: string) => parseTokens(await readDesignJson(dir, slug, "tokens.json"));
const readCritique = (dir: string, slug: string, round: number, bar: number) =>
  designCritiqueRead(dir, slug, round).then((v) => parseCritique(v, bar, round)).catch(() => null);

/** Every round file from 1 to `rounds`; a missing one is skipped. */
async function readCritiques(dir: string, slug: string, rounds: number, bar: number): Promise<CritiqueRound[]> {
  const all = await Promise.all(Array.from({ length: Math.max(0, rounds) }, (_, i) => readCritique(dir, slug, i + 1, bar)));
  return all.filter((c): c is CritiqueRound => c != null);
}

/** The gate's stored report on version `n` (`.review/lint/v<n>.json`). */
const readLint = (dir: string, slug: string, n: number | undefined) =>
  n == null ? Promise.resolve(null) : designLintRead(dir, slug, `v${n}`).then(parseLint).catch(() => null);

/** The watcher saw the director write some of its files: re-read just those. */
async function reloadDirectorFiles(dir: string, slug: string, paths: string[]): Promise<void> {
  const p = designProjectFor(dir);
  const [questions, tokens, critiques] = await Promise.all([
    paths.includes("questions.json") ? readQuestions(dir, slug) : p.questions,
    paths.includes("tokens.json") ? readTokens(dir, slug) : p.tokens,
    paths.some((x) => x.startsWith("critique/")) ? readCritiques(dir, slug, p.review.round, p.settings.bar) : p.critiques,
  ]);
  if (p.active !== slug) return;
  p.questions = questions; p.tokens = tokens; p.critiques = critiques;
  notify();
}

/* ---------- the review state, wherever the design is ---------- */

/** The designs a loop step is running for right now — a reopen never regates under it. */
const inFlight = new Set<string>();
const flightKey = (dir: string, slug: string) => `${dir}\0${slug}`;
/** Every committed step bumps its design's counter. A loop step remembers the count it
 *  started (or decided) on and gives up when it moved: a user's send or a Stop landed
 *  while it was awaiting, and the step it was about to take is no longer the user's. */
const steps = new Map<string, number>();
const stepOf = (k: string) => steps.get(k) ?? 0;

/** The loop's state and settings for `slug`: the open design's from memory, any other's from disk. */
async function reviewOf(dir: string, slug: string): Promise<{ review: ReviewState; settings: ReviewSettings }> {
  const p = designProjectFor(dir);
  if (p.active === slug) return { review: p.review, settings: p.settings };
  const [raw, set] = await Promise.all([
    designReviewState(dir, slug).catch(() => null),
    designReviewSettings(dir, slug).catch(() => null),
  ]);
  return { review: parseReviewState(raw), settings: set ? parseSettings(set.effective) : DEFAULT_SETTINGS };
}

/** Keeps a step: in memory when the design is open, and on disk always (a restart resumes from it). */
async function commitReview(dir: string, slug: string, st: ReviewState): Promise<void> {
  const p = designProjectFor(dir);
  const k = flightKey(dir, slug);
  steps.set(k, stepOf(k) + 1);
  if (p.active === slug) { p.review = st; notify(); }
  await designReviewStateSet(dir, slug, st).catch(() => {});
}

/* ---------- the turn-end path ---------- */

/** The phases a loop is running in; a turn that ends in any other one is only versioned. */
const LOOPING = new Set<ReviewState["phase"]>(["building", "gate", "fixing", "critique"]);
/** the thumbnails each gated version rendered, for the critique prompt's captures */
const thumbsOf = new Map<string, string[]>();
const thumbKey = (dir: string, slug: string, n: number) => `${dir}\0${slug}\0${n}`;

/** Renders version `n`'s thumbnails and lints it. A gate that couldn't run comes back as a
 *  report that says so (`ran: false` + the problem), never as a silent clean pass. */
async function reviewVersion(dir: string, slug: string, n: number): Promise<LintReport | null> {
  try {
    const r = await designReviewVersion(dir, slug, n);
    thumbsOf.set(thumbKey(dir, slug, n), r.thumbs);
    return parseLint(r.lint);
  } catch (e) {
    const problem = e instanceof Error ? e.message : String(e);
    return { v: 1, version: n, at: new Date().toISOString(), ran: false, problem, severe: [], minor: [] };
  }
}

/** A design turn ended: version it, gate it, read what the director wrote, and take the loop's next step. */
async function snapshotTurn(dir: string, slug: string) {
  const s = agentSessionFor(laneKey(dir, "design"));
  // read before any await: the next turn end overwrites it
  const cancelled = s.lastStopReason === "cancelled";
  // stamped before the snapshot's await: a user's send landing during it voids this step
  const startStep = stepOf(flightKey(dir, slug));
  const n = await designSnapshot(dir, slug, s.lastPrompt, summaryOf(s.entries), s.sessionId ?? "").catch(() => null);
  await advance(dir, slug, n, cancelled, false, startStep);
}

/** One loop step after a turn end (`n` = the new version, if any) or a restart's regate. */
async function advance(dir: string, slug: string, n: number | null, cancelled: boolean, regate: boolean, startStep: number): Promise<void> {
  const p = designProjectFor(dir);
  const k = flightKey(dir, slug);
  const held = inFlight.has(k);
  inFlight.add(k);
  try {
    const before = await reviewOf(dir, slug);
    const looping = LOOPING.has(before.review.phase);
    const gateOn = n ?? (regate ? before.review.version : null);
    if (looping && !cancelled && gateOn != null && before.review.phase !== "critique" && p.active === slug && stepOf(k) === startStep) {
      p.review = { ...p.review, phase: "gate" }; notify();
    }
    const lint = gateOn != null ? await reviewVersion(dir, slug, gateOn) : null;
    const questions = await readQuestions(dir, slug);
    const critique = before.review.phase === "critique" && !cancelled
      ? await readCritique(dir, slug, before.review.round, before.settings.bar) : null;

    // decide on the state as it is NOW: a Stop or a user's send that landed while
    // this step was gating has already taken the next step — only the version is kept
    const { review: now, settings } = await reviewOf(dir, slug);
    const moved = stepOf(k) !== startStep;
    let next: ReturnType<typeof afterTurn>["next"] = { kind: "wait" };
    let state: ReviewState;
    if (!moved && LOOPING.has(now.phase)) {
      ({ state, next } = afterTurn(now, settings, {
        version: regate ? now.version : n, questionsPending: questionsPending(questions), lint, critique, cancelled,
      }));
    } else {
      state = { ...now, version: n ?? now.version };
    }
    await commitReview(dir, slug, state);
    const decided = stepOf(k);
    const marked = critique ? critique.version ?? state.version : null;
    if (critique && marked != null) await designVersionMark(dir, slug, marked, critique.weighted, critique.round).catch(() => {});

    if (p.active === slug) {
      p.questions = questions;
      if (lint) p.lint = lint;
      if (critique) p.critiques = [...p.critiques.filter((c) => c.round !== critique.round), critique].sort((a, b) => a.round - b.round);
      if (next.kind === "critiqueMissing") p.critiqueMissing = true;
      p.versions = await designVersions(dir, slug).catch(() => p.versions);
    }
    await loadDesigns(dir).catch(() => {});
    notify();
    if (next.kind === "send") {
      try {
        await sendLoopPrompt(dir, slug, next.prompt, { review: state, settings, lint: lint ?? (p.active === slug ? p.lint : null), critique }, decided);
      } catch (e) {
        // the toast says the review stopped; so does the state — unless a newer step
        // (the user's) committed since, which this failure must not stop
        if (stepOf(k) === decided) await commitReview(dir, slug, onStop((await reviewOf(dir, slug)).review));
        throw e;
      }
    }
  } finally {
    if (!held) inFlight.delete(k);
  }
}

/** What a loop prompt is built from: the state it was decided on and what the turn produced. */
interface LoopCtx { review: ReviewState; settings: ReviewSettings; lint: LintReport | null; critique: CritiqueRound | null }

/** Absolute paths of version `n`'s thumbnails: what the gate rendered, else one per frame of the open design. */
function capturesFor(dir: string, slug: string, n: number | null): string[] {
  const p = designProjectFor(dir);
  if (n == null || !p.rootPath) return [];
  const root = p.rootPath.replace(/\/+$/, "");
  const known = thumbsOf.get(thumbKey(dir, slug, n));
  const rels = known ?? (p.active === slug ? (p.design?.frames ?? []).map((f) => `${slug}/.versions/v${n}/thumbs/${f.id}.png`) : []);
  return rels.map((r) => `${root}/${r}`);
}

/** The blocker to resolve: the last round's own sentence, else a finding the last two rounds share, else its first severe one. */
function blockerOf(critiques: CritiqueRound[]): string | null {
  const last = critiques.at(-1);
  if (!last) return null;
  if (last.blocker) return last.blocker;
  const texts = (c: CritiqueRound | undefined) => (c?.reviewers ?? []).flatMap((r) => r.findings);
  const prev = new Set(texts(critiques.at(-2)).map((f) => f.text));
  const all = texts(last);
  return (all.find((f) => prev.has(f.text)) ?? all.find((f) => f.severity === "severe") ?? all[0])?.text ?? null;
}

/** Builds a loop prompt's body and sends it for `slug`; `step` (the count the loop decided
 *  on) makes the send give up if anything committed since. */
async function sendLoopPrompt(dir: string, slug: string, kind: PromptKind, ctx: LoopCtx, step?: number): Promise<void> {
  const p = designProjectFor(dir);
  await ensurePrefixInputs(dir);
  const { review, settings } = ctx;
  let body: string;
  if (kind === "lintFix") body = lintFixPrompt(ctx.lint ?? { v: 1, version: review.version, at: "", ran: true, problem: null, severe: [], minor: [] }, review.fixPass, MAX_LINT_PASSES);
  else if (kind === "critique") body = critiquePrompt(review.round, settings.rounds, settings.bar, review.version, capturesFor(dir, slug, review.version));
  else if (kind === "critiqueFix" && ctx.critique) body = critiqueFixPrompt(ctx.critique);
  else if (kind === "resolve") body = resolveBlockerPrompt(blockerOf(p.active === slug ? p.critiques : ctx.critique ? [ctx.critique] : []) ?? "the last round's findings");
  else body = continuePrompt();
  await sendPrefixed(dir, slug, body, kind, review, step);
}

export async function loadDesigns(dir: string): Promise<void> {
  const p = designProjectFor(dir);
  const r = await designsList(dir);
  p.rows = r.rows; p.order = r.order ?? {};
  notify();
}

export async function openDesign(dir: string, slug: string, reload = false): Promise<void> {
  const p = designProjectFor(dir);
  const token = ++p.openToken;
  // Claim the design before the first await: the pane opens the first row
  // whenever nothing is open, so a read that took a moment would otherwise
  // let that auto-open start, bump the token, and drop this open on the floor
  // — leaving `active` unset for whatever was waiting on it (a brief to send).
  if (!reload && p.active !== slug) {
    p.active = slug;
    p.design = null; p.bad = false; p.canvas = emptyCanvas();
    p.frameStates = {}; p.versions = []; p.compare = null;
    Object.assign(p, blankReview());
    notify();
  }
  if (!p.base) p.base = await designFrameBase(dir);
  const r = await designRead(dir, slug);
  // A watcher-driven reload for a design the user has since clicked away
  // from would otherwise switch the pane back to it.
  if (reload && p.active !== slug) return;
  // A slower, older plain open() landing after a newer one started would
  // otherwise clobber the newer design with stale data.
  if (!reload && token !== p.openToken) return;
  p.active = slug;
  p.design = parseDesign(r.design);
  p.bad = r.bad || (!!r.design && !p.design);
  p.canvas = (r.canvas as CanvasFile) ?? emptyCanvas();
  if (!reload) p.frameStates = {};
  for (const f of p.design?.frames ?? []) if (!p.frameStates[f.id] || reload) p.frameStates[f.id] = { kind: "rendering" };
  if (reload) p.reloadTick += 1;
  p.versions = await designVersions(dir, slug).catch(() => []);
  notify();
  await loadReview(dir, slug, reload, token);
}

/** The open design's review: its state (a fresh open only — mid-loop the store is the
 *  state's one writer), its settings, the director's files, the newest version's lint,
 *  and every critique round; then a fresh open resumes a loop a restart interrupted. */
async function loadReview(dir: string, slug: string, reload: boolean, token: number): Promise<void> {
  const p = designProjectFor(dir);
  const stale = () => p.active !== slug || (!reload && token !== p.openToken);
  const [raw, set] = await Promise.all([
    reload ? null : designReviewState(dir, slug).catch(() => null),
    designReviewSettings(dir, slug).catch(() => null),
  ]);
  if (stale()) return;
  if (!reload) { p.review = parseReviewState(raw); p.critiqueMissing = false; }
  if (set) { p.settings = parseSettings(set.effective); p.settingsScope = { project: set.project ?? null, design: set.design ?? null }; }
  const [questions, tokens, lint, critiques] = await Promise.all([
    readQuestions(dir, slug), readTokens(dir, slug), readLint(dir, slug, p.versions[0]?.n),
    readCritiques(dir, slug, p.review.round, p.settings.bar),
  ]);
  if (stale()) return;
  p.questions = questions; p.tokens = tokens; p.lint = lint; p.critiques = critiques;
  notify();
  if (!reload) await resumeLoop(dir, slug);
}

/** After a restart: a loop that was mid-build re-runs the gate on its version; a critique
 *  that never came back is flagged. A turn still running is left to end on its own. */
async function resumeLoop(dir: string, slug: string): Promise<void> {
  const p = designProjectFor(dir);
  if (["idle", "done", "stopped", "below-bar"].includes(p.review.phase) || inFlight.has(flightKey(dir, slug))) return;
  const { state, next } = resumeAfterRestart(p.review, agentSessionFor(laneKey(dir, "design")).turnActive);
  if (next.kind === "regate") {
    const committed = commitReview(dir, slug, state); // bumps the step synchronously
    const startStep = stepOf(flightKey(dir, slug));
    await committed;
    await advance(dir, slug, null, false, true, startStep);
  } else if (next.kind === "critiqueMissing") {
    p.critiqueMissing = true; notify();
  }
}

export function frameMessage(dir: string, frameId: string, data: unknown): void {
  if (!data || typeof data !== "object" || (data as Record<string, unknown>).__chronicleFrame !== 1) return;
  const d = data as Record<string, unknown>;
  const p = designProjectFor(dir);
  if (d.type === "ready" || d.type === "height") {
    const h = Number(d.height);
    if (Number.isFinite(h) && h > 0) p.frameStates[frameId] = { kind: "rendered", height: h };
  } else if (d.type === "error") {
    p.frameStates[frameId] = { kind: "failed", message: String(d.message ?? "The page hit an error"), line: Number(d.line) || 0 };
  } else if (d.type === "blank") {
    p.frameStates[frameId] = { kind: "failed", message: "The page came out empty", line: 0 };
  } else return;
  notify();
}

export async function runUndoable(dir: string, e: UndoEntry): Promise<void> {
  const p = designProjectFor(dir);
  await e.redo();
  p.undo.push(e); p.redo = [];
  notify();
}
export async function undoDesign(dir: string) {
  const p = designProjectFor(dir); const e = p.undo.pop(); if (!e) return;
  await e.undo(); p.redo.push(e); notify();
}
export async function redoDesign(dir: string) {
  const p = designProjectFor(dir); const e = p.redo.pop(); if (!e) return;
  await e.redo(); p.undo.push(e); notify();
}

export function setCompare(dir: string, n: number | null) { designProjectFor(dir).compare = n; notify(); }

/** Undoable: redo restores v<n>; undo restores whatever version was newest
 *  before this call, so undo/redo just walk back and forth between the two. */
export function restoreVersion(dir: string, n: number): Promise<void> {
  const p = designProjectFor(dir); const slug = p.active; if (!slug) return Promise.resolve();
  const newestBefore = p.versions[0]?.n ?? n;
  const to = (v: number) => async () => { await designRestore(dir, slug, v); await openDesign(dir, slug, true); };
  return runUndoable(dir, { label: `Restore v${n}`, redo: to(n), undo: to(newestBefore) });
}

/** Branches from version `n` into a new design, opens it, and returns its slug. */
export async function branchVersion(dir: string, n: number): Promise<string> {
  const p = designProjectFor(dir); const slug = p.active; if (!slug) throw new Error("Pick a design first.");
  const copy = await designBranch(dir, slug, n);
  await loadDesigns(dir); await openDesign(dir, copy);
  return copy;
}

export function moveFrame(dir: string, frameId: string, x: number, y: number): Promise<void> {
  const p = designProjectFor(dir); const slug = p.active; if (!slug) return Promise.resolve();
  const before = structuredClone(p.canvas);
  const after: CanvasFile = { ...before, positions: { ...before.positions, [frameId]: { x, y } } };
  const apply = (c: CanvasFile) => async () => { p.canvas = structuredClone(c); await designCanvasSave(dir, slug, p.canvas); notify(); };
  return runUndoable(dir, { label: "Move frame", undo: apply(before), redo: apply(after) });
}

export function renameDesign(dir: string, slug: string, title: string): Promise<void> {
  const p = designProjectFor(dir);
  const old = p.rows.find((r) => r.slug === slug)?.title ?? p.design?.title ?? slug;
  const apply = (t: string) => async () => { await designRename(dir, slug, t); await loadDesigns(dir); if (p.active === slug && p.design) p.design.title = t; };
  return runUndoable(dir, { label: "Rename", undo: apply(old), redo: apply(title) });
}

export function setDesignKind(dir: string, slug: string, kind: DesignKind): Promise<void> {
  const p = designProjectFor(dir);
  const old = p.rows.find((r) => r.slug === slug)?.kind ?? "app";
  const apply = (k: DesignKind) => async () => { await designSetKind(dir, slug, k); await loadDesigns(dir); };
  return runUndoable(dir, { label: "Change kind", undo: apply(old), redo: apply(kind) });
}

export function trashDesign(dir: string, slug: string): Promise<void> {
  const p = designProjectFor(dir);
  let trashRel = ""; let current = slug;
  return runUndoable(dir, {
    label: "Delete design",
    redo: async () => { trashRel = await designTrash(dir, current); if (p.active === current) { p.active = null; p.design = null; } await loadDesigns(dir); },
    undo: async () => { current = await designUntrash(dir, trashRel); await loadDesigns(dir); },
  });
}

export function reorderDesigns(dir: string, kind: DesignKind, slugs: string[]): Promise<void> {
  const p = designProjectFor(dir);
  const before = structuredClone(p.order);
  const after = { ...before, [kind]: slugs };
  const apply = (o: Record<string, string[]>) => async () => { p.order = structuredClone(o); await designsOrderSave(dir, p.order); notify(); };
  return runUndoable(dir, { label: "Reorder", undo: apply(before), redo: apply(after) });
}

/** The design's name: the brief's first clause, cut at a word so a title never
 *  ends mid-word ("…Ethiopia Guji single o"). The folder is named after it. */
export function titleFromBrief(brief: string): string {
  const clause = brief.split(/[.,;\n]/)[0].trim().replace(/\s+/g, " ");
  if (!clause) return "Untitled design";
  if (clause.length <= 48) return clause;
  const cut = clause.slice(0, 48);
  const space = cut.lastIndexOf(" ");
  return (space > 16 ? cut.slice(0, space) : cut).replace(/[\s-]+$/, "");
}

export async function startDesign(dir: string, kind: DesignKind, brief: string): Promise<string> {
  const slug = await designCreate(dir, kind, titleFromBrief(brief), brief);
  await loadDesigns(dir);
  await openDesign(dir, slug);
  // the brief belongs to the design just created, whichever one the pane has
  // managed to open by now
  await sendDesignMessage(dir, brief, slug);
  return slug;
}

/** Waits for the lane to reach "ready", with a real deadline: a store change
 *  usually settles this immediately, but nothing else here guarantees the
 *  store ever changes again, so `every()` (src/lib/scheduler.ts) re-checks
 *  on its own cadence and both watchers are torn down together on settle —
 *  no bare setTimeout, per the no-bare-timers rule. */
function waitForReady(key: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let un: () => void = () => {};
    let stopTicker: () => void = () => {};
    const settle = (fn: () => void) => { un(); stopTicker(); fn(); };
    const check = () => {
      const s = agentSessionFor(key);
      if (s.phase === "ready") settle(resolve);
      else if (s.phase === "error" || s.phase === "needs-login") settle(() => reject(new Error(s.errorMessage ?? "The design session couldn't start.")));
      else if (Date.now() - started > ms) settle(() => reject(new Error("The design session took too long to start.")));
    };
    un = subscribeAgent(check);
    stopTicker = every(1_000, check);
    check();
  });
}

/** `forSlug` names the design the message belongs to when the caller already
 *  knows it (a brand-new design), instead of trusting whatever is open. */
export async function sendDesignMessage(dir: string, text: string, forSlug?: string): Promise<void> {
  const p = designProjectFor(dir); const slug = forSlug ?? p.active;
  if (!slug) throw new Error("Pick a design first.");
  await sendPrefixed(dir, slug, text, "user");
}

/** The prefix's inputs, read once per project: the designs folder and the context files. */
async function ensurePrefixInputs(dir: string): Promise<void> {
  const p = designProjectFor(dir);
  if (!p.rootPath) p.rootPath = await designRootPath(dir);
  if (p.context == null) p.context = await designContextFiles(dir).catch(() => []);
}

/** Every design-lane send: starts the lane if it has to, records the send as a loop step
 *  (`onSend`, persisted), and sends `body` behind the design prefix. A send that fails
 *  puts the step back — no turn started, so no turn end will ever take it. */
async function sendPrefixed(dir: string, slug: string, body: string, kind: PromptKind, from?: ReviewState, step?: number): Promise<void> {
  const p = designProjectFor(dir);
  const key = laneKey(dir, "design");
  const s = agentSessionFor(key);
  if (s.phase !== "ready") {
    // Read these before anything (a start/resume) resets the session object.
    const canResume = s.phase === "ended" && !!s.sessionId && s.loadSession;
    const resumeId = s.sessionId;
    if (canResume) await resumeAgentSession(key, resumeId!);
    else if (s.phase === "none" || s.phase === "ended" || s.phase === "error") await startAgentSession(key);
    // the Rust handshake allows 180 s for initialize; this outlasts it
    await waitForReady(key, 200_000);
  }
  await ensurePrefixInputs(dir);
  const k = flightKey(dir, slug);
  // a loop step whose decision went stale while the lane started is dropped, not sent
  if (step != null && stepOf(k) !== step) return;
  const held = inFlight.has(k);
  inFlight.add(k);
  try {
    const prev = from ?? (await reviewOf(dir, slug)).review;
    if (p.active === slug) p.critiqueMissing = false;
    await commitReview(dir, slug, onSend(prev, kind, Date.now()));
    p.turnSlug = slug;
    try {
      await sendAgentMessage(key, body, undefined, { prefix: designPrefix(slug, p.rootPath!, p.context ?? []) });
    } catch (e) {
      // no turn started, so no turn end will ever claim this slug
      if (p.turnSlug === slug) p.turnSlug = null;
      // put the step back — but a loop phase with no turn behind it reads as stopped
      await commitReview(dir, slug, LOOPING.has(prev.phase) ? onStop(prev) : prev);
      throw e;
    }
  } finally {
    if (!held) inFlight.delete(k);
  }
}

/* ---------- loop actions ---------- */

/** The open design's slug, or a throw the caller's toast shows. */
function activeSlug(dir: string): string {
  const slug = designProjectFor(dir).active;
  if (!slug) throw new Error("Pick a design first.");
  return slug;
}

async function submitQuestions(dir: string, answers: Record<string, unknown>, skipped: boolean, message: (q: Questions) => string, kind: PromptKind) {
  const p = designProjectFor(dir); const slug = activeSlug(dir);
  const asked = p.questions ?? { questions: [], references: false, answers: null, skipped: false };
  await designQuestionsAnswer(dir, slug, answers, skipped);
  p.questions = (await readQuestions(dir, slug)) ?? p.questions;
  notify();
  await sendPrefixed(dir, slug, message(asked), kind);
}

export function answerQuestions(dir: string, answers: Record<string, string | string[]>, references: string[]): Promise<void> {
  return submitQuestions(dir, { ...answers, references }, false, (q) => answersMessage(q, answers, references), "answers");
}

export function skipQuestions(dir: string): Promise<void> {
  return submitQuestions(dir, {}, true, () => skipMessage(), "answers");
}

/** Stop: cancels the running turn (its turn end reads "cancelled") and parks the loop. */
export async function stopReview(dir: string): Promise<void> {
  const p = designProjectFor(dir); const slug = activeSlug(dir);
  const key = laneKey(dir, "design");
  if (agentSessionFor(key).turnActive) await cancelAgentTurn(key);
  await commitReview(dir, slug, onStop(p.review));
}

/** One more critique round on the current version (also "Ask again" for a round that never came back). */
export async function askAnotherRound(dir: string): Promise<void> {
  const p = designProjectFor(dir); const slug = activeSlug(dir);
  const review: ReviewState = { ...p.review, phase: "critique", round: p.review.round + 1, fixPass: 0 };
  await sendLoopPrompt(dir, slug, "critique", { review, settings: p.settings, lint: p.lint, critique: p.critiques.at(-1) ?? null });
}

export function fixFinding(dir: string, f: Finding): Promise<void> {
  return sendPrefixed(dir, activeSlug(dir), fixFindingPrompt(f), "fixFinding");
}

/** Sends every minor lint finding of the newest version as one fix; nothing to fix, nothing sent. */
export async function fixAllMinor(dir: string): Promise<void> {
  const minor = designProjectFor(dir).lint?.minor ?? [];
  if (minor.length === 0) return;
  await sendPrefixed(dir, activeSlug(dir), fixAllMinorPrompt(minor), "fixFinding");
}

/** Below the bar, keep it: the loop is done and the best round's version carries its score. */
export async function acceptBelowBar(dir: string): Promise<void> {
  const p = designProjectFor(dir); const slug = activeSlug(dir);
  const best = p.review.best;
  await commitReview(dir, slug, onAccept(p.review));
  const n = best ? p.critiques.find((c) => c.round === best.round)?.version ?? p.review.version : null;
  if (best && n != null) await designVersionMark(dir, slug, n, best.score, best.round).catch(() => {});
  p.versions = await designVersions(dir, slug).catch(() => p.versions);
  notify();
}

export async function resolveBlocker(dir: string): Promise<void> {
  const p = designProjectFor(dir); const slug = activeSlug(dir);
  await sendLoopPrompt(dir, slug, "resolve", { review: p.review, settings: p.settings, lint: p.lint, critique: p.critiques.at(-1) ?? null });
}

export async function setReviewSettings(dir: string, scope: "project" | "design", patch: Partial<ReviewSettings>): Promise<void> {
  const p = designProjectFor(dir); const slug = activeSlug(dir);
  await designReviewSettingsSet(dir, scope, scope === "design" ? slug : null, patch);
  const set = await designReviewSettings(dir, slug);
  if (p.active !== slug) return;
  p.settings = parseSettings(set.effective); p.settingsScope = { project: set.project ?? null, design: set.design ?? null };
  notify();
}

export function setScoreOpen(dir: string, open: boolean) { designProjectFor(dir).scoreOpen = open; notify(); }
export function setPin(dir: string, pin: DesignProject["pin"]) { designProjectFor(dir).pin = pin; notify(); }
export function dismissCritiqueMissing(dir: string) { designProjectFor(dir).critiqueMissing = false; notify(); }

/** `m:ss` since the loop's attempt started (the review pill's clock). */
export function reviewElapsed(p: DesignProject, now: number): string {
  const secs = p.review.startedAt == null ? 0 : Math.max(0, Math.floor((now - p.review.startedAt) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
