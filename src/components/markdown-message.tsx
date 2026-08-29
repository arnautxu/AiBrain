"use client";

import { memo, useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownAstNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownAstNode[];
};

type MarkdownAstRoot = MarkdownAstNode & { children: MarkdownAstNode[] };

function createStreamCaretPlugin() {
  return () => (tree: MarkdownAstRoot) => {
    const appendCaret = (children: MarkdownAstNode[], literal = false): boolean => {
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const node = children[index];
        if (!node) continue;
        const isLiteral = literal || node.tagName === "code" || node.tagName === "pre";
        if (!isLiteral && node.children && appendCaret(node.children, false)) return true;
        if (!isLiteral && node.type === "text" && typeof node.value === "string" && /\S/u.test(node.value)) {
          children.splice(index, 1, node, {
            type: "element",
            tagName: "span",
            properties: { ariaHidden: "true", className: ["t-stream-caret"] },
            children: [],
          });
          return true;
        }
      }
      return false;
    };

    appendCaret(tree.children);
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

export const MarkdownMessage = memo(function MarkdownMessage({ children, streaming = false }: { children: string; streaming?: boolean }) {
  return (
    <div className={`markdown-body${streaming ? " t-stream" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={streaming ? [createStreamCaretPlugin()] : []}
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
});
