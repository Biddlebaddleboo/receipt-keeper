import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 120_000,
    include: ["scripts/receipt-crop-benchmark.test.ts", "scripts/receipt-frontend-benchmark.test.ts", "scripts/score-receipt-frontend-browser-ocr.test.ts", "scripts/score-receipt-frontend-ocr-benchmark.test.ts", "scripts/receipt-frontend-ml-benchmark.test.ts", "scripts/score-receipt-modern-ocr-benchmark.test.ts"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
