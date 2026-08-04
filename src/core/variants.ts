// Variant engine: each variant maps to a selector transform and/or an
// at-rule wrapper. Applied right-to-left; each wrapper goes OUTSIDE the
// previous (md:hover:flex → @media md { @media hover { .md\:hover\:flex:hover } }).
import type { Theme } from "./theme.ts";

export interface Applied {
  /** transform of the base class selector, e.g. s => s + ":hover" */
  selector?: (s: string) => string;
  /** fan out into multiple rules (e.g. selection: descendant + self) */
  selectors?: (s: string) => string[];
  /** at-rule wrapper, e.g. "@media (hover: hover)" */
  wrapper?: string;
  /** declarations injected before the utility's (before:/after: content) */
  decls?: { prop: string; value: string }[];
  /** @property rules the variant carries (--tw-content) */
  properties?: {
    name: string;
    syntax: string;
    inherits: boolean;
    initial?: string;
  }[];
  /**
   * before:/after: establish a NESTED context: variants to their right emit
   * `&`-nested rules (with media wrappers nested inside) instead of composing
   * onto the selector.
   */
  nest?: boolean;
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
  backdrop: "::backdrop",
  "first-line": "::first-line",
  "first-letter": "::first-letter",
  file: "::file-selector-button",
  "details-content": "::details-content",
};
// pseudo-elements that also apply to all descendants (multiple rules in v4)
const FANOUT_PSEUDO_ELEMENTS: Record<string, string[]> = {
  selection: ["::selection"],
  marker: ["::marker", "::-webkit-details-marker"],
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
  if (v in FANOUT_PSEUDO_ELEMENTS) {
    const pes = FANOUT_PSEUDO_ELEMENTS[v]!;
    return [
      { selectors: (s) => pes.flatMap((pe) => [`${s} ${pe}`, `${s}${pe}`]) },
    ];
  }
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
      return [pseudo(`[aria-${quoteAttr(dearbitrary(rest.slice(1, -1)))}]`)];
    if (/^[\w-]+$/.test(rest)) return [pseudo(`[aria-${rest}="true"]`)];
    return null;
  }
  if (v.startsWith("data-")) {
    const rest = v.slice(5);
    if (rest.startsWith("[") && rest.endsWith("]"))
      return [pseudo(`[data-${quoteAttr(dearbitrary(rest.slice(1, -1)))}]`)];
    if (/^[\w-]+$/.test(rest)) return [pseudo(`[data-${rest}]`)];
    return null;
  }

  if (v === "before" || v === "after")
    return [
      {
        selector: (s) => `${s}::${v}`,
        decls: [{ prop: "content", value: "var(--tw-content)" }],
        properties: [
          {
            name: "--tw-content",
            syntax: "*",
            inherits: false,
            initial: '""',
            initialFirst: true,
          },
        ],
        nest: true,
      },
    ];

  // child (*) and descendant (**) — wrap the whole selector in :is()
  if (v === "*") return [{ selector: (s) => `:is(${s} > *)` }];
  if (v === "**") return [{ selector: (s) => `:is(${s} *)` }];

  // nth-3, nth-last-2, nth-[2n+1]
  {
    const m = v.match(/^nth-(last-)?(?:(\d+)|\[(.+)\])$/);
    if (m) {
      const fn = m[1] ? ":nth-last-child" : ":nth-child";
      return [pseudo(`${fn}(${m[2] ?? dearbitrary(m[3]!)})`)];
    }
  }

  // supports-[...] and supports-name
  if (v.startsWith("supports-")) {
    const rest = v.slice(9);
    if (rest.startsWith("[") && rest.endsWith("]")) {
      let body = dearbitrary(rest.slice(1, -1));
      if (!body.startsWith("(")) body = `(${body})`;
      return [{ wrapper: `@supports ${body}` }];
    }
    if (/^[\w-]+$/.test(rest))
      return [{ wrapper: `@supports (${rest}: var(--tw))` }];
    return null;
  }

  // has-[...] / has-<simple>  →  :has(:is(...))
  if (v.startsWith("has-")) {
    const rest = v.slice(4);
    if (rest.startsWith("[") && rest.endsWith("]"))
      return [pseudo(`:has(:is(${dearbitrary(rest.slice(1, -1))}))`)];
    const suffix = simpleSuffix(rest, theme);
    if (suffix) return [pseudo(`:has(:is(${suffix}))`)];
    return null;
  }

  // not-<selector variant> / not-[...] / not-<breakpoint>
  if (v.startsWith("not-")) {
    const rest = v.slice(4);
    if (rest.startsWith("[") && rest.endsWith("]")) {
      const body = spaceCombinators(
        dearbitrary(rest.slice(1, -1)).replace(/&/g, "*"),
      );
      return [pseudo(`:not(${body})`)];
    }
    const suffix = simpleSuffix(rest, theme);
    if (suffix) return [pseudo(`:not(${suffix})`)];
    const bpNot = theme.get(`--breakpoint-${rest}`);
    if (bpNot) return [{ wrapper: `@media not (width >= ${bpNot})` }];
    if (rest in MEDIA) return [{ wrapper: `@media not ${MEDIA[rest]}` }];
    return null;
  }

  // arbitrary variant: [&_pre], [@media(min-width:900px)]
  if (v.startsWith("[") && v.endsWith("]")) {
    const body = dearbitrary(v.slice(1, -1));
    if (body.startsWith("@")) return [{ wrapper: body }];
    if (!body.includes("&")) return null;
    const spaced = spaceCombinators(body);
    return [{ selector: (s) => spaced.replace(/&/g, s) }];
  }

  return null;
}

/**
 * The raw selector suffix for media-free selector variants (used by not-/has-
 * composition). Returns null for variants that carry media wrappers.
 */
function simpleSuffix(v: string, _theme: Theme): string | null {
  if (PLAIN_PSEUDO.includes(v)) return `:${v}`;
  if (v in PSEUDO_ALIAS) return PSEUDO_ALIAS[v]!;
  if (v.startsWith("aria-") && /^[\w-]+$/.test(v.slice(5)))
    return `[aria-${v.slice(5)}="true"]`;
  if (v.startsWith("data-") && /^[\w-]+$/.test(v.slice(5)))
    return `[data-${v.slice(5)}]`;
  return null;
}

/** Underscores become spaces in arbitrary content (escaped `\_` stays). */
export function dearbitrary(s: string): string {
  return s.replace(/\\_/g, "\0").replace(/_/g, " ").replace(/\0/g, "_");
}

/** v4 reprints selectors with spaced combinators: `&>li` → `& > li`. */
function spaceCombinators(sel: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i]!;
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    if (depth === 0 && (ch === ">" || ch === "+" || ch === "~")) {
      if (!out.endsWith(" ")) out += " ";
      out += ch;
      if (sel[i + 1] !== " ") out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

/** `state=open` → `state="open"` (v4 quotes attribute values). */
function quoteAttr(body: string): string {
  const m = body.match(/^([\w-]+)([~^$*|]?=)(.+)$/);
  if (!m) return body;
  let val = m[3]!;
  const suffix = val.match(/\s+([isIS])$/);
  if (suffix) val = val.slice(0, -suffix[0].length);
  if (!/^["']/.test(val)) val = `"${val}"`;
  return `${m[1]}${m[2]}${val}${suffix ? ` ${suffix[1]}` : ""}`;
}
