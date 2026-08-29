const MAX_AVATAR_URL_LENGTH = 2_048;

/** Display-only identity data: accept only non-credentialed HTTPS URLs. */
export function validatedAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_AVATAR_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

export function initialsForName(name: string) {
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("es")).join("");
  return initials || "?";
}
