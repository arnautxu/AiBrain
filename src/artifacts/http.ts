import "server-only";

import { NextResponse } from "next/server";
import {
  AdvancedArtifactConflictError,
  AdvancedArtifactNotFoundError,
  AdvancedArtifactPersistenceError,
  AdvancedArtifactValidationError,
} from "@/artifacts/store";
import { operationalLogger } from "@/operations/server-logger";

export function advancedArtifactErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AdvancedArtifactNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof AdvancedArtifactValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof AdvancedArtifactConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof AdvancedArtifactPersistenceError) return NextResponse.json({ error: error.message }, { status: 503 });
  operationalLogger.error("advanced_artifact.request_failed", { error, fallback });
  return NextResponse.json({ error: fallback }, { status: 503 });
}
