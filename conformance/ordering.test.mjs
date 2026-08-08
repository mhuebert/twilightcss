// Ordering conformance: does twilight's rank reproduce v4's canonical order?
//
// The oracle's getClassOrder returns a bigint sort key per class. For every
// pair of tokens whose oracle keys DIFFER, twilight must agree on which comes
// first. Pairs the oracle ranks equal are genuine ties — either order is fine,
// and so are pairs twilight ranks equal (it keeps first-seen order there, which
// no cascade outcome depends on: equal rank means the same utility slot).
//
// FULL=1 widens the sample the same way the CSS conformance test does.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOracle } from "./oracle.mjs";
import { generateCorpus } from "./corpus/generated.mjs";
import { compileOne } from "../src/core/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const ratchet = JSON.parse(readFileSync(path.join(here, "ratchet.json")));

let oracle;
beforeAll(async () => {
  oracle = await loadOracle();
});

function corpusFile(name) {
  return readFileSync(path.join(here, "corpus", name), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/**
 * Compare every pair within a sliding window of the token list (the full
 * cross-product is quadratic and adds nothing: the sample is already random).
 */
function compareOrder(tokens, oracle) {
  const compiled = new Map();
  for (const token of tokens) {
    const rule = compileOne(token);
    if (rule !== null) compiled.set(token, rule.rank);
  }
  const list = [...compiled.keys()];
  const oracleKey = new Map(oracle.classOrder(list));

  let claims = 0;
  let agree = 0;
  let ties = 0;
  const disagreements = [];
  const WINDOW = 8;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < Math.min(i + WINDOW, list.length); j++) {
      const a = list[i];
      const b = list[j];
      const ka = oracleKey.get(a);
      const kb = oracleKey.get(b);
      // classes the oracle does not know, or ranks equal, carry no expectation
      if (ka == null || kb == null || ka === kb) continue;
      const ra = compiled.get(a);
      const rb = compiled.get(b);
      if (ra === rb) {
        // twilight tie (same first property, e.g. p-2 vs p-4): no claim to
        // judge — first-seen order applies. Tracked so tie inflation stays
        // visible instead of hiding in the pass rate.
        ties++;
        continue;
      }
      claims++;
      if ((ka < kb ? a : b) === (ra < rb ? a : b)) agree++;
      else if (disagreements.length < 20) disagreements.push([a, b]);
    }
  }
  return { claims, agree, ties, disagreements };
}

describe("ordering — twilight rank vs v4 canonical order", () => {
  it(`generated corpus agreement >= ratchet (${ratchet.ordering})`, () => {
    const count = process.env.FULL ? 20000 : 2000;
    const tokens = generateCorpus(oracle, { count });
    const { claims, agree, ties, disagreements } = compareOrder(tokens, oracle);
    const rate = claims ? agree / claims : 1;
    console.log(
      `[ordering] agree ${agree}/${claims} (${(rate * 100).toFixed(2)}%), ${ties} ties`,
    );
    for (const [a, b] of disagreements)
      console.log(`  disagree: ${a} vs ${b}`);
    expect(rate).toBeGreaterThanOrEqual(ratchet.ordering);
  });

  it("colight corpus agrees exactly", () => {
    const { claims, agree, ties, disagreements } = compareOrder(
      corpusFile("colight.txt"),
      oracle,
    );
    console.log(`[ordering/tier1] agree ${agree}/${claims}, ${ties} ties`);
    expect(disagreements).toEqual([]);
  });

  it("puts a variated utility after its unvariated form", () => {
    // the case the cascade actually turns on: same property, same specificity
    const base = compileOne("p-4").rank;
    expect(compileOne("hover:p-4").rank).toBeGreaterThan(base);
    expect(compileOne("md:p-4").rank).toBeGreaterThan(compileOne("hover:p-4").rank);
    // and the utility component still orders within one variant
    expect(compileOne("px-2").rank).toBeGreaterThan(compileOne("p-4").rank);
    expect(compileOne("hover:px-2").rank).toBeGreaterThan(
      compileOne("hover:p-4").rank,
    );
  });
});
