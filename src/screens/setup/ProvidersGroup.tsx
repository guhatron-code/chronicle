/*
 * Setup's Providers group (board 1): the two roles with their provider
 * select and the one-line "what leaves your Mac", then one row per provider
 * with an inline key (or address) form. Logic lives in setup-store. A typed
 * key lives only in the field until it is sent once; it is never echoed back.
 */
import { useEffect, useState } from "react";
import {
  chooseRole,
  leavesSentence,
  providerRows,
  providersState,
  refreshProviders,
  removeProviderKey,
  roleOptions,
  saveLocalAddress,
  saveProviderKey,
  type ProviderRowView,
  type Role,
} from "@/lib/setup-store";
import { toastError } from "@/overlays/toasts";
import { cn } from "@/lib/utils";

// Never include the error text for a key save: keep it generic.
const err = (what: string) => (e: unknown) => toastError(what, String(e).slice(0, 90));

function RoleRow({ role, title, blurb }: { role: Role; title: string; blurb: string }) {
  const s = providersState();
  const current = s?.roles[role] ?? "agent";
  return (
    <div className="flex items-center gap-[15px]">
      <div className="flex flex-1 flex-col gap-[3px]">
        <span className="text-[13px] font-medium text-text-primary">{title}</span>
        <span className="text-[12px] text-text-faint">{blurb}</span>
      </div>
      <select
        data-provider-role={role}
        aria-label={title}
        value={current}
        onChange={(e) => void chooseRole(role, e.target.value).catch(err("Couldn't change that"))}
        className="h-[33px] min-w-[200px] rounded-lg border border-border-field bg-surface-input px-2.5 text-[12.5px] text-text-primary"
      >
        {roleOptions(s, role).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function KeyForm({ row, onDone }: { row: ProviderRowView; onDone: () => void }) {
  const [value, setValue] = useState("");
  const isLocal = row.id === "local";
  const save = () => {
    const sent = value.trim();
    if (!sent) return;
    setValue(""); // the field forgets it the moment it is sent
    void (isLocal ? saveLocalAddress(sent) : saveProviderKey(row.id, sent))
      .then(onDone)
      .catch((e) => (isLocal ? err("Couldn't save the address")(e) : toastError("Couldn't save the key", "Check it and try again.")));
  };
  return (
    <div className="mt-1 flex flex-col gap-2.5 rounded-lg border border-border-hairline bg-surface-card p-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[11.5px] text-text-muted">{isLocal ? "The server’s address" : `Your ${row.name} key`}</span>
        <input
          autoFocus
          type={isLocal ? "url" : "password"}
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={isLocal ? "http://localhost:11434" : "Paste it here"}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          className="h-[33px] rounded-lg border border-border-field bg-surface-input px-2.5 font-mono text-[12px] text-text-primary placeholder:text-text-faint"
        />
      </label>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[11.5px] leading-[1.45] text-text-faint">{isLocal ? "Saved in Chronicle’s settings on this Mac." : "Saved in your Keychain, never in the project."}</span>
        <button onClick={onDone} className="h-[28px] rounded-md px-2.5 text-[12px] text-text-muted hover:bg-fill-hover">Cancel</button>
        <button disabled={!value.trim()} onClick={save} className="h-[28px] rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground disabled:opacity-50">
          {isLocal ? "Save address" : "Save key"}
        </button>
      </div>
    </div>
  );
}

export function ProvidersGroup({ dir }: { dir: string | null }) {
  useEffect(() => { void refreshProviders(dir); }, [dir]);
  const [open, setOpen] = useState<string | null>(null);
  const s = providersState();
  const rows = providerRows(s);
  if (!s) return null;
  return (
    <div className="flex flex-col gap-0.5" data-setup-group="providers">
      <div className="flex items-baseline gap-2.5 pb-1.5">
        <span className="text-[10px] uppercase tracking-[0.09em] text-text-subtle">Providers</span>
        <span className="text-[11.5px] text-text-muted">who answers when it isn’t your agent</span>
      </div>
      <div className="flex flex-col gap-2.5 pb-3.5 pt-1.5">
        <RoleRow role="review" title="Review" blurb="Who looks over a round’s result." />
        <RoleRow role="decisions" title="Decisions" blurb="Who answers the agent’s small questions during a run." />
        <div className="mt-0.5 flex flex-col gap-1 rounded-md bg-fill-subtle px-2.5 py-2 text-[11.5px] leading-[1.5] text-text-muted">
          <span>{leavesSentence("review", s.roles.review, s.agent?.refusal)}</span>
          <span>{leavesSentence("decisions", s.roles.decisions, s.agent?.refusal)}</span>
        </div>
      </div>
      <div className="flex flex-col">
        {rows.map((r, i) => (
          <div key={r.id} data-provider-row={r.id} className={cn("flex items-start gap-[15px] py-[15px]", i > 0 && "border-t border-divider")}>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[13px] font-medium text-text-primary">{r.name}</span>
              <span className="text-[12px] leading-snug text-text-faint">{r.blurb}</span>
              {open === r.id && <KeyForm row={r} onDone={() => setOpen(null)} />}
            </div>
            <span className={cn("shrink-0 whitespace-nowrap text-[12.5px]", r.tone === "ready" ? "text-state-success" : "text-text-muted")}>{r.word}</span>
            {(r.action === "add_key" || r.action === "add_address") && open !== r.id && (
              <button onClick={() => setOpen(r.id)} className="h-[33px] shrink-0 whitespace-nowrap rounded-lg border border-border-strong px-[14px] text-[12.5px] font-medium text-text-primary hover:bg-fill-hover">
                {r.action === "add_key" ? "Add key" : "Add address"}
              </button>
            )}
            {(r.action === "remove_key" || r.action === "remove_address") && (
              <button
                onClick={() => void (r.action === "remove_key" ? removeProviderKey(r.id) : saveLocalAddress(null)).catch(err("Couldn't remove it"))}
                className="h-[33px] shrink-0 whitespace-nowrap rounded-lg border border-border-hairline px-[14px] text-[12.5px] font-medium text-text-muted hover:bg-fill-hover hover:text-text-primary"
              >
                {r.action === "remove_key" ? "Remove key" : "Remove address"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
