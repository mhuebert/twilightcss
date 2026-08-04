// Tier-2 corpus: generated from the oracle's own class list and variant
// registry, plus arbitrary-value templates. Deterministic (seeded PRNG) so the
// ratchet is stable across runs; `count` controls the per-run sample.
// Tokens here are *plausible*, not guaranteed-valid — the runner scores
// bothReject as a pass, so near-misses cost nothing and probe rejection too.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ARBITRARY = [
  "p-[3px]",
  "m-[0.5em]",
  "w-[calc(100%-2rem)]",
  "h-[32rem]",
  "bg-[#1e293b]",
  "bg-[oklch(63.7%_0.237_25.331)]",
  "text-[14px]",
  "text-[color:var(--brand)]",
  "leading-[1.15]",
  "grid-cols-[1fr_2fr]",
  "inset-[max(1rem,4%)]",
  "rounded-[50%]",
  "[color:red]",
  "[--gap:1rem]",
  "[mask-image:linear-gradient(black,transparent)]",
  "border-(--brand-border)",
  "bg-(--surface)",
];

const VARIANT_SAMPLE = [
  "hover",
  "focus",
  "focus-visible",
  "active",
  "disabled",
  "first",
  "last",
  "odd",
  "dark",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "max-md",
  "group-hover",
  "peer-checked",
  "data-active",
  "data-[state=open]",
  "aria-expanded",
  "aria-[busy=true]",
  "motion-safe",
  "print",
  "before",
  "after",
  "placeholder",
  "selection",
  "not-first",
  "*",
  "[&>li]",
  "supports-[display:grid]",
  "has-[:checked]",
  "nth-3",
];

/**
 * @param oracle loaded oracle (for classList)
 * @param opts {count, seed}
 * @returns string[] candidate tokens
 */
export function generateCorpus(oracle, { count = 2000, seed = 0x7717 } = {}) {
  const rand = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const classList = oracle.classList();
  const tokens = new Set();

  while (tokens.size < count) {
    const r = rand();
    if (r < 0.55) {
      // plain utility from the real class list
      tokens.add(pick(classList)[0]);
    } else if (r < 0.7) {
      // utility + valid modifier (opacity etc.)
      const [name, meta] = pick(classList);
      if (meta?.modifiers?.length)
        tokens.add(`${name}/${pick(meta.modifiers)}`);
    } else if (r < 0.92) {
      // 1–2 variants over a utility
      const base = rand() < 0.15 ? pick(ARBITRARY) : pick(classList)[0];
      const n = rand() < 0.25 ? 2 : 1;
      const vs = [];
      for (let i = 0; i < n; i++) vs.push(pick(VARIANT_SAMPLE));
      tokens.add(`${[...new Set(vs)].join(":")}:${base}`);
    } else if (r < 0.97) {
      tokens.add(pick(ARBITRARY));
    } else {
      // important / negative forms
      const name = pick(classList)[0];
      tokens.add(rand() < 0.5 ? `${name}!` : `-${name}`);
    }
  }
  return [...tokens];
}
