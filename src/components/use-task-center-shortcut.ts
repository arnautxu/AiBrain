"use client";

import { useEffect } from "react";

export const TASK_CENTER_SHORTCUT_ARIA = "Meta+Alt+U Control+Alt+U";

export function isTaskCenterShortcut(event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "metaKey">) {
  return (event.metaKey || event.ctrlKey) && event.altKey && event.code === "KeyU";
}

export function useTaskCenterShortcut(onToggle: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTaskCenterShortcut(event)) return;
      event.preventDefault();
      onToggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onToggle]);
}
