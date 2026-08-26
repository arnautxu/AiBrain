import path from "node:path";

export const INSTALLATION_CONFIG_SCHEMA_VERSION = 1 as const;

export type InstallationBranding = {
  productName: string;
  logoPath: string;
  faviconPath: string;
  accentColor: string;
};

export type InstallationPaths = {
  dataRoot: string;
  companyContextRoot: string;
  usersRoot: string;
  sourceReadRoot: string;
  publishWriteRoot: string;
  backupsRoot: string;
};

export type InstallationConfig = {
  schemaVersion: typeof INSTALLATION_CONFIG_SCHEMA_VERSION;
  installationId: string;
  companyName: string;
  companySlug: string;
  publicUrl: string;
  branding: InstallationBranding;
  paths: InstallationPaths;
};

export type InstallationConfigIssue = {
  path: string;
  message: string;
};

export class InstallationConfigValidationError extends Error {
  readonly issues: readonly InstallationConfigIssue[];

  constructor(issues: readonly InstallationConfigIssue[]) {
    super(`InstallationConfig no válido:\n${issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")}`);
    this.name = "InstallationConfigValidationError";
    this.issues = issues;
  }
}

const ROOT_KEYS = [
  "schemaVersion",
  "installationId",
  "companyName",
  "companySlug",
  "publicUrl",
  "branding",
  "paths",
] as const;

const BRANDING_KEYS = ["productName", "logoPath", "faviconPath", "accentColor"] as const;

const PATH_KEYS = [
  "dataRoot",
  "companyContextRoot",
  "usersRoot",
  "sourceReadRoot",
  "publishWriteRoot",
  "backupsRoot",
] as const;

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MAX_CONFIG_STRING_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addUnknownKeyIssues(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  currentPath: string,
  issues: InstallationConfigIssue[],
) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({ path: `${currentPath}.${key}`, message: "campo desconocido" });
    }
  }
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  currentPath: string,
  issues: InstallationConfigIssue[],
  maximumLength = MAX_CONFIG_STRING_LENGTH,
) {
  const value = record[key];
  const issuePath = `${currentPath}.${key}`;
  if (typeof value !== "string") {
    issues.push({ path: issuePath, message: "debe ser un string" });
    return "";
  }
  if (value.length === 0) {
    issues.push({ path: issuePath, message: "no puede estar vacío" });
  } else if (value.trim() !== value) {
    issues.push({ path: issuePath, message: "no puede empezar ni terminar con espacios" });
  } else if (value.length > maximumLength) {
    issues.push({ path: issuePath, message: `supera el máximo de ${maximumLength} caracteres` });
  } else if (/\p{C}/u.test(value)) {
    issues.push({ path: issuePath, message: "contiene caracteres de control" });
  }
  return value;
}

function validateIdentifier(
  value: string,
  issuePath: string,
  issues: InstallationConfigIssue[],
) {
  if (value.length < 2 || value.length > 63 || !IDENTIFIER_PATTERN.test(value)) {
    issues.push({
      path: issuePath,
      message: "debe tener 2–63 caracteres en minúscula, empezar por letra y usar solo letras, números o guiones simples",
    });
  }
}

function validatePublicUrl(
  value: string,
  issuePath: string,
  issues: InstallationConfigIssue[],
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push({ path: issuePath, message: "debe ser una URL absoluta válida" });
    return value;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    issues.push({ path: issuePath, message: "solo se permiten URLs HTTP o HTTPS" });
  }
  if (url.username || url.password) {
    issues.push({ path: issuePath, message: "no puede contener credenciales" });
  }
  if (url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    issues.push({ path: issuePath, message: "debe ser un origen sin path, query ni fragmento" });
  }
  const localHostnames = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (url.protocol === "http:" && !localHostnames.has(url.hostname)) {
    issues.push({ path: issuePath, message: "HTTP solo está permitido para localhost" });
  }
  return url.origin;
}

function validatePublicAssetPath(
  value: string,
  issuePath: string,
  issues: InstallationConfigIssue[],
) {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("%") ||
    path.posix.normalize(value) !== value
  ) {
    issues.push({
      path: issuePath,
      message: "debe ser un path público absoluto, normalizado y sin query, fragmento ni escapes",
    });
  }
}

function validateFilesystemPath(
  value: string,
  issuePath: string,
  issues: InstallationConfigIssue[],
) {
  if (!path.posix.isAbsolute(value)) {
    issues.push({ path: issuePath, message: "debe ser una ruta POSIX absoluta" });
    return;
  }
  if (value === "/") {
    issues.push({ path: issuePath, message: "no puede apuntar a la raíz del servidor" });
  }
  if (path.posix.normalize(value) !== value) {
    issues.push({ path: issuePath, message: "debe estar normalizada y no terminar en /" });
  }
}

function isStrictDescendant(parent: string, candidate: string) {
  const relative = path.posix.relative(parent, candidate);
  return relative.length > 0 && relative !== ".." && !relative.startsWith("../") && !path.posix.isAbsolute(relative);
}

function parseBranding(
  value: unknown,
  issues: InstallationConfigIssue[],
): InstallationBranding {
  if (!isRecord(value)) {
    issues.push({ path: "$.branding", message: "debe ser un objeto" });
    return { productName: "", logoPath: "", faviconPath: "", accentColor: "" };
  }
  addUnknownKeyIssues(value, BRANDING_KEYS, "$.branding", issues);
  const productName = readRequiredString(value, "productName", "$.branding", issues, 80);
  const logoPath = readRequiredString(value, "logoPath", "$.branding", issues, 300);
  const faviconPath = readRequiredString(value, "faviconPath", "$.branding", issues, 300);
  const accentColor = readRequiredString(value, "accentColor", "$.branding", issues, 7);
  validatePublicAssetPath(logoPath, "$.branding.logoPath", issues);
  validatePublicAssetPath(faviconPath, "$.branding.faviconPath", issues);
  if (!HEX_COLOR_PATTERN.test(accentColor)) {
    issues.push({ path: "$.branding.accentColor", message: "debe usar el formato hexadecimal #RRGGBB" });
  }
  return { productName, logoPath, faviconPath, accentColor: accentColor.toLowerCase() };
}

function parsePaths(value: unknown, issues: InstallationConfigIssue[]): InstallationPaths {
  const emptyPaths: InstallationPaths = {
    dataRoot: "",
    companyContextRoot: "",
    usersRoot: "",
    sourceReadRoot: "",
    publishWriteRoot: "",
    backupsRoot: "",
  };
  if (!isRecord(value)) {
    issues.push({ path: "$.paths", message: "debe ser un objeto" });
    return emptyPaths;
  }
  addUnknownKeyIssues(value, PATH_KEYS, "$.paths", issues);
  const parsed = Object.fromEntries(PATH_KEYS.map((key) => {
    const item = readRequiredString(value, key, "$.paths", issues, 500);
    validateFilesystemPath(item, `$.paths.${key}`, issues);
    return [key, item];
  })) as InstallationPaths;

  const distinctPaths = new Map<string, string>();
  for (const key of PATH_KEYS) {
    const duplicate = distinctPaths.get(parsed[key]);
    if (duplicate) {
      issues.push({ path: `$.paths.${key}`, message: `debe ser diferente de paths.${duplicate}` });
    } else {
      distinctPaths.set(parsed[key], key);
    }
  }

  for (const key of ["companyContextRoot", "usersRoot", "backupsRoot"] as const) {
    if (parsed.dataRoot && parsed[key] && !isStrictDescendant(parsed.dataRoot, parsed[key])) {
      issues.push({ path: `$.paths.${key}`, message: "debe estar dentro de paths.dataRoot" });
    }
  }
  if (
    parsed.sourceReadRoot &&
    parsed.publishWriteRoot &&
    (isStrictDescendant(parsed.sourceReadRoot, parsed.publishWriteRoot) ||
      isStrictDescendant(parsed.publishWriteRoot, parsed.sourceReadRoot))
  ) {
    issues.push({
      path: "$.paths.publishWriteRoot",
      message: "no puede estar dentro de sourceReadRoot ni contenerlo",
    });
  }
  return parsed;
}

function freezeInstallationConfig(config: InstallationConfig): Readonly<InstallationConfig> {
  Object.freeze(config.branding);
  Object.freeze(config.paths);
  return Object.freeze(config);
}

export function parseInstallationConfig(value: unknown): Readonly<InstallationConfig> {
  const issues: InstallationConfigIssue[] = [];
  if (!isRecord(value)) {
    throw new InstallationConfigValidationError([{ path: "$", message: "debe ser un objeto JSON" }]);
  }
  addUnknownKeyIssues(value, ROOT_KEYS, "$", issues);

  if (value.schemaVersion !== INSTALLATION_CONFIG_SCHEMA_VERSION) {
    issues.push({
      path: "$.schemaVersion",
      message: `debe ser ${INSTALLATION_CONFIG_SCHEMA_VERSION}`,
    });
  }
  const installationId = readRequiredString(value, "installationId", "$", issues, 63);
  const companyName = readRequiredString(value, "companyName", "$", issues, 120);
  const companySlug = readRequiredString(value, "companySlug", "$", issues, 63);
  const rawPublicUrl = readRequiredString(value, "publicUrl", "$", issues, 300);
  validateIdentifier(installationId, "$.installationId", issues);
  validateIdentifier(companySlug, "$.companySlug", issues);
  const publicUrl = validatePublicUrl(rawPublicUrl, "$.publicUrl", issues);
  const branding = parseBranding(value.branding, issues);
  const paths = parsePaths(value.paths, issues);

  if (issues.length > 0) {
    throw new InstallationConfigValidationError(issues);
  }
  return freezeInstallationConfig({
    schemaVersion: INSTALLATION_CONFIG_SCHEMA_VERSION,
    installationId,
    companyName,
    companySlug,
    publicUrl,
    branding,
    paths,
  });
}
