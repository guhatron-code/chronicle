/*
 * The options the streaming reply renders with. Kept as a plain object so the
 * security-relevant ones are testable without a DOM: links and images only
 * to http(s), incomplete markdown closed as it streams.
 */
export function assistantMarkdownProps() {
  return {
    parseIncompleteMarkdown: true,
    allowedLinkPrefixes: ["https://", "http://"],
    allowedImagePrefixes: ["https://", "http://"],
  };
}
