export function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const requestUrl = new URL(request.url);
      const host = request.headers.get("host") ?? requestUrl.host;
      const protocol = request.headers.get("x-forwarded-proto") ?? requestUrl.protocol.replace(":", "");
      return originUrl.host === host && originUrl.protocol === `${protocol}:`;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin";

  return process.env.NODE_ENV !== "production";
}
