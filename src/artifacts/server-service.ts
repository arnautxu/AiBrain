import "server-only";

import path from "node:path";
import type { AuthSession } from "@/auth/types";
import type { CreateAdvancedArtifactInput, CreateAdvancedArtifactVersionInput } from "@/artifacts/contracts";
import { visualizationSpecFromMarkdown } from "@/artifacts/contracts";
import { contentHash } from "@/artifacts/content-hash";
import { internalSiteFromMessage, sanitizeInternalSiteHtml } from "@/artifacts/rendering";
import { AdvancedArtifactValidationError, FileAdvancedArtifactStore } from "@/artifacts/store";
import { loadInstallationConfig } from "@/config/installation";
import type { ChatMessage } from "@/lib/chat-contract";
import { getThread } from "@/workbench/store";

export async function advancedArtifactStoreForSession(session: AuthSession) {
  const installation = await loadInstallationConfig();
  if (session.provider === "local" && session.tenant.id !== installation.installationId) {
    throw new AdvancedArtifactValidationError("La sesión no pertenece a esta instalación.");
  }
  if (session.provider === "local") {
    return new FileAdvancedArtifactStore({
      installationId: installation.installationId,
      rootDirectory: installation.paths.usersRoot,
    });
  }
  return new FileAdvancedArtifactStore({
    installationId: installation.installationId,
    rootDirectory: path.join(installation.paths.dataRoot, "demo-advanced-artifacts", session.tenant.id),
    autoProvisionUsers: true,
  });
}

async function sourceMessage(session: AuthSession, threadId: string, messageId: string) {
  const thread = await getThread(session, threadId);
  const message = thread.messages.find((candidate) => candidate.id === messageId);
  if (!message || message.role !== "assistant" || message.status !== "complete" || !message.content.trim()) {
    throw new AdvancedArtifactValidationError("Selecciona una respuesta completa con contenido real.");
  }
  return { thread, message };
}

function source(thread: Awaited<ReturnType<typeof getThread>>, message: ChatMessage) {
  return {
    projectId: thread.projectId,
    threadId: thread.id,
    messageId: message.id,
    messageSha256: contentHash(message.content),
  };
}

function content(kind: "visualization" | "internal-site", message: ChatMessage, input: { spec?: CreateAdvancedArtifactInput["spec"]; html?: string }, title: string) {
  if (kind === "visualization") {
    const spec = input.spec ?? visualizationSpecFromMarkdown(message.content, title);
    if (!spec) {
      throw new AdvancedArtifactValidationError("Esta respuesta no contiene una tabla numérica que se pueda visualizar sin inventar datos.");
    }
    return { kind, spec } as const;
  }
  const html = input.html === undefined ? internalSiteFromMessage(message.content) : sanitizeInternalSiteHtml(input.html);
  if (!html.trim()) throw new AdvancedArtifactValidationError("El contenido del sitio interno queda vacío después del saneado.");
  return { kind, html } as const;
}

export async function createAdvancedArtifact(session: AuthSession, input: CreateAdvancedArtifactInput) {
  const { thread, message } = await sourceMessage(session, input.threadId, input.messageId);
  const store = await advancedArtifactStoreForSession(session);
  return store.create(session.user.id, {
    title: input.title.trim(), source: source(thread, message),
    content: content(input.kind, message, input, input.title.trim()),
  });
}

export async function createAdvancedArtifactVersion(
  session: AuthSession,
  artifactId: string,
  input: CreateAdvancedArtifactVersionInput,
) {
  const store = await advancedArtifactStoreForSession(session);
  const current = await store.get(session.user.id, artifactId);
  const { thread, message } = await sourceMessage(session, input.threadId, input.messageId);
  return store.createVersion(session.user.id, artifactId, {
    source: source(thread, message),
    content: content(current.summary.kind, message, input, current.summary.title),
  });
}
