"use client";

import { useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

export function MarkdownMessage({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
