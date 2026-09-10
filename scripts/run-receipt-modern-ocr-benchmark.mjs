import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import WebSocket from "ws";

const port = process.env.RECEIPT_MODERN_OCR_PORT || "8081";
const dataset = process.env.RECEIPT_MODERN_OCR_DATASET || "sroie";
const subset = process.env.RECEIPT_MODERN_OCR_SUBSET || "all";
const limit = process.env.RECEIPT_MODERN_OCR_LIMIT || "0";
const variant = process.env.RECEIPT_MODERN_OCR_VARIANT || "default";
const extractor = process.env.RECEIPT_MODERN_OCR_EXTRACTOR || "old-rules";
const requestedEngines = process.env.RECEIPT_MODERN_OCR_ENGINES || "";
const outputPath = process.env.RECEIPT_MODERN_OCR_OUTPUT || `benchmarks/receipt-modern-ocr-${dataset}-${subset}.json`;
const timeoutMs = Number(process.env.RECEIPT_MODERN_OCR_TIMEOUT_MS || "7200000");
const debugPort = Number(process.env.RECEIPT_MODERN_OCR_DEBUG_PORT || "9224");
const chrome = process.env.RECEIPT_CHROME || "/home/ubuntu/.cache/ms-playwright/chromium-1200/chrome-linux/chrome";
const query = new URLSearchParams({ dataset, subset, limit, variant, extractor });
if (requestedEngines) query.set("engines", requestedEngines);
const url = `http://127.0.0.1:${port}/scripts/receipt-modern-ocr-browser.html?${query}`;

const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", port], { stdio: "ignore" });
let chromeProcess;
let socket;

const waitForPage = async () => {
  const deadline = Date.now() + Math.min(timeoutMs, 60_000);
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      const page = targets.find((target) => target.type === "page" && target.url.startsWith(url));
      if (page) return page;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Chrome did not expose the modern OCR benchmark page");
};

const connectToPage = async (webSocketUrl) => {
  socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let commandId = 0;
  const pending = new Map();
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    resolve(message);
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, (message) => {
      if (message.error) reject(new Error(message.error.message));
      else resolve(message);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
};

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
  chromeProcess = spawn(chrome, [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/receipt-modern-ocr-chrome-${process.pid}`,
    url,
  ], { stdio: "ignore" });
  const page = await waitForPage();
  const sendCommand = await connectToPage(page.webSocketDebuggerUrl);
  await sendCommand("Runtime.enable");
  const deadline = Date.now() + timeoutMs;
  let outputText = "running";
  while (Date.now() < deadline && (!outputText || outputText === "running")) {
    const evaluation = await sendCommand("Runtime.evaluate", {
      expression: "document.querySelector('#output')?.textContent || ''",
      returnByValue: true,
    });
    outputText = evaluation.result?.result?.value ?? "";
    if (!outputText || outputText === "running") await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (outputText === "running" || !outputText) throw new Error("Modern OCR benchmark timed out");
  const results = JSON.parse(outputText);
  if (results.error) throw new Error(results.error);
  await writeFile(outputPath, JSON.stringify(results));
  console.log(`Wrote ${results.sampleSize} ${dataset} modern OCR rows to ${outputPath}`);
} finally {
  socket?.close();
  if (chromeProcess && !chromeProcess.killed) chromeProcess.kill("SIGTERM");
  server.kill("SIGTERM");
}
