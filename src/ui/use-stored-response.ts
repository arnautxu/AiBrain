"use client";
import { useEffect, useState } from "react";
import { isWorkbenchThread, type WorkbenchThread } from "@/workbench/types";
import type { ChatMessage } from "@/lib/chat-contract";

/** Read-only reconciliation after refresh or a detached client. Never starts a turn. */
export function useStoredResponse({ thread, enabled, attached, online, retry, onSnapshot }: {
  thread: WorkbenchThread | null; enabled: boolean; attached: boolean; online: boolean;
  retry: number; onSnapshot: (threadId: string, message: ChatMessage) => void;
}) {
  const threadId = thread?.id;
  const projectId = thread?.projectId;
  const messageId = thread?.messages.findLast(message => message.role === "assistant" && message.status === "streaming")?.id;
  const key = JSON.stringify([threadId, messageId, online, retry]);
  const [pausedKey, setPausedKey] = useState<string | null>(null);
  const active = enabled && Boolean(threadId && messageId) && !attached;
  useEffect(() => {
    if (!active || !online || !threadId || !messageId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | null = null;
    const started = Date.now();
    const check = async () => {
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 8_000);
      try {
        const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}`, { cache: "no-store", signal: request.signal });
        if (disposed) return;
        if (response.status === 401 || response.status === 403 || response.status === 404) { setPausedKey(key); return; }
        if (!response.ok) throw new Error("Snapshot unavailable");
        const payload: unknown = await response.json();
        if (disposed) return;
        const stored = payload && typeof payload === "object" && "thread" in payload ? payload.thread : null;
        if (!isWorkbenchThread(stored) || stored.id !== threadId || stored.projectId !== projectId) throw new Error("Invalid snapshot identity");
        const message = stored.messages.find(item => item.id === messageId && item.role === "assistant");
        if (message) {
          onSnapshot(threadId, message);
          if (message.status !== "streaming") return;
        }
      } catch {
        // A failed read cannot change the persisted turn to failed/stopped.
      } finally {
        clearTimeout(timeout);
      }
      if (disposed) return;
      if (Date.now() - started >= 60_000) { setPausedKey(key); return; }
      timer = setTimeout(() => { void check(); }, 2_000);
    };
    void check();
    return () => { disposed = true; clearTimeout(timer); request?.abort(); };
  }, [active, online, threadId, projectId, messageId, retry, onSnapshot, key]);
  return active ? pausedKey === key ? "paused" : "checking" : null;
}
