import "server-only";
import artwork from "../../config/profile-artwork.json";

/** Display-only artwork approved for one installation/account, never permissions. */
export function profileAvatarOverride(companySlug: string, email: string, publicUrl: string): string | null {
  const approved = artwork.find((entry) => entry.companySlug === companySlug && entry.email === email.trim().toLowerCase());
  if (!approved) return null;
  const origin = new URL(publicUrl);
  if (origin.protocol !== "https:") return null;
  return approved.assetPath;
}
