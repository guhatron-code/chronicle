import { describe, expect, it } from "vitest";
import { displayAddress, isClaudeArtifactUrl, isHtmlPath, toAddress, SEARCH_PREFIX } from "./web-url";

describe("toAddress", () => {
  it("keeps http(s) URLs", () => {
    expect(toAddress("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(toAddress("http://localhost:3000")).toBe("http://localhost:3000");
  });
  it("prepends https to a bare host", () => {
    expect(toAddress("news.ycombinator.com")).toBe("https://news.ycombinator.com");
    expect(toAddress("  example.com/path ")).toBe("https://example.com/path");
  });
  it("prepends https to host:port addresses", () => {
    expect(toAddress("localhost:3000")).toBe("https://localhost:3000");
    expect(toAddress("staging.example.com:8080/x")).toBe("https://staging.example.com:8080/x");
  });
  it("searches anything with spaces or no dot", () => {
    expect(toAddress("tauri child webview")).toBe(`${SEARCH_PREFIX}tauri%20child%20webview`);
    expect(toAddress("hello")).toBe(`${SEARCH_PREFIX}hello`);
  });
  it("rejects javascript:, data:, file: and empty input", () => {
    expect(toAddress("javascript:alert(1)")).toBeNull();
    expect(toAddress("JavaScript:alert(1)")).toBeNull();
    expect(toAddress("data:text/html,hi")).toBeNull();
    expect(toAddress("file:///etc/passwd")).toBeNull();
    expect(toAddress("   ")).toBeNull();
  });
  it("keeps chronicle-file and about:blank", () => {
    expect(toAddress("chronicle-file://abc/report.html")).toBe("chronicle-file://abc/report.html");
    expect(toAddress("about:blank")).toBe("about:blank");
  });
  it("searches unknown schemes instead of passing them through", () => {
    expect(toAddress("ftp://x.y")).toBe(`${SEARCH_PREFIX}ftp%3A%2F%2Fx.y`);
  });
});

describe("displayAddress", () => {
  it("hides the project scheme", () => {
    expect(displayAddress("chronicle-file://0123abcd/artifacts/audit/report.html")).toBe("this project › artifacts/audit/report.html");
  });
  it("shows nothing for about:blank and the URL otherwise", () => {
    expect(displayAddress("about:blank")).toBe("");
    expect(displayAddress("https://example.com/")).toBe("https://example.com/");
  });
  it("guards the display decode against malformed percent sequences", () => {
    expect(displayAddress("chronicle-file://abc/100%.html")).toBe("this project › 100%.html");
  });
});

describe("isClaudeArtifactUrl", () => {
  it("matches claude artifact links", () => {
    expect(isClaudeArtifactUrl("https://claude.ai/code/artifacts/abc123")).toBe(true);
    expect(isClaudeArtifactUrl("https://claude.ai/artifacts/abc123")).toBe(true);
    expect(isClaudeArtifactUrl("https://www.claude.ai/public/artifacts/abc")).toBe(true);
    expect(isClaudeArtifactUrl("https://claude.site/artifacts/abc")).toBe(true);
  });
  it("rejects other claude pages and other hosts", () => {
    expect(isClaudeArtifactUrl("https://claude.ai/chat/xyz")).toBe(false);
    expect(isClaudeArtifactUrl("https://example.com/artifacts/abc")).toBe(false);
    expect(isClaudeArtifactUrl("not a url")).toBe(false);
  });
});

describe("isHtmlPath", () => {
  it("matches html and htm, any case", () => {
    expect(isHtmlPath("artifacts/report.html")).toBe(true);
    expect(isHtmlPath("A/B/index.HTM")).toBe(true);
    expect(isHtmlPath("notes.md")).toBe(false);
    expect(isHtmlPath("report.html.bak")).toBe(false);
  });
});
