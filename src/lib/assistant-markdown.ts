/*
 * The options the streaming reply renders with. A plain function so it is
 * testable without a DOM. Links: only http(s) is a link (anything else is
 * text), and a click goes to the app's opener (validated in Rust), never to
 * the webview's own navigation; streamdown's confirm modal is off because
 * the opener is the one gate. Images keep streamdown's defaults, which
 * already refuse data: and file: sources. Incomplete markdown closes as it streams.
 */
import { createElement, type AnchorHTMLAttributes, type ReactNode } from "react";
import type { Components, StreamdownProps } from "streamdown";
import { openUrl } from "@/lib/ipc";

const isHttp = (href: unknown): href is string => typeof href === "string" && /^https?:\/\//i.test(href);

function ReplyLink({ href, children, className }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) {
  if (!isHttp(href)) return createElement("span", { className }, children);
  return createElement(
    "a",
    {
      href,
      className,
      rel: "noopener noreferrer",
      onClick: (e: { preventDefault: () => void }) => {
        e.preventDefault();
        void openUrl(href).catch(() => {});
      },
    },
    children,
  );
}

const components: Components = { a: ReplyLink as Components["a"] };

export function assistantMarkdownProps(): Pick<StreamdownProps, "parseIncompleteMarkdown" | "linkSafety" | "components"> {
  return {
    parseIncompleteMarkdown: true,
    linkSafety: { enabled: false },
    components,
  };
}
