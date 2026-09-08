import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
const result = await build({
  entryPoints: [require.resolve("pptxgenjs")],
  outfile: new URL("../dist/pptxgenjs.cjs", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  legalComments: "inline",
  metafile: true,
});
// PptxGenJS declares image-size but its CJS authoring build never imports it.
// Keep that unused parser (and any future dependency surprise) out of runtime.
if (Object.keys(result.metafile.inputs).some((file) => file.includes("/image-size/"))) {
  throw new Error("Presentation bundle unexpectedly includes image-size");
}
