/*
 * The director's replay harness: one real director session, recorded by the
 * app itself during the live check (2026-10-05), fed through the ONE reducer
 * with nothing live. The fixture is an excerpt of the design lane of the
 * one-brief benchmark run (`chronicle designs bench --brief ecommerce-1`),
 * session 14775dc3-…: the brief, the token plan, the frame writes, the gate's
 * capture and lint calls, every critique prompt with its four reviewer Tasks
 * (one child call kept under each), the round files, the fix prompts with a
 * couple of their edits, the two refused shell asks, and every turn end.
 * Everything else was dropped; the bench project became /home/u/proj, the slug
 * became guji-product-page, long strings were cut and big bodies became
 * {"_trimmed":true}.
 *
 * Three departures from the plan's test, all because they are what is true:
 * - the plan asserted the reviewers through groupEntries; that grouping breaks
 *   today on a self-parent the adapter sends (see the it.fails below), so the reviewers
 *   are asserted on the flat thread and the grouping is kept as it.fails;
 * - there is no questions.json: the benchmark brief is a full brief, and a
 *   full brief gets no form, so the session never wrote one;
 * - the reviewer Task titles are the director's own descriptions
 *   ("art-director: review v1", "ux-director: …", "accessibility: …",
 *   "copy: …"); the adapter first titles every Task "Task" and renames it once
 *   the description streams in, and the asserts below read the final title.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./ipc", () => ({
  onAcpUpdate: vi.fn(async () => () => {}),
  agentPrompt: vi.fn(), roundRunMessage: vi.fn(), agentSessionStart: vi.fn(),
  roundPlanBegin: vi.fn(), roundPlanCancel: vi.fn(), roundPlanSettle: vi.fn(),
  agentCancel: vi.fn(), agentEdits: vi.fn(), agentHistoryRead: vi.fn(),
  agentSetConfigOption: vi.fn(), agentRespondPermission: vi.fn(), agentSessionResume: vi.fn(),
  agentSessionState: vi.fn(), agentSessionStop: vi.fn(), agentSessionsList: vi.fn(),
  agentSetMode: vi.fn(), designOutsideFiles: vi.fn(async () => ({ files: [], abs: {} })),
}));
vi.mock("./notes-store", () => ({
  indexFor: () => ({ notes: [], rounds: [], generation: 0, vault: "", borrowed: false }),
  refreshNotes: vi.fn(), roundGenerating: vi.fn(() => false), roundNotesFor: vi.fn(() => []), setRoundGenerating: vi.fn(),
}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastAction: vi.fn(), toastError: vi.fn() }));

const { reduceLines, laneKey, groupEntries } = await import("./agent-session");

const lines = readFileSync(path.join(__dirname, "__fixtures__/design-director.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l) as unknown);

describe("a recorded director session replays through the reducer", () => {
  const s = reduceLines(laneKey("/home/u/proj", "design"), lines);

  it("is bounded and ends on a turn end", () => {
    expect(lines.length).toBeLessThanOrEqual(500);
    expect((lines.at(-1) as { method: string }).method).toBe("_chronicle/turn_end");
    expect(JSON.stringify(lines)).not.toMatch(/\/private\/tmp|\/Users\//);
  });

  it("wrote the director's files inside the design", () => {
    const paths = s.entries.filter((e) => e.kind === "tool").map((e) => (e as { detail: string }).detail);
    for (const f of ["tokens.json", "frames/desktop.html", "critique/round-1.json"]) {
      expect(paths.some((p) => p.endsWith(f))).toBe(true);
    }
    // a full brief gets no form: the session never wrote questions.json
    expect(paths.some((p) => p.endsWith("questions.json"))).toBe(false);
    // and every write the fence saw landed inside the design's folder
    const guards = s.entries.filter((e) => e.kind === "guard") as { allowed: boolean; path: string }[];
    expect(guards.length).toBeGreaterThan(0);
    for (const g of guards) {
      expect(g.allowed).toBe(true);
      expect(g.path.startsWith("/home/u/proj/.chronicle/designs/guji-product-page/")).toBe(true);
    }
  });

  it("ran the four reviewers as subagents, every critique round", () => {
    const tasks = s.entries.filter((e) => e.kind === "tool" && e.subagent) as { title: string }[];
    expect(tasks.length).toBe(12); // three critique rounds × four reviewers
    for (const name of ["art-director", "ux-director", "accessibility", "copy"]) {
      expect(tasks.filter((t) => t.title.startsWith(`${name}: review v`)).length).toBe(3);
    }
  });

  // claude-agent-acp 0.75.1 sends a Task's progress update with
  // _meta.claudeCode.parentToolUseId set to the Task's OWN id; the reducer
  // ignores a self-parent, so every reviewer card stays in the grouped thread.
  it("groups the four reviewers as subagent cards with their calls under them", () => {
    const subs = groupEntries(s.entries).filter((e) => e.kind === "subagent") as {
      tool: { title: string };
      children: unknown[];
    }[];
    expect(subs.length).toBeGreaterThanOrEqual(4);
    for (const name of ["art", "ux", "accessib", "copy"]) {
      expect(subs.some((x) => x.tool.title.toLowerCase().includes(name))).toBe(true);
    }
    // each reviewer's own calls fold under its card
    expect(subs.every((x) => x.children.length >= 1)).toBe(true);
  });

  it("shows user messages without the design prefix", () => {
    const users = s.entries.filter((e) => e.kind === "user") as { text: string }[];
    expect(users.length).toBeGreaterThanOrEqual(3);
    for (const u of users) expect(u.text.startsWith("[design:")).toBe(false);
    expect(users.some((u) => u.text.startsWith("Critique round 1 of 3."))).toBe(true);
  });
});
