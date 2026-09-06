"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./sidebar.module.css";

const DitheringShader = dynamic(() => import("./ui/dithering-shader").then((module) => module.DitheringShader), { ssr: false });
const queries = [
  "(min-width: 768px)",
  "(prefers-reduced-transparency: reduce)",
  "(forced-colors: active)",
  "(prefers-contrast: more)",
  "(prefers-reduced-motion: reduce)",
  "(prefers-color-scheme: dark)",
];

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = queries.map((query) => window.matchMedia(query));
  media.forEach((query) => query.addEventListener("change", onChange));
  document.addEventListener("visibilitychange", onChange);
  const theme = new MutationObserver(onChange);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    media.forEach((query) => query.removeEventListener("change", onChange));
    document.removeEventListener("visibilitychange", onChange);
    theme.disconnect();
  };
}

function snapshot() {
  if (typeof window.matchMedia !== "function") return 0;
  const [desktop, transparency, forcedColors, contrast, reducedMotion, systemDark] = queries.map((query) => window.matchMedia(query).matches);
  const enabled = desktop && !transparency && !forcedColors && !contrast && document.visibilityState === "visible";
  const theme = document.documentElement.dataset.theme;
  const dark = theme === "dark" || (!theme && systemDark);
  return (enabled ? 1 : 0) | (reducedMotion ? 2 : 0) | (dark ? 4 : 0);
}

/** A bounded decorative footer; never mount a WebGL renderer in the mobile drawer. */
export function SidebarWave({ expanded }: { expanded: boolean }) {
  const environment = useSyncExternalStore(subscribe, snapshot, () => 0);
  const enabled = expanded && Boolean(environment & 1);
  const reducedMotion = Boolean(environment & 2);
  const dark = Boolean(environment & 4);
  const container = useRef<HTMLDivElement>(null);
  const supported = useRef<boolean | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!enabled || !container.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && supported.current === null) {
        // Paper throws on unavailable WebGL2. Probe before mounting so ordinary
        // navigation remains usable on software/locked-down browsers.
        try {
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("webgl2", { powerPreference: "low-power" });
          supported.current = Boolean(context);
          context?.getExtension("WEBGL_lose_context")?.loseContext();
        } catch {
          supported.current = false;
        }
      }
      setInView(entry.isIntersecting && supported.current === true);
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [enabled]);

  return (
    <div ref={container} aria-hidden="true" data-testid="sidebar-wave"
      data-motion={enabled && inView ? reducedMotion ? "static" : "moving" : "off"}
      className={styles.wave}>
      {enabled && inView ? (
        <DitheringShader shape="wave" type="8x8" pxSize={3} speed={reducedMotion ? 0 : 0.6} frame={1200}
          colorBack={dark ? "#071a2a" : "#bdd6e955"} colorFront={dark ? "#36749c" : "#3e78aa"}
          minPixelRatio={1} maxPixelCount={120000}
          webGlContextAttributes={{ antialias: false, powerPreference: "low-power" }} />
      ) : null}
    </div>
  );
}
