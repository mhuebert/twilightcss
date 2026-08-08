// Generate src/core/ranks.ts — the canonical v4 sort order, asked of the real
// compiler. Run: pnpm gen:ranks (after bumping the tailwindcss dev-dependency,
// or after adding utilities/variants to the engine).
//
// Two tables come out of this:
//
//   VARIANT_ORDER — variant base names in v4's canonical order; position IS
//                   the rank. Compound families (not-*, group-*, peer-*, in-*,
//                   has-*, aria-*, data-*, supports-*, nth-*) occupy one
//                   contiguous block each in the oracle order, so ranking them
//                   by base name is exact.
//   PROP_ORDER    — groups of utility property signatures in v4's canonical
//                   order; group position IS the rank. A signature is the
//                   utility's first two declared properties joined by commas,
//                   `~`-prefixed when the utility wraps a child selector
//                   (divide-* would otherwise collide with border-*). v4
//                   sorts utilities by the properties they emit, and its
//                   order-distinct groups have distinct signatures
//                   (`border-x-2` opens with `border-inline-style`,
//                   `border-x-red-500` with `border-inline-color`; `w-0` is
//                   `width` where `size-0` is `width,height`). This also
//                   places arbitrary properties (`[color:red]` sorts with
//                   the color utilities) exactly like the compiler does.
//
// The generator walks the oracle's full class list in canonical order and
// records each signature's position INTERVAL. Signatures whose intervals
// overlap are families v4 interleaves (text-shadow sizes and colors
// alternate); they merge into one rank, which turns cross-claims into ties
// instead of coin flips. A signature's bare first property is aliased into
// its group so partial arbitrary forms (`text-[14px]` emits font-size alone,
// `text-lg` emits font-size,line-height) still land in the right block. The
// ordering conformance test has the final say.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOracle } from "../conformance/oracle.mjs";
import { parseCandidate } from "../src/core/parse.ts";
import { lookupUtility } from "../src/core/utilities.ts";
import { defaultTheme } from "../src/core/index.ts";

const RANK_MISSING = 1023;

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, "../src/core/ranks.ts");
const require = createRequire(import.meta.url);

const oracle = await loadOracle();

/** First declared property of a class twilight can compile, else null. */
function firstProp(name) {
  const cand = parseCandidate(name);
  if (cand === null || cand.variants.length) return null;
  const utility = lookupUtility(cand.base, {
    theme: defaultTheme,
    negative: cand.negative,
    modifier: cand.modifier,
  });
  if (utility === null) return null;
  const props = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.prop !== undefined) props.push(n.prop);
      else walk(n.nodes);
    }
  };
  walk(utility.nodes);
  if (props.length === 0) return null;
  return (utility.selectorWrap ? "~" : "") + props.slice(0, 2).join(",");
}

// ---- utility ranks by first property ---------------------------------
const classList = oracle.classList().map((c) => c[0]);
const ordered = oracle
  .classOrder(classList)
  .filter((p) => p[1] !== null)
  .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));

// position interval per signature
const intervals = new Map(); // sig -> {min, max}
let pos = 0;
let unmatched = 0;
for (const [name] of ordered) {
  const sig = firstProp(name);
  pos++;
  if (sig === null) {
    unmatched++;
    continue;
  }
  const iv = intervals.get(sig);
  if (iv === undefined) intervals.set(sig, { min: pos, max: pos });
  else iv.max = pos;
}

// merge overlapping intervals: v4 interleaves those families, so a single
// shared rank (a twilight tie) is the only order-safe claim
const sorted = [...intervals.entries()].sort((a, b) => a[1].min - b[1].min);
const groups = [];
let merges = 0;
const mergeExamples = [];
for (const [sig, iv] of sorted) {
  const g = groups[groups.length - 1];
  if (g && iv.min <= g.max) {
    g.sigs.push(sig);
    if (iv.max > g.max) g.max = iv.max;
    merges++;
    if (mergeExamples.length < 12) mergeExamples.push(sig);
  } else {
    groups.push({ sigs: [sig], max: iv.max });
  }
}

// Minimize keys: a signature stays a pair only when its bare first property
// is claimed by more than one group; everything else shrinks to the first
// property alone. For ambiguous first properties the earliest group also
// carries the bare property, so partial arbitrary forms (`text-[14px]` emits
// font-size alone) still land in a sensible block.
{
  const owners = new Map(); // bare first prop -> Set<group>
  for (const g of groups)
    for (const sig of g.sigs) {
      const bare = sig.includes(",") ? sig.slice(0, sig.indexOf(",")) : sig;
      if (!owners.has(bare)) owners.set(bare, new Set());
      owners.get(bare).add(g);
    }
  const bareClaimed = new Set();
  for (const g of groups) {
    const members = new Set();
    for (const sig of g.sigs) {
      const bare = sig.includes(",") ? sig.slice(0, sig.indexOf(",")) : sig;
      if (owners.get(bare).size === 1) members.add(bare);
      else {
        members.add(sig);
        if (!bareClaimed.has(bare)) {
          bareClaimed.add(bare);
          members.add(bare); // earliest group wins the partial-form fallback
        }
      }
    }
    g.sigs = [...members];
  }
}

if (groups.length >= RANK_MISSING)
  throw new Error(
    `too many rank groups (${groups.length}) for RANK_MISSING=${RANK_MISSING}`,
  );

// ---- variant ranks ----------------------------------------------------
// getVariants() is already in v4's canonical order — position is the rank.
const variantOrder = oracle.variants().map((v) => v.name);

// ---- emit -------------------------------------------------------------
const twVersion = require("tailwindcss/package.json").version;

writeFileSync(
  outPath,
  `// GENERATED by scripts/gen-ranks.mjs from tailwindcss@${twVersion} — do not edit.
//
// v4's canonical order, which decides which of two equal-specificity utilities
// wins when both land on one element. Sort position is (variant stack, utility,
// first seen): the variant component dominates, so every unvariated utility
// sorts before every \`hover:\` one, and within one variant stack utilities
// follow PROP_ORDER — v4 sorts by emitted CSS property, and a utility's first
// declared property names its group.
//
// Position in each list is the rank.
export const VARIANT_ORDER =
  ${JSON.stringify(variantOrder.join(" "))};

// \`!\` abbreviates the \`--tw-\` prefix.
export const PROP_ORDER =
  ${JSON.stringify(groups.map((g) => g.sigs.join("|")).join(" ").replaceAll("--tw-", "!"))};

/** rank for anything the tables do not place: sorts after everything ranked */
export const RANK_MISSING = ${RANK_MISSING};
`,
);

const data = groups
  .map((g) => g.sigs.join("|"))
  .join(" ")
  .replaceAll("--tw-", "!");
console.log(
  `ranks from tailwindcss@${twVersion}: ${intervals.size} signatures in ` +
    `${groups.length} rank groups, ${variantOrder.length} variants; ` +
    `${unmatched} oracle classes twilight does not compile (no rank needed). ` +
    `Data: ${data.length} + ${variantOrder.join(" ").length} chars.`,
);
if (merges)
  console.log(
    `  ${merges} signature(s) merged into an overlapping family (ties, not claims): ${mergeExamples.join(", ")}`,
  );
