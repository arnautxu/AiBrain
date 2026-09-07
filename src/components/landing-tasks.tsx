"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CalendarBlank, CaretRight, ListChecks, Presentation, Table } from "@phosphor-icons/react";
import type { LandingSuggestion } from "@/lib/landing-suggestions";
import { useMenuKeyboardNavigation } from "@/ui/use-menu-keyboard-navigation";

export function LandingTasks({ tasks, variant, disabled, onSelect }: {
  tasks: LandingSuggestion[];
  variant: "menu" | "suggestions" | "embedded";
  disabled: boolean;
  onSelect: (prompt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [schedule, setSchedule] = useState<LandingSuggestion | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const close = useCallback(() => {
    setOpen(false);
    setSchedule(null);
    requestAnimationFrame(() => openerRef.current?.focus());
  }, []);
  const onKeyDown = useMenuKeyboardNavigation(close);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) { setOpen(false); setSchedule(null); }
    };
    document.addEventListener("pointerdown", outside);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside); };
  }, [open, schedule]);
  const choose = (text: string) => {
    setOpen(false);
    setSchedule(null);
    onSelect(text);
  };
  const inMenu = variant !== "suggestions";
  const items = tasks.map((task) => {
    const Icon = task.id === "schedule" ? CalendarBlank : task.id === "spreadsheets" ? Table : Presentation;
    return <button key={task.id} type="button" role={inMenu ? "menuitem" : undefined} disabled={disabled}
      className="landing-task-item" aria-haspopup={task.children ? "menu" : undefined}
      aria-expanded={task.children ? open && schedule?.id === task.id : undefined}
      aria-controls={task.children && open && schedule?.id === task.id ? id : undefined}
      onClick={(event) => {
        if (task.children) {
          if (!inMenu) openerRef.current = event.currentTarget;
          setSchedule(task); setOpen(true);
        } else choose(task.prompt);
      }}><Icon size={17} aria-hidden="true" /><span>{task.label}</span>{task.children ? <CaretRight size={12} aria-hidden="true" /> : null}</button>;
  });
  return <div ref={rootRef} className={`landing-tasks landing-tasks-${variant}`}>
    {variant !== "suggestions" ? <button type="button" disabled={disabled} role={variant === "embedded" ? "menuitem" : undefined} tabIndex={variant === "embedded" ? -1 : undefined} className="landing-band-item" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={(event) => { openerRef.current = event.currentTarget; setSchedule(null); setOpen(!open); }}
      onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); openerRef.current = event.currentTarget; setOpen(true); } }}><ListChecks size={15} aria-hidden="true" />Tareas programadas</button> : items}
    {open ? <div ref={menuRef} id={id} role="menu" aria-label={schedule ? "Horarios del equipo" : "Tareas programadas"} className="landing-task-menu" onKeyDown={(event) => { event.stopPropagation(); onKeyDown(event); }}>
      {schedule ? <>{variant !== "suggestions" ? <button type="button" role="menuitem" className="landing-task-item" onClick={() => setSchedule(null)}>Volver a las tareas</button> : null}
        {schedule.children?.map((child) => <button key={child.id} type="button" role="menuitem" disabled={disabled} className="landing-task-item" onClick={() => choose(child.prompt)}>{child.label}</button>)}</> : items}
    </div> : null}
  </div>;
}
