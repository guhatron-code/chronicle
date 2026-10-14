/*
 * The reply renders as it streams. Three inputs that break naive renderers at a
 * chunk boundary — an unterminated fence, a table cut mid-row, raw HTML — must
 * render without throwing and without ever emitting a script tag. Rendered
 * server-side: vitest here is the node environment, and streamdown is SSR-safe.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { assistantMarkdownProps } from "./assistant-markdown";

const render = (text: string) => renderToStaticMarkup(createElement(Streamdown, { ...assistantMarkdownProps(), children: text }));

describe("the streaming reply", () => {
  it("renders an unterminated code fence as code, not as a swallowed block", () => {
    const html = render("Here:\n```ts\nconst a = 1");
    expect(html).toContain("const a = 1");
    expect(html).toMatch(/<pre|<code/);
  });
  it("renders a table cut mid-row without throwing", () => {
    expect(() => render("| a | b |\n|---|---|\n| 1 |")).not.toThrow();
  });
  it("never emits a script tag or an inline handler from raw HTML in the reply", () => {
    const html = render("hi <script>alert(1)</script> <img src=x onerror=alert(1)> there");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });
  it("links and images are limited to http(s)", () => {
    const p = assistantMarkdownProps();
    expect(p.allowedLinkPrefixes).toEqual(["https://", "http://"]);
    expect(p.allowedImagePrefixes).toEqual(["https://", "http://"]);
    expect(p.parseIncompleteMarkdown).toBe(true);
  });
});
