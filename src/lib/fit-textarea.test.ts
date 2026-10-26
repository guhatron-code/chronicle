/*
 * The composer's input grows with its text. Measuring that ("auto" height, then
 * read scrollHeight) forces a layout with the input at one line, and in that
 * instant the thread above it gets taller and the browser clamps its scrollTop
 * down — which the thread then reads as the user scrolling up and drops its
 * pin. The box around the input holds its height for the measurement.
 */
import { describe, expect, it } from "vitest";
import { fitTextarea } from "./fit-textarea";

type Fake = { style: { height: string }; log: string[] };
function fakes(boxPx: number, contentPx: number) {
  const log: string[] = [];
  const styleOf = (name: string): { height: string } =>
    new Proxy({ height: "" }, { set(t, k, v) { t[k as keyof typeof t] = v as string; log.push(`${name}.${String(k)}=${v}`); return true; } });
  const ta = { style: styleOf("ta"), scrollHeight: contentPx, log } as Fake & { scrollHeight: number };
  const box = { style: styleOf("box"), offsetHeight: boxPx, log } as Fake & { offsetHeight: number };
  return { ta, box, log };
}

describe("fitTextarea", () => {
  it("holds the box at its current height across the measurement, then lets it follow the input", () => {
    const { ta, box, log } = fakes(96, 60);
    fitTextarea(ta, box);
    expect(log).toEqual(["box.height=96px", "ta.height=auto", "ta.height=60px", "box.height="]);
  });
  it("works with no box to hold (the input alone)", () => {
    const { ta, log } = fakes(0, 44);
    fitTextarea(ta, null);
    expect(log).toEqual(["ta.height=auto", "ta.height=44px"]);
  });
});
