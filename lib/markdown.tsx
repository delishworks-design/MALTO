import React from "react";

/**
 * A very small markdown renderer for the legal documents.
 *
 * The privacy policy, the terms and the partner agreement are written by an
 * admin in Settings and shown to customers and to partners, so the output has
 * to be safe by construction rather than by trusting whoever typed it.
 *
 * Two decisions matter here. Nothing is ever passed through
 * dangerouslySetInnerHTML: the text is split into React children, which React
 * escapes, so there is no path from the editor to injected markup. And link
 * targets are checked against an allowlist of schemes, so a crafted
 * `javascript:` or `data:` URL cannot become a live link.
 *
 * Supported: `##` to `####` headings, `- ` bullets, `1. ` numbered lists,
 * `**bold**`, `*italic*`, and links. Anything else renders as the plain text it
 * is, which is the right outcome for legal copy that happens to contain an
 * asterisk or a stray bracket.
 */

/** Only these schemes may appear in a link target. */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) return null;
  // A target carrying whitespace, quotes or angle brackets cannot be expressed
  // as a plain URL, and is how an attribute would be broken out of.
  if (/[\s"'<>`\\]/.test(href)) return null;
  return href;
}

/**
 * Splits a line into React nodes, applying bold, italic and links. The plain
 * pieces stay plain strings so React escapes them; no HTML is ever assembled
 * by hand.
 */
function inline(text: string, keyBase: number): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = keyBase;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      nodes.push(<strong key={key++}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      nodes.push(<em key={key++}>{match[2]}</em>);
    } else if (match[3] !== undefined) {
      const href = safeHref(match[4]);
      // An unusable target falls back to the literal markdown, so the reader
      // sees what was written rather than a link that silently goes nowhere.
      if (href) nodes.push(<a key={key++} href={href} rel="noopener noreferrer">{match[3]}</a>);
      else nodes.push(match[0]);
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function renderMarkdown(src: string): React.ReactElement {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let key = 0;

  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushPara = () => {
    if (!para.length) return;
    out.push(<p key={key++}>{inline(para.join(" "), key++ * 1000)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.type;
    out.push(
      <Tag key={key++}>
        {list.items.map((it, i) => <li key={key++ * 1000 + i}>{inline(it, i * 1000)}</li>)}
      </Tag>
    );
    list = null;
  };
  const flushAll = () => { flushPara(); flushList(); };

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) { flushAll(); continue; }

    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = Math.min(heading[1].length, 4);
      const kids = inline(heading[2], key++ * 1000);
      if (level === 2) out.push(<h2 key={key++}>{kids}</h2>);
      else if (level === 3) out.push(<h3 key={key++}>{kids}</h3>);
      else out.push(<h4 key={key++}>{kids}</h4>);
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushPara();
      if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
      list.items.push(numbered[1]);
      continue;
    }

    flushList();
    para.push(line);
  }
  flushAll();

  return <>{out}</>;
}
