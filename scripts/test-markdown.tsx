/**
 * Safety and behaviour tests for the legal-document renderer.
 *
 * The privacy policy, the terms and the partner agreement are typed by an admin
 * in Settings and then shown to customers and to partners, so this is the one
 * place where content crosses from a database column into a page. These cases
 * exist so a change to the renderer cannot quietly reintroduce a way to inject
 * markup, and so a new construct is added deliberately rather than by accident.
 *
 * Run with: npx tsx scripts/test-markdown.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown } from "../lib/markdown";

const cases: { name: string; input: string; check: (html: string) => boolean }[] = [
  // Nothing raw may survive into the page.
  {
    name: "script tag is escaped",
    input: "## H\n\n<script>alert(1)</script>",
    check: (h) => !h.includes("<script") && h.includes("&lt;script&gt;"),
  },
  {
    name: "img with onerror is escaped",
    input: "<img src=x onerror=alert(1)>",
    // The words onerror and alert survive as visible text, which is fine. What
    // must not exist is an img element, and the text must be escaped so the
    // angle brackets cannot start a tag.
    check: (h) => !/<img/i.test(h) && h.includes("&lt;img"),
  },
  {
    name: "inline event handler cannot be injected",
    input: '<div onmouseover="alert(1)">hi</div>',
    // Escaped text is expected; a real div with a real handler is not.
    check: (h) => !/<div/i.test(h) && h.includes("&lt;div"),
  },
  {
    name: "javascript: link is refused",
    input: "[click me](javascript:alert(1))",
    check: (h) => !h.toLowerCase().includes("href=\"javascript:") && !h.includes("<a "),
  },
  {
    name: "data: link is refused",
    input: "[click me](data:text/html;base64,PHNjcmlwdD4=)",
    check: (h) => !h.includes("href=\"data:") && !h.includes("<a "),
  },
  {
    name: "quote in a link label cannot break out of the attribute",
    input: '[a"b](https://example.com)',
    check: (h) => !/href="[^"]*"/.test(h) || !h.includes('a"b'),
  },
  {
    name: "attribute break-out in a link target is dropped",
    input: '[x](https://a.com") onload="alert(1))',
    // The target carries a quote, so no link is produced at all. The rest stays
    // as text, and the quote is escaped, so onload= never becomes an attribute.
    check: (h) => !h.includes("<a ") && !h.includes('onload="'),
  },

  // Safe things must still work.
  {
    name: "https link is kept",
    input: "[ok](https://example.com)",
    check: (h) => h.includes('href="https://example.com"') && h.includes('rel="noopener noreferrer"'),
  },
  {
    name: "mailto link is kept",
    input: "[mail](mailto:hello@example.com)",
    check: (h) => h.includes('href="mailto:hello@example.com"'),
  },
  { name: "bold", input: "**hi**", check: (h) => h.includes("<strong>hi</strong>") },
  { name: "italic", input: "a *hi* b", check: (h) => h.includes("<em>hi</em>") },
  { name: "bullet list", input: "- one\n- two", check: (h) => h.includes("<ul>") && h.includes("<li>one</li>") },
  { name: "numbered list", input: "1. first\n2. second", check: (h) => h.includes("<ol>") && h.includes("<li>first</li>") },
  { name: "h2 and h3", input: "## Two\n\n### Three", check: (h) => h.includes("<h2>Two</h2>") && h.includes("<h3>Three</h3>") },
  { name: "consecutive lines join into one paragraph", input: "one\ntwo", check: (h) => h.includes("<p>one two</p>") },
  { name: "empty input", input: "", check: (h) => h.trim() === "" },
  { name: "undefined input", input: undefined as unknown as string, check: (h) => h.trim() === "" },
  {
    name: "a lone asterisk is left as text",
    input: "5 * 3 = 15",
    check: (h) => !h.includes("<em>") && h.includes("5 * 3 = 15"),
  },
  {
    name: "list and paragraph do not merge",
    input: "- one\n\nA paragraph.",
    check: (h) => h.includes("</ul>") && h.includes("<p>A paragraph.</p>"),
  },
];

let failed = 0;
for (const { name, input, check } of cases) {
  const html = renderToStaticMarkup(renderMarkdown(input));
  if (check(html)) {
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${html.slice(0, 200)}`);
  }
}

console.log(failed === 0 ? `\nAll ${cases.length} markdown cases pass.` : `\n${failed} of ${cases.length} FAILED.`);
process.exit(failed === 0 ? 0 : 1);
