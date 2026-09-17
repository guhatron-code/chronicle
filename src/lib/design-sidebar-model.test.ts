import { describe, it, expect } from "vitest";
import { dropOrder } from "./design-sidebar-model";
describe("dropOrder", () => {
  it("moves before a row, or to the end", () => {
    expect(dropOrder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(dropOrder(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
    expect(dropOrder(["a", "b"], "z", "b")).toEqual(["a", "z", "b"]);
  });
});
