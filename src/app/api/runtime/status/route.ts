import path from "node:path";
import { NextResponse } from "next/server";
import { checkCodexConnection } from "@/runtime/codex-app-server";
import { readRuntimeConfig } from "@/runtime/config";
import type { RuntimeStatus } from "@/lib/runtime-status";
import { getSession } from "@/auth/session";
import { WorkbenchNotFoundError } from "@/workbench/errors";
import {
  getProjectRuntimeContext,
  isBrowserPreviewWorkbench,
} from "@/workbench/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  }
  const requestedProjectId = new URL(request.url).searchParams.get("projectId");
  let projectContext = {
    projectId: null as string | null,
    projectName: session.tenant.name,
    workspaceKey: "workspace",
  };
  if (requestedProjectId) {
    try {
      const stored = await getProjectRuntimeContext(session, requestedProjectId);
      projectContext = {
        projectId: stored.projectId,
        projectName: stored.projectName,
        workspaceKey: stored.workspaceKey,
      };
    } catch (error) {
      if (!isBrowserPreviewWorkbench() || !(error instanceof WorkbenchNotFoundError)) {
        return NextResponse.json({ error: "Projecte no trobat." }, { status: 404 });
      }
      projectContext = {
        projectId: requestedProjectId,
        projectName: "Preview local",
        workspaceKey: "workspace",
      };
    }
  }
  const config = readRuntimeConfig(session.tenant.id, projectContext.workspaceKey);
  let codex: RuntimeStatus["codex"] = config.mode === "codex" ? "unavailable" : "disabled";
  let authMode: RuntimeStatus["authMode"] = null;
  let planType: string | null = null;
  let processWarm = false;
  let rateLimit: RuntimeStatus["rateLimit"] = null;
  let usage: RuntimeStatus["usage"] = null;
  let models: RuntimeStatus["models"] = [];
  let skills: RuntimeStatus["skills"] = [];
  let webSearch = false;
  let imageGeneration = false;

  if (config.mode === "codex") {
    try {
      const connection = await checkCodexConnection(config);
      codex = connection.connected ? "connected" : "unavailable";
      authMode = connection.authMode;
      planType = connection.planType;
      processWarm = connection.processWarm;
      rateLimit = connection.rateLimit;
      usage = connection.usage;
      models = connection.models;
      skills = connection.skills;
      webSearch = connection.webSearch;
      imageGeneration = connection.imageGeneration;
    } catch {
      codex = "unavailable";
    }
  }

  const status: RuntimeStatus = {
    mode: config.mode,
    codex,
    isolated: Boolean(config.codexHome),
    ready: config.mode === "codex" && codex === "connected",
    authMode,
    planType,
    processWarm,
    rateLimit,
    usage,
    workspaceName: `${projectContext.projectName} / ${path.basename(config.workspace)}`,
    model: config.model,
    approvalPolicy: config.approvalPolicy,
    sandbox: config.sandbox,
    models,
    skills,
    capabilities: {
      webSearch,
      imageInput: models.some((model) => model.inputModalities.includes("image")),
      imageGeneration,
    },
    tenantId: session.tenant.id,
    projectId: projectContext.projectId,
    projectName: projectContext.projectName,
  };

  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
