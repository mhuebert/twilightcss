// The oracle: the real tailwindcss compiler, asked per-candidate.
// `candidatesToCss` returns the modern (non-polyfilled) form — twilight's
// target semantics — and null for candidates Tailwind rejects.
import { __unstable__loadDesignSystem } from "tailwindcss";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function defaultThemeCss() {
  return readFileSync(require.resolve("tailwindcss/theme.css"), "utf8");
}

export async function loadOracle({ themeCss = defaultThemeCss() } = {}) {
  const ds = await __unstable__loadDesignSystem(
    themeCss + "\n@tailwind utilities;",
    {
      base: "/",
      async loadStylesheet() {
        throw new Error("oracle: no stylesheet imports");
      },
      async loadModule() {
        throw new Error("oracle: no module imports");
      },
    },
  );
  return {
    /** CSS for one candidate, or null if Tailwind rejects it. */
    css(candidate) {
      return ds.candidatesToCss([candidate])[0];
    },
    /** [name, {modifiers}] pairs for every known class (23k+). */
    classList: () => ds.getClassList(),
    /** All variant descriptors. */
    variants: () => ds.getVariants(),
    /** v4 canonical ordering: [class, bigint|null][] */
    classOrder: (classes) => ds.getClassOrder(classes),
    designSystem: ds,
  };
}
