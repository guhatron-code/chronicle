/*
 * The Help screen's content (G7/G8) — task recipes, the plain glossary, and
 * the shortcuts, all in a non-developer's language. Data lives here so the
 * screen is presentational and search has one place to read from. The
 * shortcuts are the ACTUAL shipped bindings (the comp's ⌘J/⌘R were
 * placeholders); reconcile here if the keymap in App.tsx changes.
 */

export type HelpTarget = "road" | "repo" | "kanban" | "agent" | "setup";

/* ---------- getting-started guides (the tutorial) ----------
   Written for a designer who has never worked with an AI coding tool. Plain
   language, concrete, no jargon in the voice. Each guide reads like a short
   article you can follow start to finish. */

export type GuideBlock =
  | { kind: "para"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "tip"; text: string }
  | { kind: "example"; bad: string; good: string };

export interface Guide {
  id: string;
  title: string;
  blurb: string;
  minutes: number;
  body: GuideBlock[];
}

export const GUIDES: Guide[] = [
  {
    id: "what-is-chronicle",
    title: "Start here — what Chronicle is",
    blurb: "The big picture, in two minutes. No code, no jargon.",
    minutes: 2,
    body: [
      { kind: "para", text: "Chronicle is a calm home for building your idea with an AI. You describe what you want in plain English; the AI — her name is Chronigirl — writes and edits the actual project for you. Chronicle sits around that conversation and keeps everything honest: it shows you what changed, lets you undo anything, and translates the technical bits into words you already know." },
      { kind: "para", text: "You do not need to know how to code. You do not need to touch a terminal. Your job is to describe the outcome you want and to review what Chronigirl does — like art-directing a very fast, very literal teammate." },
      { kind: "heading", text: "The three places you'll spend time" },
      { kind: "steps", items: [
        "The roadmap — the plan for your build, broken into phases (chunks of work with a goal).",
        "Chronigirl — the chat where you talk to the AI and watch it work.",
        "The project view — your files and your history (saving, publishing, undoing).",
      ] },
      { kind: "tip", text: "You are never one wrong click from disaster. Every change the AI makes is reviewable and undoable, and Chronicle never touches your project without you asking." },
    ],
  },
  {
    id: "getting-set-up",
    title: "Getting set up (one time)",
    blurb: "Install what Chronicle needs — without typing a single command.",
    minutes: 2,
    body: [
      { kind: "para", text: "The very first time you open Chronicle, it checks whether your computer has the few tools it needs and offers to set them up for you. You will not type any commands — Chronicle does it all and shows you honest progress." },
      { kind: "heading", text: "What it sets up, and why" },
      { kind: "steps", items: [
        "The AI that does the work (Claude Code) — and signs you in.",
        "The engine it runs on (Node) — background software the AI needs.",
        "Your projects' online home (GitHub) — so you can publish and share.",
        "Extra skills — abilities that make the AI better at bigger jobs.",
      ] },
      { kind: "para", text: "Press “Set everything up for me” and it works down the list. If any step needs you — like signing in — it opens the right window and waits. When every row is green, you're ready." },
      { kind: "tip", text: "Something stop working later? Open “Need help?” → Setup & health any time to re-check and repair. There's also a one-click fix for the common “I typed the AI's name in the terminal and nothing happened” problem." },
    ],
  },
  {
    id: "first-project",
    title: "Start your first project",
    blurb: "What a project is, and how to open or create one.",
    minutes: 2,
    body: [
      { kind: "para", text: "A project is simply a folder on your computer that holds one idea you're building — a website, an app, a prototype. Chronicle opens that folder and keeps track of everything inside it." },
      { kind: "heading", text: "Two ways to start" },
      { kind: "steps", items: [
        "New project — from the welcome screen, press New project, give it a name, and Chronicle makes a fresh folder ready to build in.",
        "Open a folder — already have work somewhere? Press Open and pick its folder. Chronicle reads it and shows you where things stand.",
      ] },
      { kind: "para", text: "Once a project is open, the agent starts on its own so Chronigirl is ready the moment you want her. If you'd rather she wait, just don't type anything." },
    ],
  },
  {
    id: "first-plan",
    title: "Talking to Chronigirl — your first plan",
    blurb: "How to write a first message that gets great results.",
    minutes: 4,
    body: [
      { kind: "para", text: "This is the most important skill, and it's one you already have as a designer: describing what you want. Chronigirl is literal and fast, so the clearer your brief, the better the result. Talk about the OUTCOME — what it should look like and do — not the code." },
      { kind: "heading", text: "A good first message has three things" },
      { kind: "steps", items: [
        "What you're building — “a landing page for a coffee subscription”.",
        "What it should feel like — “warm, minimal, lots of whitespace, one accent colour”.",
        "What matters most right now — “start with the hero section and the sign-up form”.",
      ] },
      { kind: "example", bad: "Make it look good.", good: "Build a hero section for a coffee-subscription site: a big warm headline, a short subline, one “Start your box” button, and a photo on the right. Minimal, lots of whitespace, one terracotta accent. Don't build the rest of the page yet." },
      { kind: "para", text: "Notice the good version says what to build, the mood, and where to stop. You don't need design or code words — plain description is perfect. You can even paste a reference or describe a site you like." },
      { kind: "heading", text: "How the conversation goes" },
      { kind: "steps", items: [
        "Type your message and press send. Chronigirl thinks, then starts working — you'll see her edits as cards you can open.",
        "She asks permission before doing anything risky. You choose Allow or Don't allow.",
        "When she's done, review the changes (see the next guide). Then reply with the next thing: “now add the pricing section”.",
      ] },
      { kind: "tip", text: "Working in small steps beats one giant request. Build the hero, look at it, then ask for the next piece. You stay in control and the results stay on-track." },
    ],
  },
  {
    id: "starting-a-phase",
    title: "Using the roadmap and phases",
    blurb: "Let Chronicle hand Chronigirl a ready-made plan.",
    minutes: 2,
    body: [
      { kind: "para", text: "If your project has a roadmap, it's already broken into phases — chunks of work with a goal, like “design the sign-up flow”. Each phase can hand Chronigirl a prepared prompt so you don't have to write one from scratch." },
      { kind: "steps", items: [
        "Open a phase from the roadmap.",
        "Press “Start with the agent”. Chronicle loads that phase's plan into the chat as a draft — nothing is sent yet.",
        "Read it, tweak anything you want, then press send. Chronigirl runs the phase while you watch.",
      ] },
      { kind: "tip", text: "The draft is a starting point, not a rule. Add a sentence about the look you want before you send it — the phase plan plus your taste is the best combination." },
    ],
  },
  {
    id: "review-and-undo",
    title: "Reviewing and undoing — you're always safe",
    blurb: "See every change, keep what you like, undo the rest.",
    minutes: 3,
    body: [
      { kind: "para", text: "The whole point of Chronicle is that you never have to trust the AI blindly. Everything Chronigirl changes is shown to you and can be undone." },
      { kind: "heading", text: "While she works" },
      { kind: "para", text: "Each edit appears as a card in the chat — “Edited PricingTable · view the changes”. Click it to see exactly what changed, in a clear before/after." },
      { kind: "heading", text: "After she works" },
      { kind: "steps", items: [
        "A strip appears: “4 files changed · Review · Keep all · Undo all”.",
        "Review opens each change with Keep or Undo per file — so you can keep the header she rewrote but undo the footer.",
        "Above every message is “Undo to here” — one click puts the whole project back to how it was before that message. Your conversation stays.",
      ] },
      { kind: "tip", text: "Because undo is always one click away, the best way to learn is to try things. Ask for something, look, undo if it's not right, ask again." },
    ],
  },
  {
    id: "github",
    title: "Putting your work online (GitHub)",
    blurb: "What GitHub is, and how publishing works — in plain words.",
    minutes: 3,
    body: [
      { kind: "para", text: "GitHub is your project's home on the internet. Two reasons designers care about it: it's a safe backup (your work lives online, not just on your laptop), and it's how you share a project or hand it to a developer." },
      { kind: "heading", text: "The words Chronicle uses" },
      { kind: "steps", items: [
        "Save — record where your project is right now, like a snapshot you can return to. (Developers call this a “commit”.)",
        "Publish — send your latest saves up to GitHub, so the online copy matches your computer. (This is a “push”.)",
        "Bring down — pull the newest version from GitHub onto this computer, e.g. if you worked somewhere else. (This is a “pull”.)",
      ] },
      { kind: "heading", text: "Setting it up" },
      { kind: "steps", items: [
        "Open “Need help?” → Setup & health and make sure GitHub is green (it installs GitHub's tool and signs you in — no commands).",
        "In a project, press “Put it on GitHub”. Chronicle creates the online home and publishes your work in one step.",
        "From then on, just press Publish whenever you want the online copy to catch up.",
      ] },
      { kind: "tip", text: "You never have to understand git to use this. If a screen ever shows raw git words, that's a bug — tell us. The app's job is to keep it in plain language." },
    ],
  },
  {
    id: "needs-you",
    title: "When Chronicle needs you",
    blurb: "Red dots, the “what needs you” list, and what to do.",
    minutes: 2,
    body: [
      { kind: "para", text: "Chronicle watches your project and surfaces the few things that are genuinely waiting on a decision from you — nothing more. That's the “what needs you” list on the roadmap." },
      { kind: "steps", items: [
        "A red dot means one thing needs a decision or action from you.",
        "Click it to read, in plain words, what happened and why.",
        "Do the one action it suggests — usually a single button, like Publish or Sign in.",
      ] },
      { kind: "tip", text: "If nothing has a red dot, there's nothing you need to do. A quiet Chronicle is a good Chronicle." },
    ],
  },
];

export interface Recipe {
  title: string;
  steps: string[];
  /** where "Show me" takes you */
  target: HelpTarget;
}

export interface GlossaryTerm {
  term: string;
  meaning: string;
  /** the technical word, shown small in mono — omitted when there isn't one */
  technical?: string;
}

export interface Shortcut {
  keys: string;
  label: string;
}

export const RECIPES: Recipe[] = [
  {
    title: "Publish my project online",
    steps: ["Open the project you want to share.", "In the Repo view, press Publish.", "Pick who can see it, then confirm."],
    target: "repo",
  },
  {
    title: "Undo what the agent changed",
    steps: ["Find the checkpoint from just before the change.", "Press Undo to here.", "Your files go back to how they were."],
    target: "agent",
  },
  {
    title: "Start a phase with the agent",
    steps: ["Open the phase in the Roadmap.", "Press Start with the agent.", "Answer its questions; it works while you watch."],
    target: "road",
  },
  {
    title: "Understand a red mark in “what needs you”",
    steps: ["A red dot means one thing is waiting on you.", "Click it to read what happened, in plain words.", "Do the one action it suggests."],
    target: "road",
  },
  {
    title: "Bring down changes from another computer",
    steps: ["Open the project in the Repo view.", "Press Bring down.", "The newest version lands on this computer."],
    target: "repo",
  },
  {
    title: "Start a fresh project",
    steps: ["From the picker, press New project.", "Give it a name and pick a folder.", "Chronicle opens it, ready to go."],
    target: "road",
  },
  {
    title: "Sign back in when the agent needs a login",
    steps: ["The agent shows “isn’t signed in”.", "Press Sign in — a terminal opens.", "Finish there; the agent picks up on its own."],
    target: "agent",
  },
];

export const GLOSSARY: GlossaryTerm[] = [
  { term: "save", meaning: "Record where your project is right now, so you can come back to it.", technical: "commit" },
  { term: "publish", meaning: "Put your project online so others can see it.", technical: "push" },
  { term: "bring down", meaning: "Get the newest version of your project onto this computer.", technical: "pull" },
  { term: "the agent", meaning: "The AI that writes and edits your project for you." },
  { term: "a phase", meaning: "A chunk of work with a goal — like “add the sign-up page”." },
  { term: "a round", meaning: "One back-and-forth with the agent inside a phase." },
  { term: "a checkpoint", meaning: "A saved moment you can go back to if something goes wrong." },
  { term: "works freely", meaning: "The agent edits files without asking each time. Commands still ask." },
  { term: "what needs you", meaning: "The list of things waiting on a decision or action from you." },
  { term: "a workspace", meaning: "The folder on your computer where one project lives.", technical: "working directory" },
];

export const SHORTCUTS: Shortcut[] = [
  { keys: "⌘K", label: "Open another project" },
  { keys: "⌘O", label: "Open a folder" },
  { keys: "⌘1–9", label: "Switch between open projects" },
  { keys: "⌘J", label: "Cycle Roadmap · Repo · Kanban" },
  { keys: "⌥⌘1", label: "Show or hide the content pane" },
  { keys: "⌥⌘2", label: "Show or hide the agent" },
  { keys: "⌥⌘3", label: "Show or hide the terminal" },
  { keys: "⌘⏎", label: "Send a message to the agent" },
  { keys: "⌘T", label: "New terminal" },
  { keys: "⌘⇧F", label: "Search this project" },
  { keys: "⌘W", label: "Close the project" },
  { keys: "⌘/", label: "Open Help" },
];

export interface SearchHit {
  kind: "guide" | "recipe" | "glossary";
  title: string;
  sub?: string;
  guide?: Guide;
  recipe?: Recipe;
  term?: GlossaryTerm;
}

/** flatten a guide's blocks to searchable text */
function guideText(g: Guide): string {
  return g.body
    .map((b) => {
      if (b.kind === "steps") return b.items.join(" ");
      if (b.kind === "example") return `${b.bad} ${b.good}`;
      return b.text;
    })
    .join(" ");
}

/** Search across guides + recipes + glossary — one ranked list, all kinds. */
export function searchHelp(q: string): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  for (const g of GUIDES) {
    const hay = `${g.title} ${g.blurb} ${guideText(g)}`.toLowerCase();
    if (hay.includes(needle)) hits.push({ kind: "guide", title: g.title, sub: g.blurb, guide: g });
  }
  for (const r of RECIPES) {
    const hay = `${r.title} ${r.steps.join(" ")}`.toLowerCase();
    if (hay.includes(needle)) hits.push({ kind: "recipe", title: r.title, recipe: r });
  }
  for (const g of GLOSSARY) {
    const hay = `${g.term} ${g.meaning} ${g.technical ?? ""}`.toLowerCase();
    if (hay.includes(needle)) hits.push({ kind: "glossary", title: g.term, sub: g.meaning, term: g });
  }
  // title/term matches rank above body-only matches
  hits.sort((a, b) => Number(b.title.toLowerCase().includes(needle)) - Number(a.title.toLowerCase().includes(needle)));
  return hits;
}
