import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import WebSocket from "ws";

const port = process.env.RECEIPT_HIERARCHICAL_PORT || "8083";
const dataset = process.env.RECEIPT_HIERARCHICAL_DATASET || "sroie";
const subset = process.env.RECEIPT_HIERARCHICAL_SUBSET || "all";
const limit = process.env.RECEIPT_HIERARCHICAL_LIMIT || "0";
const config = process.env.RECEIPT_HIERARCHICAL_CONFIG || "adaptive-medium-min2";
const outputPath = process.env.RECEIPT_HIERARCHICAL_OUTPUT || `benchmarks/receipt-hierarchical-${dataset}-${subset}-${config}.json`;
const timeoutMs = Number(process.env.RECEIPT_HIERARCHICAL_TIMEOUT_MS || "10800000");
const debugPort = Number(process.env.RECEIPT_HIERARCHICAL_DEBUG_PORT || "9226");
const chrome = process.env.RECEIPT_CHROME || "/home/ubuntu/.cache/ms-playwright/chromium-1200/chrome-linux/chrome";
const url = `http://127.0.0.1:${port}/scripts/receipt-hierarchical-ocr-browser.html?${new URLSearchParams({ dataset, subset, limit, config })}`;
const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", port], { stdio: "ignore" });
let chromeProcess; let socket;
const waitForPage = async () => { const deadline = Date.now() + 60_000; while (Date.now() < deadline) { try { const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); const page = targets.find((target) => target.type === "page" && target.url.startsWith(url)); if (page) return page; } catch {} await new Promise((resolve) => setTimeout(resolve, 250)); } throw new Error("Chrome did not expose hierarchical benchmark page"); };
const connect = async (webSocketUrl) => { socket = new WebSocket(webSocketUrl); await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); }); let id = 0; const pending = new Map(); socket.on("message", (raw) => { const message = JSON.parse(String(raw)); const resolver = pending.get(message.id); if (!resolver) return; pending.delete(message.id); message.error ? resolver(Promise.reject(new Error(message.error.message))) : resolver(message); }); return (method, params = {}) => new Promise((resolve, reject) => { const commandId = ++id; pending.set(commandId, (message) => { if (message.error) reject(new Error(message.error.message)); else resolve(message); }); socket.send(JSON.stringify({ id: commandId, method, params })); }); };
try {
  for (let attempt = 0; attempt < 60; attempt += 1) { try { await fetch(url); break; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); } if (attempt === 59) throw new Error("Vite did not start in time"); }
  chromeProcess = spawn(chrome, ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/receipt-hierarchical-chrome-${process.pid}`, url], { stdio: "ignore" });
  const page = await waitForPage(); const send = await connect(page.webSocketDebuggerUrl); await send("Runtime.enable"); const deadline = Date.now() + timeoutMs; let output = "running";
  while (Date.now() < deadline && (!output || output === "running")) { const evaluation = await send("Runtime.evaluate", { expression: "document.querySelector('#output')?.textContent || ''", returnByValue: true }); output = evaluation.result?.result?.value ?? ""; if (!output || output === "running") await new Promise((resolve) => setTimeout(resolve, 500)); }
  if (!output || output === "running") throw new Error("Hierarchical benchmark timed out"); const result = JSON.parse(output); if (result.error) throw new Error(result.error); await writeFile(outputPath, JSON.stringify(result)); console.log(`Wrote ${result.sampleSize} ${dataset} hierarchical rows to ${outputPath}`);
} finally { socket?.close(); if (chromeProcess && !chromeProcess.killed) chromeProcess.kill("SIGTERM"); server.kill("SIGTERM"); }
