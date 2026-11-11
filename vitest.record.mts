import { defineConfig } from "vitest/config";
import path from "node:path";
// Not part of `npm test`. Records label readings from the live model: npx vitest run --config vitest.record.mts
export default defineConfig({ test: { include: ["scripts/record-readings.ts"], environment: "node", testTimeout: 600_000 }, resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } } });
