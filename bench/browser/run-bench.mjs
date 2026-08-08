// Real-browser benchmark: twilightcss observe() vs Tailwind's Play CDN build
// (@tailwindcss/browser) vs no engine vs a static stylesheet, on identical
// deterministic DOM workloads. Run:
//
//   pnpm build && node bench/browser/run-bench.mjs [engines=none,static,play,twilight]
//
// Uses the system Chrome via playwright-core (devDependency; no browser
// download). The Play CDN script is fetched once from jsdelivr, pinned to the
// same tailwindcss version the conformance oracle uses.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire(import.meta.url);

// --- pin + fetch the Play CDN build -----------------------------------
const twVersion = require("tailwindcss/package.json").version;
const playPath = path.join(here, "play-cdn.js");
if (!existsSync(playPath)) {
  const url = `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@${twVersion}/dist/index.global.js`;
  console.log(`fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  writeFileSync(playPath, await res.text());
}

// --- tiny static server over the repo ---------------------------------
const MIME = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript" };
const server = createServer((req, res) => {
  const file = path.join(root, new URL(req.url, "http://x").pathname);
  try {
    res.setHeader("content-type", MIME[path.extname(file)] ?? "text/plain");
    res.end(readFileSync(file));
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/bench/browser`;

// --- matrix ------------------------------------------------------------
const argv = Object.fromEntries(process.argv.slice(2).map((a) => a.split("=")));
const engines = (argv.engines ?? "none,static,play,twilight").split(",");

const MATRIX = [
  { scenario: "cold", docsize: 1000 },
  { scenario: "stream", docsize: 1000 },
  { scenario: "churn", docsize: 1000 },
  { scenario: "churn", docsize: 5000 },
  { scenario: "churn", docsize: 20000 },
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
for (const engine of engines) {
  // engine-less baselines only make sense for churn: cold/stream wait for a
  // probe element to become styled, which never happens without an engine
  const matrix = ["none", "static"].includes(engine)
    ? MATRIX.filter((m) => m.scenario === "churn")
    : MATRIX;
  for (const { scenario, docsize } of matrix) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error(`[${engine}/${scenario}] pageerror:`, e.message));
    await page.goto(`${base}/${engine}.html?scenario=${scenario}&docsize=${docsize}`);
    try {
      await page.waitForFunction(() => document.title === "BENCH DONE", null, {
        timeout: 120_000,
      });
      const payload = JSON.parse(await page.locator("#results").innerText());
      results.push(payload);
      console.log(
        `${engine.padEnd(9)} ${scenario.padEnd(6)} doc=${String(docsize).padEnd(5)}`,
        JSON.stringify(payload.result),
      );
      if (Object.keys(payload.engineSelfTimings).length)
        console.log(`  self-timings:`, JSON.stringify(payload.engineSelfTimings));
    } catch (e) {
      console.error(`${engine} ${scenario} doc=${docsize} FAILED: ${e.message}`);
    }
    await ctx.close();
  }
}
await browser.close();
server.close();
console.log("\nFULL RESULTS\n" + JSON.stringify(results, null, 2));
