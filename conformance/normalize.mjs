// CSS canonicalization for structural comparison: parse + minify via
// lightningcss with fixed modern targets so equivalent CSS from either side
// serializes to identical bytes. Declaration and rule ORDER is preserved
// (cascade-significant); this normalizes representation, not structure.
import { transform } from "lightningcss";

// Fixed baseline: modern browsers that support color-mix / oklch natively.
// Both sides normalize with the SAME targets, so the choice only needs to be
// stable and new enough not to trigger polyfill lowering.
const TARGETS = {
  chrome: 120 << 16,
  firefox: 121 << 16,
  safari: (17 << 16) | (2 << 8),
};

export function normalizeCss(css) {
  if (css == null) return null;
  const { code } = transform({
    filename: "x.css",
    code: Buffer.from(css),
    minify: true,
    targets: TARGETS,
    errorRecovery: false,
  });
  return code.toString();
}

/** Normalize, but return a tagged error instead of throwing (for reporting). */
export function tryNormalizeCss(css) {
  try {
    return { ok: true, css: normalizeCss(css) };
  } catch (err) {
    return { ok: false, error: String(err), raw: css };
  }
}
