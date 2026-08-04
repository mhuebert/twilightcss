// Variant engine: each variant maps to a selector transform and/or an
// at-rule wrapper. Applied right-to-left; each wrapper goes OUTSIDE the
// previous (md:hover:flex → @media md { @media hover { .md\:hover\:flex:hover } }).
import type { Theme } from "./theme.ts";

export interface Applied {
  /** transform of the base class selector, e.g. s => s + ":hover" */
  selector?: (s: string) => string;
  /** at-rule wrapper, e.g. "@media (hover: hover)" */
  wrapper?: string;
}

const pseudo = (p: string): Applied => ({ selector: (s) => s + p });
const media = (m: string): Applied => ({ wrapper: `@media ${m}` });

// Pseudo-classes where v4 appends `:name` directly.
const PLAIN_PSEUDO = [
  "focus",
  "focus-visible",
  "focus-within",
  "active",
  "visited",
  "target",
  "disabled",
  "enabled",
  "checked",
  "indeterminate",
  "default",
  "optional",
  "required",
  "valid",
  "invalid",
  "user-valid",
  "user-invalid",
  "in-range",
  "out-of-range",
  "placeholder-shown",
  "autofill",
  "read-only",
];
const PSEUDO_ALIAS: Record<string, string> = {
  first: ":first-child",
  last: ":last-child",
  only: ":only-child",
  odd: ":nth-child(odd)",
  even: ":nth-child(even)",
  "first-of-type": ":first-of-type",
  "last-of-type": ":last-of-type",
  "only-of-type": ":only-of-type",
  empty: ":empty",
  open: ":open",
};
const PSEUDO_ELEMENTS: Record<string, string> = {
  placeholder: "::placeholder",
  selection: "::selection",
  marker: "::marker",
  backdrop: "::backdrop",
  "first-line": "::first-line",
  "first-letter": "::first-letter",
  file: "::file-selector-button",
  "details-content": "::details-content",
};
const MEDIA: Record<string, string> = {
  dark: "(prefers-color-scheme: dark)",
  "motion-safe": "(prefers-reduced-motion: no-preference)",
  "motion-reduce": "(prefers-reduced-motion: reduce)",
  "contrast-more": "(prefers-contrast: more)",
  "contrast-less": "(prefers-contrast: less)",
  "forced-colors": "(forced-colors: active)",
  "inverted-colors": "(inverted-colors: inverted)",
  landscape: "(orientation: landscape)",
  portrait: "(orientation: portrait)",
  noscript: "(scripting: none)",
};

// group-X / peer-X pseudo suffixes share the plain pseudo-class grammar.
function relational(
  kind: "group" | "peer",
  sub: string,
  theme: Theme,
): Applied[] | null {
  const inner = resolveVariant(sub, theme);
  if (!inner) return null;
  // Only selector-transforming variants compose into :where(); media parts
  // (e.g. the hover media wrapper) carry over.
  const out: Applied[] = [];
  let anchor = `:where(.${kind})`;
  for (const a of inner) {
    if (a.selector) anchor = a.selector(anchor);
    if (a.wrapper) out.push({ wrapper: a.wrapper });
  }
  const combinator = kind === "group" ? " *" : " ~ *";
  out.push({ selector: (s) => `${s}:is(${anchor}${combinator})` });
  return out;
}

/**
 * Resolve one variant name into transforms, or null if unknown.
 * Order within the returned array: wrappers first, selector transforms last.
 */
export function resolveVariant(v: string, theme: Theme): Applied[] | null {
  if (v === "hover") return [media("(hover: hover)"), pseudo(":hover")];
  if (PLAIN_PSEUDO.includes(v)) return [pseudo(`:${v}`)];
  if (v in PSEUDO_ALIAS) return [pseudo(PSEUDO_ALIAS[v]!)];
  if (v in PSEUDO_ELEMENTS) return [pseudo(PSEUDO_ELEMENTS[v]!)];
  if (v in MEDIA) return [media(MEDIA[v]!)];
  if (v === "print") return [{ wrapper: "@media print" }];
  if (v === "starting") return [{ wrapper: "@starting-style" }];

  // breakpoints: md, max-md — values from the theme (JS-side is unavoidable:
  // media queries cannot contain var()).
  const bp = theme.get(`--breakpoint-${v}`);
  if (bp) return [media(`(width >= ${bp})`)];
  if (v.startsWith("max-")) {
    const mbp = theme.get(`--breakpoint-${v.slice(4)}`);
    if (mbp) return [media(`(width < ${mbp})`)];
  }

  if (v.startsWith("group-")) return relational("group", v.slice(6), theme);
  if (v.startsWith("peer-")) return relational("peer", v.slice(5), theme);

  // aria-checked etc. (boolean) and aria-[...] / data-[...] arbitrary
  if (v.startsWith("aria-")) {
    const rest = v.slice(5);
    if (rest.startsWith("[") && rest.endsWith("]"))
      return [pseudo(`[aria-${dearbitrary(rest.slice(1, -1))}]`)];
    if (/^[\w-]+$/.test(rest)) return [pseudo(`[aria-${rest}="true"]`)];
    return null;
  }
  if (v.startsWith("data-")) {
    const rest = v.slice(5);
    if (rest.startsWith("[") && rest.endsWith("]"))
      return [pseudo(`[data-${dearbitrary(rest.slice(1, -1))}]`)];
    if (/^[\w-]+$/.test(rest)) return [pseudo(`[data-${rest}]`)];
    return null;
  }

  // arbitrary variant: [&_pre], [@media(min-width:900px)]
  if (v.startsWith("[") && v.endsWith("]")) {
    const body = dearbitrary(v.slice(1, -1));
    if (body.startsWith("@")) return [{ wrapper: body }];
    if (!body.includes("&")) return null;
    return [{ selector: (s) => body.replace(/&/g, s) }];
  }

  return null;
}

/** Underscores become spaces in arbitrary content (escaped `\_` stays). */
export function dearbitrary(s: string): string {
  return s.replace(/\\_/g, "\0").replace(/_/g, " ").replace(/\0/g, "_");
}
