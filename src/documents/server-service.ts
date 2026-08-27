import "server-only";

import path from "node:path";
import type { InstallationConfig } from "@/config/installation-schema";
import { FileDocumentPublisher } from "@/documents/document-publisher";
import { DocumentPreviewService, type DocumentToolchain } from "@/documents/preview-service";
import { FileDocumentStagingStore } from "@/documents/staging-store";
import { WorkerProvisioner } from "@/runtime/workers/provisioner";
import { ResourceLockManager } from "@/storage";

function configuredAbsolutePath(name: string, fallback: string) {
  const value = process.env[name]?.trim() || fallback;
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute executable path.`);
  return path.resolve(value);
}

export type ConfiguredDocumentToolchain = DocumentToolchain & { pdftotext: string };

export function documentToolchainFromEnvironment(): ConfiguredDocumentToolchain {
  const darwin = process.platform === "darwin";
  const qpdf = process.env.AIBRAIN_QPDF_BIN?.trim() ||
    (process.env.NODE_ENV === "production" ? "/usr/local/bin/aibrain-qpdf" : undefined);
  return {
    soffice: configuredAbsolutePath(
      "AIBRAIN_SOFFICE_BIN",
      darwin ? "/Applications/LibreOffice.app/Contents/MacOS/soffice" : "/usr/local/bin/aibrain-soffice",
    ),
    pdfinfo: configuredAbsolutePath(
      "AIBRAIN_PDFINFO_BIN",
      darwin ? "/opt/homebrew/bin/pdfinfo" : "/usr/local/bin/aibrain-pdfinfo",
    ),
    pdftoppm: configuredAbsolutePath(
      "AIBRAIN_PDFTOPPM_BIN",
      darwin ? "/opt/homebrew/bin/pdftoppm" : "/usr/local/bin/aibrain-pdftoppm",
    ),
    pdftotext: configuredAbsolutePath(
      "AIBRAIN_PDFTOTEXT_BIN",
      darwin ? "/opt/homebrew/bin/pdftotext" : "/usr/local/bin/aibrain-pdftotext",
    ),
    ...(qpdf ? { qpdf: configuredAbsolutePath("AIBRAIN_QPDF_BIN", qpdf) } : {}),
  };
}

export async function documentServicesForUser(
  installation: Readonly<InstallationConfig>,
  userId: string,
) {
  const manifest = await new WorkerProvisioner({ config: installation }).provision(userId);
  const stateRoot = path.join(manifest.roots.userRoot, "state");
  const locks = new ResourceLockManager({
    rootDirectory: path.join(stateRoot, ".locks", "documents"),
  });
  const staging = new FileDocumentStagingStore(manifest.roots.staging, locks);
  const toolchain = documentToolchainFromEnvironment();
  const previews = new DocumentPreviewService({
    stagingRoot: manifest.roots.staging,
    previewRoot: path.join(stateRoot, "document-previews"),
    lockManager: locks,
    tools: toolchain,
  });
  return { manifest, locks, staging, previews, toolchain };
}

function publicationSecret() {
  const secret = process.env.AIBRAIN_PUBLICATION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("AIBRAIN_PUBLICATION_SECRET must contain at least 32 bytes.");
  }
  return secret;
}

export async function documentPublisherForUser(
  installation: Readonly<InstallationConfig>,
  userId: string,
) {
  const services = await documentServicesForUser(installation, userId);
  const stateRoot = path.join(services.manifest.roots.userRoot, "state", "publications");
  return new FileDocumentPublisher({
    installationId: installation.installationId,
    userId,
    stagingRoot: services.manifest.roots.staging,
    publishWriteRoot: installation.paths.publishWriteRoot,
    stateRoot,
    workerVisibleRoots: [
      services.manifest.roots.runtimeRoot,
      services.manifest.roots.workspace,
      services.manifest.roots.staging,
      services.manifest.roots.artifacts,
      services.manifest.roots.browserRoot,
      installation.paths.companyContextRoot,
      installation.paths.sourceReadRoot,
    ],
    lockManager: services.locks,
    targetLockManager: new ResourceLockManager({
      rootDirectory: path.join(
        installation.paths.dataRoot,
        "locks",
        "document-publication-targets",
      ),
    }),
    confirmationSecret: publicationSecret(),
  });
}
