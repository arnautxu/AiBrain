"use client";

import { useEffect, useState } from "react";

const DEFAULT_MAXIMUM_PDF_BYTES = 50 * 1024 * 1024;

function isPdfResponse(response: Response) {
  const mediaType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/pdf";
}

function declaredSizeWithinLimit(response: Response, maximumBytes: number) {
  const contentLength = response.headers.get("Content-Length");
  if (contentLength === null) return true;
  const bytes = Number(contentLength);
  return Number.isSafeInteger(bytes) && bytes > 0 && bytes <= maximumBytes;
}

export function AuthenticatedPdfPreview({
  previewUrl,
  title,
  className,
  maximumBytes = DEFAULT_MAXIMUM_PDF_BYTES,
  onLoad,
  onError,
}: {
  previewUrl: string;
  title: string;
  className: string;
  maximumBytes?: number;
  onLoad?: () => void;
  onError?: (error: Error) => void;
}) {
  const [preview, setPreview] = useState<{ source: string; url: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let currentBlobUrl: string | null = null;

    const fail = (message: string) => onError?.(new Error(message));
    if (!previewUrl.startsWith("/api/")) {
      fail("La URL de vista previa no es privada.");
      return () => controller.abort();
    }

    void fetch(previewUrl, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/pdf" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se ha podido obtener el PDF privado.");
        if (!isPdfResponse(response)) throw new Error("La respuesta no es un PDF.");
        if (!declaredSizeWithinLimit(response, maximumBytes)) throw new Error("El PDF excede el tamaño permitido.");
        const pdf = await response.blob();
        if (!pdf.size || pdf.size > maximumBytes) throw new Error("El PDF excede el tamaño permitido.");
        if (controller.signal.aborted) return;
        currentBlobUrl = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
        setPreview({ source: previewUrl, url: currentBlobUrl });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        fail(error instanceof Error ? error.message : "No se ha podido obtener el PDF privado.");
      });

    return () => {
      controller.abort();
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    };
  }, [maximumBytes, onError, previewUrl]);

  if (!preview || preview.source !== previewUrl) return null;
  return (
    <iframe
      title={title}
      src={preview.url}
      referrerPolicy="no-referrer"
      className={className}
      onLoad={onLoad}
      onError={() => onError?.(new Error("No se ha podido cargar el visor de PDF."))}
    />
  );
}
