/** Metadata for a value-only derivative; never a path to the private original. */
export type LegacyExcelProvenance = {
  policy: "values-only-v1";
  originalFileName: string;
  originalSha256: string;
  originalSize: number;
  sheetCount: number;
  cellCount: number;
  formulaCount: number;
  missingFormulaCaches: number;
  undecodedFormulas: number;
  omittedSheets: number;
  omittedStreams: number;
};

export const PASSIVE_XLS_NOTICE = "Lectura pasiva: datos guardados, no verificados. No se ejecutan macros ni se actualizan enlaces.";

export function parseLegacyExcelProvenance(value: unknown): LegacyExcelProvenance {
  const keys = ["policy", "originalFileName", "originalSha256", "originalSize", "sheetCount", "cellCount", "formulaCount", "missingFormulaCaches", "undecodedFormulas", "omittedSheets", "omittedStreams"];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid passive XLS provenance.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key)) ||
      record.policy !== "values-only-v1" || typeof record.originalFileName !== "string" ||
      !/^[^/\\\u0000-\u001f\u007f]{1,120}\.xls$/iu.test(record.originalFileName) ||
      record.originalFileName.length > 120 ||
      typeof record.originalSha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.originalSha256)) {
    throw new Error("Invalid passive XLS provenance.");
  }
  const bounds: Record<string, [number, number]> = {
    originalSize: [1, 16 * 1024 * 1024], sheetCount: [1, 100], cellCount: [1, 500_000],
    formulaCount: [0, 100_000], missingFormulaCaches: [0, 100_000], undecodedFormulas: [0, 100_000],
    omittedSheets: [0, 100], omittedStreams: [0, 5000],
  };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const count = record[key];
    if (!Number.isSafeInteger(count) || Number(count) < min || Number(count) > max) throw new Error("Invalid passive XLS provenance.");
  }
  if (Number(record.missingFormulaCaches) > Number(record.formulaCount) || Number(record.undecodedFormulas) > Number(record.formulaCount)) throw new Error("Invalid passive XLS provenance.");
  return { ...record } as LegacyExcelProvenance;
}
