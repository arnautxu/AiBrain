"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const STREAM_GAP_FALLBACK_MS = 60;

function getStreamGapMs() {
  const value = window.getComputedStyle(document.documentElement).getPropertyValue("--stream-gap").trim();
  if (value.endsWith("ms")) return Number.parseFloat(value) || STREAM_GAP_FALLBACK_MS;
  if (value.endsWith("s")) return (Number.parseFloat(value) || STREAM_GAP_FALLBACK_MS / 1000) * 1000;
  return STREAM_GAP_FALLBACK_MS;
}

function countWords(content: string) {
  return content.match(/\S+/g)?.length ?? 0;
}

function useVisibleStreamWords(content: string, streaming: boolean) {
  const wordCount = countWords(content);
  const [visibleWordCount, setVisibleWordCount] = useState(() => streaming ? 0 : wordCount);

  useEffect(() => {
    if (!streaming) return;

    const timer = window.setInterval(() => {
      setVisibleWordCount((current) => current < wordCount ? current + 1 : current);
    }, getStreamGapMs());

    return () => window.clearInterval(timer);
  }, [streaming, wordCount]);

  return visibleWordCount;
}

type MarkdownAstNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownAstNode[];
};

type MarkdownAstRoot = MarkdownAstNode & { children: MarkdownAstNode[] };

function createStreamWordsPlugin(visibleWordCount: number) {
  return () => (tree: MarkdownAstRoot) => {
    let wordIndex = 0;

    const transformChildren = (children: MarkdownAstNode[], literal = false): MarkdownAstNode[] => children.flatMap<MarkdownAstNode>((node): MarkdownAstNode | MarkdownAstNode[] => {
      const isLiteral = literal || node.tagName === "code" || node.tagName === "pre";

      if (node.type === "text" && !isLiteral && typeof node.value === "string") {
        return node.value.split(/(\s+)/).filter(Boolean).map((part) => {
          if (/^\s+$/.test(part)) return { type: "text", value: part };

          const className = wordIndex < visibleWordCount ? ["t-stream-w", "is-in"] : ["t-stream-w"];
          wordIndex += 1;
          return {
            type: "element",
            tagName: "span",
            properties: { className },
            children: [{ type: "text", value: part }],
          };
        });
      }

      if (node.children) node.children = transformChildren(node.children, isLiteral);
      return node;
    });

    tree.children = transformChildren(tree.children);
  };
}

function CodeBlock({ language, value }: { language: string | null; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <figure className="markdown-code">
      <figcaption>
        <span>{language ?? "texto"}</span>
        <button type="button" aria-label="Copiar bloque de código" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copiado" : "Copiar"}</button>
      </figcaption>
      <pre><code>{value}</code></pre>
    </figure>
  );
}

export function MarkdownMessage({ children, streaming = false }: { children: string; streaming?: boolean }) {
  const visibleWordCount = useVisibleStreamWords(children, streaming);

  return (
    <div className={`markdown-body${streaming ? " t-stream" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={streaming ? [createStreamWordsPlugin(visibleWordCount)] : []}
        components={{
          a: ({ children: label, ...props }) => <a {...props} target="_blank" rel="noreferrer">{label}</a>,
          pre: ({ children: content }) => <>{content}</>,
          code: ({ className, children: content, ...props }) => {
            const value = String(content).replace(/\n$/, "");
            const language = /language-([\w-]+)/.exec(className ?? "")?.[1] ?? null;
            const block = Boolean(className) || value.includes("\n");
            return block
              ? <CodeBlock language={language} value={value} />
              : <code className={className} {...props}>{content}</code>;
          },
          table: ({ children: content }) => <div className="markdown-table-wrap"><table>{content}</table></div>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
