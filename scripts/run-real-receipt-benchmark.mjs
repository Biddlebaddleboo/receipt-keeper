import { execFileSync, spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const port = "8080";
const url = `http://127.0.0.1:${port}/scripts/real-receipt-browser.html`;
const chrome = process.env.RECEIPT_CHROME || "/home/ubuntu/.cache/ms-playwright/chromium-1200/chrome-linux/chrome";

const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", port], {
  stdio: "ignore",
});
try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(url);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (attempt === 59) throw new Error("Vite did not start in time");
  }
  const dom = execFileSync(chrome, [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--allow-file-access-from-files",
    "--virtual-time-budget=120000",
    "--dump-dom",
    url,
  ], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  const match = dom.match(/<pre id="output">([\s\S]*?)<\/pre>/);
  if (!match) throw new Error("Benchmark page did not return JSON output");
  const results = JSON.parse(match[1]);
  await writeFile("benchmarks/real-receipt-results.json", JSON.stringify(results, null, 2));
  console.log(`Wrote ${results.length} real receipt results to benchmarks/real-receipt-results.json`);
} finally {
  server.kill("SIGTERM");
}
