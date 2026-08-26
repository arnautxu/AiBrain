"use client";

import Image from "next/image";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes } from "react";
import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { useTheme } from "@/components/theme-provider";
import type { PublicInstallationBranding } from "@/ui/installation-branding";
import type { ThemePreference } from "@/ui/theme";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function BrandMark({
  branding,
  compact = false,
  className,
}: {
  branding: PublicInstallationBranding;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={compact ? branding.productName : `${branding.productName}, ${branding.companyName}`}
      className={classes("ui-brand", compact && "ui-brand-compact", className)}
    >
      <Image
        priority
        src={branding.faviconPath}
        alt=""
        width={40}
        height={40}
        className="ui-brand-image"
      />
      {!compact ? <span className="ui-brand-name">{branding.productName}</span> : null}
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button type={type} className={classes("ui-button", `ui-button-${variant}`, `ui-button-${size}`, className)} {...props} />;
}

export function IconButton({
  label,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type={type} aria-label={label} title={label} className={classes("ui-icon-button", className)} {...props} />;
}

export function Surface({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classes("ui-surface", className)} {...props} />;
}

export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "positive" | "warning" | "danger" }) {
  return <span className={classes("ui-badge", `ui-badge-${tone}`, className)} {...props} />;
}

export function TextField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={classes("ui-text-field", className)} {...props} />;
}

export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const options: Array<{ value: ThemePreference; label: string; icon: React.ReactNode }> = [
    { value: "system", label: "Tema del sistema", icon: <Desktop size={14} /> },
    { value: "light", label: "Tema claro", icon: <Sun size={14} /> },
    { value: "dark", label: "Tema oscuro", icon: <Moon size={14} /> },
  ];
  const activeIndex = options.findIndex((option) => option.value === preference);
  const next = options[(activeIndex + 1) % options.length] ?? options[0];
  const active = options[activeIndex] ?? options[0];
  return (
    <IconButton
      className={className}
      label={`${active.label}. Cambiar a ${next.label.toLocaleLowerCase("es")}`}
      onClick={() => setPreference(next.value)}
    >
      {active.icon}
    </IconButton>
  );
}
