"use client";

import type { ComponentProps } from "react";
import { MousePointer2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { field, mono, paper } from "@/lib/surfaces";
import { at, indexIn } from "@/lib/range";

export interface ComputerStep {
  id: string;
  action: string;
  target: string;
  x: number;
  y: number;
}

export interface ComputerCursorPosition {
  x: number;
  y: number;
}

export function ComputerUseTrail({
  steps,
  activeIndex,
  cursor,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  steps: readonly ComputerStep[];
  activeIndex: number;
  cursor?: ComputerCursorPosition | null;
}) {
  const index = indexIn(steps, activeIndex);
  const active = at(steps, index);
  const trail = steps.slice(Math.max(0, index - 2), index + 1);
  const currentCursor = cursor ?? active;

  return (
    <div
      data-slot="computer-use-trail"
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 z-10 overflow-hidden", className)}
      {...props}
    >
      {trail.map((step, trailIndex) => (
        <span
          key={step.id}
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500 transition-opacity duration-300 dark:bg-blue-400"
          style={{
            left: `${step.x}%`,
            top: `${step.y}%`,
            opacity: 0.18 * (trailIndex + 1),
          }}
        />
      ))}

      {currentCursor ? (
        <MousePointer2Icon
          className="absolute size-4 fill-blue-500 text-blue-500 drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)] transition-[left,top] duration-500 ease-out motion-reduce:transition-none dark:fill-blue-400 dark:text-blue-400"
          style={{ left: `${currentCursor.x}%`, top: `${currentCursor.y}%` }}
        />
      ) : null}
    </div>
  );
}

export function ComputerUse({
  url,
  steps,
  activeIndex,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "url" | "steps" | "activeIndex" | "children"> & {
  url: string;
  steps: readonly ComputerStep[];
  activeIndex: number;
  children: React.ReactNode;
}) {
  const index = indexIn(steps, activeIndex);
  const active = at(steps, index);

  return (
    <div
      data-slot="computer-use"
      className={cn(
        paper,
        "flex w-full max-w-md flex-col overflow-hidden rounded-2xl",
        className,
      )}

      {...props}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex shrink-0 gap-1">
          {["bg-red-500/50", "bg-amber-500/50", "bg-emerald-500/50"].map(
            (tint) => (
              <span
                key={tint}
                aria-hidden
                className={cn("size-2 rounded-full", tint)}
              />
            ),
          )}
        </span>
        <span
          className={cn(
            field,
            mono,
            "text-foreground/45 min-w-0 flex-1 truncate rounded-full px-2.5 py-1",
          )}
        >
          {url}
        </span>
      </div>

      <div className="border-foreground/[0.07] relative min-h-[8.5rem] overflow-hidden border-t">
        {children}
        <ComputerUseTrail steps={steps} activeIndex={activeIndex} />
      </div>

      {active && (
        <div className="border-foreground/[0.07] flex items-center gap-2 border-t px-3.5 py-2">
          <span className={cn(mono, "text-foreground/55 shrink-0")}>
            {active.action}
          </span>
          <span className="text-foreground/80 min-w-0 flex-1 truncate text-[13px]">
            {active.target}
          </span>
          <span
            className={cn(mono, "text-foreground/30 shrink-0 tabular-nums")}
          >
            {index + 1}/{steps.length}
          </span>
        </div>
      )}
    </div>
  );
}
