import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Takes the screenshots in docs/screenshots from a running Tally (use the demo data from scripts/demo-seed.mjs, never your own):
//   API_URL=http://localhost:3003 node scripts/screenshots.mjs [light|dark]
// Needs Google Chrome (set CHROME=/path/to/chrome if it is somewhere else) and Node 22+.
const B = process.env.API_URL ?? "http://localhost:3003";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const scheme = process.argv[2] === "dark" ? "dark" : "light";
const last = new Date(); last.setDate(0); // the last full month
const month = last.toLocaleDateString("en-CA").slice(0, 7);
const PAGES = [
  ["dashboard", "/", 1440], ["accounts", "/accounts", 1440], ["budget", `/budgets?month=${month}`, 1440], ["cashflow", "/cashflow", 1440],
  ["spending", "/reports", 1440], ["recurring", "/recurring", 1440], ["calendar", `/calendar?month=${month}`, 1440], ["mobile-budget", `/budgets?month=${month}`, 390],
];
const dir = mkdtempSync(join(tmpdir(), "tally-shots-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${dir}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const targets = await (await fetch("http://127.0.0.1:9333/json")).json();
    ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  } catch { ws = undefined; await sleep(200); }
}
if (!ws) { chrome.kill(); throw new Error("Could not reach Chrome"); }
let n = 0; const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); waiting.get(d.id)?.(d.result); };
const send = (method, params = {}) => new Promise((ok) => { const id = ++n; waiting.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });

mkdirSync("docs/screenshots", { recursive: true });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
for (const [name, path, width] of PAGES) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: width < 600 ? 2 : 1, mobile: width < 600 });
  await send("Page.navigate", { url: B + path });
  await sleep(2500); // data, then chart animations
  const size = (await send("Runtime.evaluate", { expression: "document.documentElement.scrollHeight", returnByValue: true })).result.value;
  await send("Emulation.setDeviceMetricsOverride", { width, height: Math.min(size, 1800), deviceScaleFactor: width < 600 ? 2 : 1, mobile: width < 600 });
  await sleep(700);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`docs/screenshots/${name}${scheme === "dark" ? "-dark" : ""}.png`, Buffer.from(shot.data, "base64"));
  console.log("saved", name);
}
ws.close(); chrome.kill();
