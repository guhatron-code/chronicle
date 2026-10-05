/* Board 4's token plan: the swatches the director picked, its type set in the
   named families, and what it turned down on purpose. The design's own fonts
   aren't loaded here, so each sample falls back to the system face and names
   its family beside it either way. */
import type { TokensPlan } from "@/lib/design-review-model";
import { Card, Eyebrow } from "./card";

export function TokenPlanCard({ tokens }: { tokens: TokensPlan }) {
  return (
    <Card label="Token plan">
      <div className="flex flex-col gap-2.5 px-3 py-2.5">
        <div className="flex items-center gap-1.5"><Eyebrow>Token plan</Eyebrow></div>
        {tokens.colors.length > 0 && (
          <div className="flex flex-wrap gap-2.5">
            {tokens.colors.map((c) => (
              <div key={c.name} className="flex flex-col items-start gap-1">
                {/* the swatch IS the director's data — its value is the color */}
                <span className="size-[30px] rounded-md [box-shadow:inset_0_0_0_1px_rgba(128,128,128,.25)]" style={{ background: c.value }} title={c.value} />
                <span className="font-mono text-[9.5px] text-text-faint">{c.name}</span>
              </div>
            ))}
          </div>
        )}
        {tokens.type.map((t, i) => {
          const display = /display|head/i.test(t.role) || (i === 0 && tokens.type.length > 1 && !/body/i.test(t.role));
          const w = parseInt(t.weight, 10);
          const metrics = t.size ? ` · ${t.size}${t.leading ? `/${t.leading}` : ""}` : "";
          return (
            <div key={`${t.role}-${i}`} className="flex items-baseline gap-2.5">
              <span className="text-text-primary" style={{ fontFamily: `"${t.family}", system-ui`, fontSize: display ? 22 : 15, fontWeight: Number.isFinite(w) ? w : display ? 700 : 400 }}>Aa</span>
              <span className="text-[11.5px] text-text-muted">{`${t.family}${t.weight ? ` ${t.weight}` : ""} ${t.role}${metrics}`}</span>
            </div>
          );
        })}
        {tokens.rejected.length > 0 && (
          <div className="text-[11.5px] leading-normal text-text-muted">Rejected on purpose: {tokens.rejected.join(", ").replace(/\.$/, "")}.</div>
        )}
      </div>
    </Card>
  );
}
