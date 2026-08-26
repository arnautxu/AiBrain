import "server-only";

export function getPublicOrigin(request: Request) {
  const configured = process.env.AIBRAIN_PUBLIC_URL?.trim();
  const url = new URL(configured || request.url);
  if (url.username || url.password) {
    throw new Error("AIBRAIN_PUBLIC_URL no pot contenir credencials.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("AIBRAIN_PUBLIC_URL ha d’utilitzar HTTPS en producció.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("AIBRAIN_PUBLIC_URL ha de ser una URL HTTP o HTTPS.");
  }
  return url.origin;
}
