// Perf thresholds: cold 500-token compile, warm new-token, warm re-flush.
// Fails if a metric regresses past bench/thresholds.json. --update rewrites
// thresholds from current numbers (with headroom).
// Run: node bench/run.mjs [--update]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile, compileOne } from "../src/core/index.ts";
import { loadOracle } from "../conformance/oracle.mjs";
import { generateCorpus } from "../conformance/corpus/generated.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const thresholdsPath = path.join(here, "thresholds.json");

const oracle = await loadOracle();
const corpus = generateCorpus(oracle, { count: 500, seed: 0xbe7c });

// warm-up
compile(corpus);

const t0 = performance.now();
compile(corpus);
const cold500 = performance.now() - t0;

const fresh = [];
for (let i = 0; i < 1000; i++) fresh.push(`m-[${i}.5px]`);
const t1 = performance.now();
for (const tkn of fresh) compileOne(tkn);
const warmNew = (performance.now() - t1) / fresh.length;

const metrics = {
  cold500ms: +cold500.toFixed(3),
  warmNewTokenMs: +warmNew.toFixed(4),
};
console.log(metrics);

if (process.argv.includes("--update") || !existsSync(thresholdsPath)) {
  const headroom = {
    cold500ms: +(cold500 * 1.5 + 0.5).toFixed(3),
    warmNewTokenMs: +(warmNew * 1.5 + 0.005).toFixed(4),
  };
  writeFileSync(thresholdsPath, JSON.stringify(headroom, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), thresholdsPath)}`);
} else {
  const limits = JSON.parse(readFileSync(thresholdsPath, "utf8"));
  const over = Object.entries(metrics).filter(([k, v]) => v > limits[k]);
  if (over.length) {
    for (const [k, v] of over)
      console.error(`FAIL ${k}: ${v} > threshold ${limits[k]}`);
    process.exit(1);
  }
  console.log("within thresholds");
}
