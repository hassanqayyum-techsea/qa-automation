"use client";

import type { ReactNode } from "react";
import { Heading } from "@your-job-search-genius/odyssey-ui/components/base/typography/heading";
import { Body2 } from "@your-job-search-genius/odyssey-ui/components/base/typography/body-2";
import { Strong } from "@your-job-search-genius/odyssey-ui/components/base/typography/strong";
import type { ParseResult } from "~/lib/testdsl";

/** `code` and **bold**, the only inline Markdown test notes use. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
      <span key={i} className="rounded-sm bg-secondary px-1 font-mono text-sm">{part.slice(1, -1)}</span>
    ) : part.startsWith("**") && part.endsWith("**") && part.length > 3 ? (
      <Strong key={i}>{part.slice(2, -2)}</Strong>
    ) : (
      part
    ),
  );
}

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "note"; text: string }
  | { kind: "code"; text: string }
  | { kind: "steps"; items: { n: number | null; text: string; error: string | null }[] };

/** Rendered view of the test: headings and notes as text, list items as numbered steps, invalid lines flagged. */
export function TestPreview({ markdown, parsed }: { markdown: string; parsed: ParseResult }) {
  const stepNo = new Map(parsed.steps.map((s, i) => [s.line, i + 1]));
  const errorAt = new Map(parsed.errors.map((e) => [e.line, e.message]));
  const blocks: Block[] = [];
  let fence: string[] | null = null;
  markdown.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (s.startsWith("```")) {
      if (fence) blocks.push({ kind: "code", text: fence.join("\n") });
      fence = fence ? null : [];
      return;
    }
    if (fence) return void fence.push(raw);
    if (!s) return;
    const h = s.match(/^(#{1,3})\s+(.+)$/);
    if (h) return void blocks.push({ kind: "heading", level: h[1].length as 1 | 2 | 3, text: h[2] });
    const item = s.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (item) {
      const entry = { n: stepNo.get(line) ?? null, text: item[1], error: errorAt.get(line) ?? null };
      const prev = blocks.at(-1);
      if (prev?.kind === "steps") prev.items.push(entry);
      else blocks.push({ kind: "steps", items: [entry] });
      return;
    }
    blocks.push({ kind: "note", text: s });
  });

  if (!blocks.length) return <Body2>Nothing to preview yet. Write the test on the Write tab.</Body2>;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-secondary p-4">
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          return (
            <Heading key={i} level={(b.level + 2) as 3 | 4 | 5} size={b.level === 1 ? 5 : 6}>
              {inline(b.text)}
            </Heading>
          );
        }
        if (b.kind === "note") return <Body2 key={i}>{inline(b.text)}</Body2>;
        if (b.kind === "code") return <span key={i} className="block whitespace-pre-wrap rounded-md bg-secondary p-3 font-mono text-sm">{b.text}</span>;
        return (
          <div key={i} role="list" aria-label="Steps" className="flex flex-col gap-2">
            {b.items.map((it, j) => (
              <div key={j} role="listitem" className="flex min-w-0 gap-3">
                <span className="w-6 shrink-0 text-right font-mono text-sm text-tertiary">{it.n ?? "!"}</span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-mono text-sm text-primary wrap-anywhere">{it.text}</span>
                  {it.error && <span className="text-sm text-error-primary">{it.error}</span>}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
