// Size budget check: bundle the engine (and engine+assets) with esbuild,
// compare min and min+gzip bytes against size-budget.json. Budgets only go
// down — tighten them by editing the json; this script fails on regression.
// Run: node scripts/size.mjs [--update]
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const budgetPath = path.join(pkg, "size-budget.json");

async function measure(entry, { external = [], format = "esm" } = {}) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format,
    platform: "browser",
    write: false,
    external,
    loader: { ".css": "text" },
    logLevel: "silent",
  });
  const bytes = result.outputFiles[0].contents;
  return { min: bytes.length, gz: gzipSync(bytes, { level: 9 }).length };
}

// "engine" is code only (assets externalized — the PLAN budgets them
// separately); "engine+assets" is the whole shippable stack.
const targets = {
  engine: [
    path.join(pkg, "src/index.ts"),
    { external: ["*theme.mjs", "*preflight.mjs"] },
  ],
  // the drop-in script-tag build: engine + assets + auto-observe, IIFE
  browser: [path.join(pkg, "src/browser.ts"), { format: "iife" }],
};
const assetsEntry = path.join(pkg, "assets/index.mjs");
if (existsSync(assetsEntry)) targets["engine+assets"] = [assetsEntry, {}];

const sizes = {};
for (const [name, [entry, opts]] of Object.entries(targets)) {
  sizes[name] = await measure(entry, opts);
  const { min, gz } = sizes[name];
  console.log(
    `${name}: ${(min / 1024).toFixed(1)} KB min, ${(gz / 1024).toFixed(1)} KB min+gz`,
  );
}

if (process.argv.includes("--update") || !existsSync(budgetPath)) {
  writeFileSync(budgetPath, JSON.stringify(sizes, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), budgetPath)}`);
} else {
  const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
  let failed = false;
  for (const [name, { min, gz }] of Object.entries(sizes)) {
    const b = budget[name];
    if (!b) continue;
    for (const [metric, actual] of [
      ["min", min],
      ["gz", gz],
    ]) {
      if (actual > b[metric]) {
        console.error(
          `FAIL ${name}.${metric}: ${actual} bytes > budget ${b[metric]}`,
        );
        failed = true;
      }
    }
  }
  if (failed) process.exit(1);
  console.log("within budget");
}
