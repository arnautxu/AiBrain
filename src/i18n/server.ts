import "server-only";
import { loadInstallationConfig } from "@/config/installation";
import { FileInstallationLanguageStore } from "./installation-language-store";
export async function installationUiLocale() {
  const installation = await loadInstallationConfig();
  return new FileInstallationLanguageStore(installation.installationId, installation.paths.dataRoot).read();
}
