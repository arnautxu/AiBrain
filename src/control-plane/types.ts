import type {
  AccentName,
  BrainManifest,
  BrainWindowId,
  CornerStyle,
  Density,
} from "@/config/brain";

export type ManifestEditorData = {
  productName: string;
  assistantName: string;
  role: string;
  welcomeTitle: string;
  welcomeMessage: string;
  accent: AccentName;
  density: Density;
  corners: CornerStyle;
  showActivityPanel: boolean;
  windows: Record<BrainWindowId, boolean>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function validText(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum;
}

export function isManifestEditorData(value: unknown): value is ManifestEditorData {
  if (!isRecord(value) || !isRecord(value.windows)) return false;
  return (
    validText(value.productName, 48) &&
    validText(value.assistantName, 32) &&
    validText(value.role, 80) &&
    validText(value.welcomeTitle, 90) &&
    validText(value.welcomeMessage, 280) &&
    (value.accent === "graphite" || value.accent === "blue" || value.accent === "violet") &&
    (value.density === "comfortable" || value.density === "compact") &&
    (value.corners === "soft" || value.corners === "rounded" || value.corners === "precise") &&
    typeof value.showActivityPanel === "boolean" &&
    value.windows.chat === true &&
    typeof value.windows.inspector === "boolean" &&
    typeof value.windows.runtime === "boolean"
  );
}

export function manifestToEditorData(manifest: BrainManifest): ManifestEditorData {
  const enabled = (id: BrainWindowId) =>
    manifest.windows.find((window) => window.id === id)?.enabled ?? false;
  return {
    productName: manifest.identity.productName,
    assistantName: manifest.identity.assistantName,
    role: manifest.identity.role,
    welcomeTitle: manifest.interface.welcomeTitle,
    welcomeMessage: manifest.interface.welcomeMessage,
    accent: manifest.interface.accent,
    density: manifest.interface.density,
    corners: manifest.interface.corners,
    showActivityPanel: manifest.interface.showActivityPanel,
    windows: {
      chat: true,
      inspector: enabled("inspector"),
      runtime: enabled("runtime"),
    },
  };
}
