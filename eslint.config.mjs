import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    "contracts/codex/**",
    "coverage/**",
    "out/**",
    "build/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "runtime/**",
    // Vendored by the Fluid Functionalism shadcn registry. Keep project code
    // linted without rewriting the upstream component's ref choreography.
    "src/components/ui/sidebar*.tsx",
    "src/hooks/use-proximity-hover.ts",
  ]),
]);
