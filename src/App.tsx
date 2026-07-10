// Phase A placeholder — proves the pipeline (Vite + Tauri + shadcn + Weave tokens)
// and, since R1, the strict-CSP + IPC path (a real invoke through src/lib/ipc.ts).
// No real UI is built here: surfaces arrive with the Claude Design comps (Phase B/C).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { agentsAvailable } from "@/lib/ipc";

export default function App() {
  const [ipc, setIpc] = useState("ipc: probing…");
  useEffect(() => {
    agentsAvailable()
      .then((a) => {
        const d = (a as { default?: string } | null)?.default ?? "none";
        setIpc(`ipc: ok · default agent ${d}`);
      })
      .catch((e) => setIpc(`ipc: FAILED · ${String(e)}`));
  }, []);
  return (
    <div
      data-tauri-drag-region
      className="flex h-full flex-col items-center justify-center gap-3"
    >
      <p className="font-mono text-xs uppercase tracking-[0.09em] text-text-dimmer">
        chronicle · react-shadcn · phase A
      </p>
      <Button>The pipeline works</Button>
      <p className="font-mono text-xs text-text-dim">{ipc}</p>
    </div>
  );
}
