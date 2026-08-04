// Differential conformance: twilight vs the real Tailwind compiler.
// Tier 1 (colight corpus) and tier 2 (generated) are ratcheted pass rates;
// tier 3 (negative corpus) must both-reject exactly.
//
// FULL=1 raises the tier-2 sample to the full class list scale.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOracle } from "./oracle.mjs";
import { runDiff, formatReport } from "./runner.mjs";
import { generateCorpus } from "./corpus/generated.mjs";
import { compileOne } from "../src/core/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const ratchet = JSON.parse(readFileSync(path.join(here, "ratchet.json")));
const engine = { css: (token) => compileOne(token) };

function corpusFile(name) {
  return readFileSync(path.join(here, "corpus", name), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

let oracle;
beforeAll(async () => {
  oracle = await loadOracle();
});

describe("oracle sanity", () => {
  it("compiles a known utility", () => {
    expect(oracle.css("flex")).toContain("display: flex");
  });
  it("rejects junk", () => {
    expect(oracle.css("not-a-real-utility-xyz")).toBeNull();
  });
});

describe("tier 1 — colight corpus", () => {
  it(`pass rate >= ratchet (${ratchet.tier1_colight})`, () => {
    const tokens = corpusFile("colight.txt");
    const run = runDiff(tokens, oracle, engine);
    const report = formatReport(run);
    // v3→v4 audit: colight tokens the oracle itself rejects (renamed/removed
    // utilities). These pass as bothReject but need migration on the colight
    // side — keep them visible.
    const v3isms = run.results
      .filter((r) => r.status === "bothReject")
      .map((r) => r.token);
    if (v3isms.length)
      console.log(
        `[tier1] oracle-rejected colight tokens (v3→v4 audit, ${v3isms.length}): ${v3isms.join(" ")}`,
      );
    console.log(`[tier1] ${report}`);
    expect(run.summary.passRate).toBeGreaterThanOrEqual(ratchet.tier1_colight);
  });
});

describe("tier 2 — generated corpus", () => {
  it(`pass rate >= ratchet (${ratchet.tier2_generated})`, () => {
    const count = process.env.FULL ? 20000 : 2000;
    const tokens = generateCorpus(oracle, { count });
    const run = runDiff(tokens, oracle, engine);
    console.log(`[tier2] ${formatReport(run, { maxFailures: 10 })}`);
    expect(run.summary.passRate).toBeGreaterThanOrEqual(
      ratchet.tier2_generated,
    );
  });
});

describe("tier 3 — negative corpus", () => {
  it("oracle rejects every negative token (corpus is honest)", () => {
    const wronglyValid = corpusFile("negative.txt").filter(
      (t) => oracle.css(t) != null,
    );
    expect(wronglyValid).toEqual([]);
  });
  it("twilight rejects everything the oracle rejects here", () => {
    const overreach = corpusFile("negative.txt").filter(
      (t) => engine.css(t) != null,
    );
    expect(overreach).toEqual([]);
  });
});
