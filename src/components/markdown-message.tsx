"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const STREAM_SETTLE_MS = 700;

function useStreamDecoration(streaming: boolean) {
  const [decorated, setDecorated] = useState(streaming);

  useEffect(() => {
    if (streaming && !decorated) {
      const frame = window.requestAnimationFrame(() => setDecorated(true));
      return () => window.cancelAnimationFrame(frame);
    }
    if (streaming || !decorated) return;

    const timer = window.setTimeout(() => setDecorated(false), STREAM_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [decorated, streaming]);

  return streaming || decorated;
}

type MarkdownAstNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownAstNode[];
};

type MarkdownAstRoot = MarkdownAstNode & { children: MarkdownAstNode[] };

function createStreamWordsPlugin(streaming: boolean) {
  return () => (tree: MarkdownAstRoot) => {
    const countWords = (children: MarkdownAstNode[], literal = false): number => children.reduce((total, node) => {
      const isLiteral = literal || node.tagName === "code" || node.tagName === "pre";
      if (node.type === "text" && !isLiteral && typeof node.value === "string") {
        return total + (node.value.match(/\S+/g)?.length ?? 0);
      }
      return total + (node.children ? countWords(node.children, isLiteral) : 0);
    }, 0);

    const wordCount = countWords(tree.children);
    let wordIndex = 0;

    const transformChildren = (children: MarkdownAstNode[], literal = false): MarkdownAstNode[] => children.flatMap<MarkdownAstNode>((node): MarkdownAstNode | MarkdownAstNode[] => {
      const isLiteral = literal || node.tagName === "code" || node.tagName === "pre";

      if (node.type === "text" && !isLiteral && typeof node.value === "string") {
        return node.value.split(/(\s+)/).filter(Boolean).flatMap<MarkdownAstNode>((part) => {
          if (/^\s+$/.test(part)) return { type: "text", value: part };

          const fresh = streaming && wordCount - wordIndex <= 2;
          const last = streaming && wordIndex === wordCount - 1;
          const word: MarkdownAstNode = {
            type: "element",
            tagName: "span",
            properties: { className: ["t-stream-w", fresh ? "is-fresh" : "is-settled"] },
            children: [{ type: "text", value: part }],
          };
          wordIndex += 1;
          if (!last) return word;
          return [word, {
            type: "element",
            tagName: "span",
            properties: { ariaHidden: "true", className: ["t-stream-caret"] },
            children: [],
          }];
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
  const decorated = useStreamDecoration(streaming);

  return (
    <div className={`markdown-body${streaming ? " t-stream" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={decorated ? [createStreamWordsPlugin(streaming)] : []}
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
