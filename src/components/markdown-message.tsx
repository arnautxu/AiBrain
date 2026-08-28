"use client";

import { Children, useEffect, useRef, useState, type ReactNode } from "react";
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
  const wordCountRef = useRef(wordCount);
  const [visibleWordCount, setVisibleWordCount] = useState(() => streaming ? 0 : wordCount);

  wordCountRef.current = wordCount;

  useEffect(() => {
    if (!streaming) {
      setVisibleWordCount(wordCount);
      return;
    }

    const timer = window.setInterval(() => {
      setVisibleWordCount((current) => current < wordCountRef.current ? current + 1 : current);
    }, getStreamGapMs());

    return () => window.clearInterval(timer);
  }, [streaming]);

  return visibleWordCount;
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
  let wordIndex = 0;

  const streamWords = (content: ReactNode) => Children.toArray(content).map((child, childIndex) => {
    if (typeof child !== "string" || !streaming) return child;

    return child.split(/(\s+)/).map((part, partIndex) => {
      if (!part || /^\s+$/.test(part)) return part;

      const index = wordIndex;
      wordIndex += 1;
      return (
        <span key={`${childIndex}-${partIndex}-${index}`} className={`t-stream-w${index < visibleWordCount ? " is-in" : ""}`}>
          {part}
        </span>
      );
    });
  });

  return (
    <div className={`markdown-body${streaming ? " t-stream" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children: label, ...props }) => <a {...props} target="_blank" rel="noreferrer">{streamWords(label)}</a>,
          blockquote: ({ children: content }) => <blockquote>{streamWords(content)}</blockquote>,
          del: ({ children: content }) => <del>{streamWords(content)}</del>,
          em: ({ children: content }) => <em>{streamWords(content)}</em>,
          h1: ({ children: content }) => <h1>{streamWords(content)}</h1>,
          h2: ({ children: content }) => <h2>{streamWords(content)}</h2>,
          h3: ({ children: content }) => <h3>{streamWords(content)}</h3>,
          h4: ({ children: content }) => <h4>{streamWords(content)}</h4>,
          li: ({ children: content }) => <li>{streamWords(content)}</li>,
          p: ({ children: content }) => <p>{streamWords(content)}</p>,
          pre: ({ children: content }) => <>{content}</>,
          code: ({ className, children: content, ...props }) => {
            const value = String(content).replace(/\n$/, "");
            const language = /language-([\w-]+)/.exec(className ?? "")?.[1] ?? null;
            const block = Boolean(className) || value.includes("\n");
            return block
              ? <CodeBlock language={language} value={value} />
              : <code className={className} {...props}>{content}</code>;
          },
          strong: ({ children: content }) => <strong>{streamWords(content)}</strong>,
          table: ({ children: content }) => <div className="markdown-table-wrap"><table>{content}</table></div>,
          td: ({ children: content }) => <td>{streamWords(content)}</td>,
          th: ({ children: content }) => <th>{streamWords(content)}</th>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
