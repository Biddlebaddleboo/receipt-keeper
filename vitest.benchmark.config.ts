import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["scripts/receipt-crop-benchmark.test.ts", "scripts/receipt-frontend-benchmark.test.ts", "scripts/score-receipt-frontend-browser-ocr.test.ts", "scripts/receipt-frontend-ml-benchmark.test.ts"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
