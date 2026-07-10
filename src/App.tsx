// Phase A placeholder — proves the pipeline (Vite + Tauri + shadcn + Weave tokens).
// No real UI is built here: surfaces arrive with the Claude Design comps (Phase B/C).
import { Button } from "@/components/ui/button";

export default function App() {
  return (
    <div
      data-tauri-drag-region
      className="flex h-full flex-col items-center justify-center gap-3"
    >
      <p className="font-mono text-xs uppercase tracking-[0.09em] text-text-dimmer">
        chronicle · react-shadcn · phase A
      </p>
      <Button>The pipeline works</Button>
    </div>
  );
}
