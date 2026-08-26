export type AccentName = "graphite" | "blue" | "violet";
export type Density = "comfortable" | "compact";
export type CornerStyle = "soft" | "rounded" | "precise";
export type BrainWindowId = "chat" | "inspector" | "runtime";

export type BrainWindow = {
  id: BrainWindowId;
  label: string;
  enabled: boolean;
};

export type ComposerCapability = {
  images: boolean;
  imageGeneration: boolean;
  modelSelection: boolean;
  webSearch: boolean;
  skills: boolean;
  modes: ("agent" | "plan" | "ask")[];
};

export type BrainManifest = {
  id: string;
  version: number;
  identity: {
    productName: string;
    assistantName: string;
    role: string;
    language: "ca" | "es" | "en";
    tone: "direct" | "balanced" | "detailed";
  };
  interface: {
    welcomeTitle: string;
    welcomeMessage: string;
    accent: AccentName;
    density: Density;
    corners: CornerStyle;
    showInspector: boolean;
    showActivityPanel: boolean;
  };
  behavior: {
    conversationMemory: boolean;
    approvalMode: "interactive" | "never";
  };
  runtime: {
    adapter: "local_demo" | "codex_app_server";
    transport: "stdio";
  };
  composer: ComposerCapability;
  windows: BrainWindow[];
};

export type BrainPreferences = Pick<
  BrainManifest["identity"],
  "assistantName" | "tone"
> &
  Pick<
    BrainManifest["interface"],
    "accent" | "density" | "corners" | "showInspector" | "showActivityPanel"
  > &
  Pick<BrainManifest["behavior"], "conversationMemory">;

export function preferencesFromManifest(manifest: BrainManifest): BrainPreferences {
  return {
    assistantName: manifest.identity.assistantName,
    tone: manifest.identity.tone,
    accent: manifest.interface.accent,
    density: manifest.interface.density,
    corners: manifest.interface.corners,
    showInspector: manifest.interface.showInspector,
    showActivityPanel: manifest.interface.showActivityPanel,
    conversationMemory: manifest.behavior.conversationMemory,
  };
}

export const baseBrainManifest: BrainManifest = {
  id: "aibrain-studio",
  version: 3,
  identity: {
    productName: "Example Brain",
    assistantName: "Brain",
    role: "Asistente de trabajo",
    language: "es",
    tone: "balanced",
  },
  interface: {
    welcomeTitle: "¿En qué trabajamos?",
    welcomeMessage:
      "Describe el resultado que necesitas y revisa el progreso sin salir de la conversación.",
    accent: "blue",
    density: "comfortable",
    corners: "soft",
    showInspector: true,
    showActivityPanel: true,
  },
  behavior: {
    conversationMemory: true,
    approvalMode: "interactive",
  },
  runtime: {
    adapter: "codex_app_server",
    transport: "stdio",
  },
  composer: {
    images: true,
    imageGeneration: true,
    modelSelection: true,
    webSearch: true,
    skills: true,
    modes: ["agent", "plan", "ask"],
  },
  windows: [
    { id: "chat", label: "Workbench", enabled: true },
    { id: "inspector", label: "Review", enabled: true },
    { id: "runtime", label: "Runtime", enabled: true },
  ],
};

export const operationsBrainManifest: BrainManifest = {
  id: "aibrain-operations",
  version: 3,
  identity: {
    productName: "Northwind Brain",
    assistantName: "Brain",
    role: "Asistente de operaciones",
    language: "es",
    tone: "direct",
  },
  interface: {
    welcomeTitle: "¿Qué resolvemos hoy?",
    welcomeMessage:
      "Coordina incidencias y cambios con un historial claro y decisiones explícitas.",
    accent: "blue",
    density: "compact",
    corners: "precise",
    showInspector: true,
    showActivityPanel: true,
  },
  behavior: {
    conversationMemory: true,
    approvalMode: "interactive",
  },
  runtime: {
    adapter: "codex_app_server",
    transport: "stdio",
  },
  composer: {
    images: true,
    imageGeneration: true,
    modelSelection: true,
    webSearch: true,
    skills: true,
    modes: ["agent", "plan", "ask"],
  },
  windows: [
    { id: "chat", label: "Operacions", enabled: true },
    { id: "inspector", label: "Traça", enabled: true },
    { id: "runtime", label: "Entorn", enabled: true },
  ],
};

export const defaultPreferences = preferencesFromManifest(baseBrainManifest);

export const accentTokens: Record<
  AccentName,
  { solid: string; soft: string; contrast: string }
> = {
  graphite: { solid: "#171717", soft: "#ecebea", contrast: "#ffffff" },
  blue: { solid: "#315ee7", soft: "#e9efff", contrast: "#ffffff" },
  violet: { solid: "#7656d8", soft: "#f0ebff", contrast: "#ffffff" },
};

export const cornerTokens: Record<CornerStyle, string> = {
  soft: "12px",
  rounded: "20px",
  precise: "5px",
};
