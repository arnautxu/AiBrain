import "server-only";

export function contentDisposition(fileName: string, mode: "inline" | "attachment") {
  const fallback = fileName
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._ -]/g, "-")
    .replace(/["\\]/g, "-")
    .trim()
    .slice(0, 120) || "archivo";
  const encoded = encodeURIComponent(fileName)
    .replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
