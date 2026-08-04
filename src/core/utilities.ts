// The utility table: root → handler. Formats mirror the oracle
// (candidatesToCss) byte-for-byte after normalization; when in doubt the
// conformance harness decides, never intuition.
import type { Node } from "./emit.ts";
import type { Theme } from "./theme.ts";
import { dearbitrary } from "./variants.ts";

export interface PropDef {
  name: string;
  syntax: string;
  inherits: boolean;
  initial?: string;
  /** emit initial-value before inherits (v4 quirk for --tw-content) */
  initialFirst?: boolean;
}

export interface UtilityOutput {
  nodes: Node[];
  properties?: PropDef[];
  /** wrap the (variant-applied) class selector, e.g. divide/space children */
  selectorWrap?: (sel: string) => string;
}

export interface Ctx {
  theme: Theme;
  negative: boolean;
  modifier: string | null;
}

const d = (prop: string, value: string) => ({ prop, value });
const out = (nodes: Node[], properties?: PropDef[]): UtilityOutput =>
  properties ? { nodes, properties } : { nodes };

// ---------- @property groups (order matches oracle emission) ----------
const P = (name: string, initial?: string, syntax = "*"): PropDef =>
  initial === undefined
    ? { name, syntax, inherits: false }
    : { name, syntax, inherits: false, initial };

const BORDER_STYLE_PROPS = [P("--tw-border-style", "solid")];
const FONT_WEIGHT_PROPS = [P("--tw-font-weight")];
const LEADING_PROPS = [P("--tw-leading")];
const TRACKING_PROPS = [P("--tw-tracking")];
const DURATION_PROPS = [P("--tw-duration")];
const EASE_PROPS = [P("--tw-ease")];
const SHADOW_PROPS = [
  P("--tw-shadow", "0 0 #0000"),
  P("--tw-shadow-color"),
  P("--tw-shadow-alpha", "100%", "<percentage>"),
  P("--tw-inset-shadow", "0 0 #0000"),
  P("--tw-inset-shadow-color"),
  P("--tw-inset-shadow-alpha", "100%", "<percentage>"),
  P("--tw-ring-color"),
  P("--tw-ring-shadow", "0 0 #0000"),
  P("--tw-inset-ring-color"),
  P("--tw-inset-ring-shadow", "0 0 #0000"),
  P("--tw-ring-inset"),
  P("--tw-ring-offset-width", "0px", "<length>"),
  P("--tw-ring-offset-color", "#fff"),
  P("--tw-ring-offset-shadow", "0 0 #0000"),
];
const TRANSLATE_PROPS = [
  P("--tw-translate-x", "0"),
  P("--tw-translate-y", "0"),
  P("--tw-translate-z", "0"),
];
const NUMERIC_PROPS = [
  P("--tw-ordinal"),
  P("--tw-slashed-zero"),
  P("--tw-numeric-figure"),
  P("--tw-numeric-spacing"),
  P("--tw-numeric-fraction"),
];
const OUTLINE_STYLE_PROPS = [P("--tw-outline-style", "solid")];

const BOX_SHADOW_VALUE =
  "var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)";

// ---------- value helpers ----------

/** bare numeric value on the spacing scale (multiples of 0.25) */
function bareSpacing(v: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isInteger(n * 4) ? n : null;
}

function spacingCalc(n: number, negative: boolean): string {
  if (n === 0) return "0px";
  if (n === 1 && !negative) return "var(--spacing)";
  return `calc(var(--spacing) * ${negative ? "-" : ""}${n})`;
}

function fraction(v: string): string | null {
  const m = v.match(/^(\d+)\/(\d+)$/);
  if (!m) return null;
  if (Number(m[2]) === 0) return null;
  return `calc(${m[1]} / ${m[2]} * 100%)`;
}

function isArbitrary(v: string): boolean {
  return v.startsWith("[") && v.endsWith("]") && v.length > 2;
}
function arbitraryValue(v: string): string {
  return mathSpace(dearbitrary(v.slice(1, -1)));
}

const MATH_FNS =
  /(calc|min|max|clamp|round|mod|rem|pow|sqrt|hypot|log|exp|atan2|sin|cos|tan|asin|acos|atan|abs|sign)\($/;

/**
 * v4 inserts whitespace around math operators inside math functions of
 * arbitrary values: calc(100%-2rem) → calc(100% - 2rem). Content inside
 * var() is left untouched.
 */
export function mathSpace(input: string): string {
  let out = "";
  const stack: ("math" | "var" | "other")[] = [];
  const inMath = () => stack.includes("math") && !stack.includes("var");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "(") {
      const head = out.match(/([\w-]*)$/)?.[1] ?? "";
      if (head === "var") stack.push("var");
      else if (MATH_FNS.test(`${head}(`)) stack.push("math");
      else stack.push("other");
      out += ch;
      continue;
    }
    if (ch === ")") {
      stack.pop();
      out += ch;
      continue;
    }
    if (inMath() && (ch === "+" || ch === "*" || ch === "/")) {
      if (!out.endsWith(" ")) out += " ";
      out += ch;
      if (input[i + 1] !== " ") out += " ";
      continue;
    }
    if (inMath() && ch === "-") {
      const prev = out.match(/([^\s])\s*$/)?.[1] ?? "";
      const next = input[i + 1] ?? "";
      const binary =
        /[\d%)]/.test(prev) || (/[a-zA-Z]/.test(prev) && /[\d(.]/.test(next));
      if (binary) {
        if (!out.endsWith(" ")) out += " ";
        out += "-";
        if (next !== " ") out += " ";
        continue;
      }
    }
    out += ch;
  }
  return out;
}
/** `(--x)` and `(--x,fallback)` shorthand → var(...) */
function customProp(v: string): string | null {
  if (v.startsWith("(") && v.endsWith(")") && v.slice(1).startsWith("--"))
    return `var${v}`;
  return null;
}

const COLOR_RE =
  /^(#([0-9a-fA-F]{3,8})|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|hwb\(|color\(|color-mix\(|light-dark\()/;
const NAMED_COLOR_KEYWORDS = new Set([
  "transparent",
  "current",
  "inherit",
  "black",
  "white",
]);

function looksLikeColor(v: string): boolean {
  return COLOR_RE.test(v) || v === "transparent" || v === "currentcolor";
}

/** modifier → opacity percentage text, or null if invalid */
function opacityModifier(mod: string): string | null {
  if (/^\d+(\.\d+)?$/.test(mod)) return `${Number(mod)}%`;
  if (isArbitrary(mod)) return arbitraryValue(mod);
  if (customProp(mod)) return `var${mod}`;
  return null;
}

function withOpacity(color: string, mod: string | null): string | null {
  if (mod === null) return color;
  const pct = opacityModifier(mod);
  if (pct === null) return null;
  if (pct === "100%") return color; // v4 short-circuits full opacity
  return `color-mix(in oklab, ${color} ${pct}, transparent)`;
}

/** resolve a color value (named theme color / keyword / arbitrary) */
function resolveColor(v: string, ctx: Ctx): string | null {
  if (v === "inherit") return "inherit";
  if (v === "current") return "currentcolor";
  if (v === "transparent") return "transparent";
  if (isArbitrary(v)) {
    let a = arbitraryValue(v);
    if (a.startsWith("color:")) a = a.slice(6);
    return looksLikeColor(a) || a.startsWith("var(") ? a : null;
  }
  const cp = customProp(v);
  if (cp) return cp;
  if (ctx.theme.has(`--color-${v}`)) return `var(--color-${v})`;
  return null;
}

// ---------- factories ----------

type Handler = (value: string | null, ctx: Ctx) => UtilityOutput | null;

/**
 * The candidate parser splits `w-1/2` into value "1" + modifier "2"; for
 * fraction-capable utilities, rejoin numeric value/modifier into "1/2".
 * Returns the effective value, or undefined when the modifier can't be a
 * fraction denominator (→ reject).
 */
function rejoinFraction(
  value: string | null,
  ctx: Ctx,
): string | null | undefined {
  if (ctx.modifier === null) return value;
  if (value !== null && /^\d+$/.test(value) && /^\d+$/.test(ctx.modifier))
    return `${value}/${ctx.modifier}`;
  return undefined;
}

/** spacing-scale utility (padding/margin/gap/inset/…) */
function spacingUtil(
  props: string[],
  opts: {
    auto?: boolean;
    negative?: boolean;
    fraction?: boolean;
    full?: boolean;
    named?: Record<string, string>;
  } = {},
): Handler {
  return (rawValue, ctx) => {
    if (rawValue === null) return null;
    if (ctx.negative && !opts.negative) return null;
    if (!opts.fraction && ctx.modifier !== null) return null;
    const joined = opts.fraction ? rejoinFraction(rawValue, ctx) : rawValue;
    if (joined === undefined) return null;
    const value = joined!;
    let css: string | null = null;
    if (value === "px") css = ctx.negative ? "-1px" : "1px";
    else if (value === "auto" && opts.auto && !ctx.negative) css = "auto";
    else if (value === "full" && opts.full)
      css = ctx.negative ? "-100%" : "100%";
    else if (opts.named && value in opts.named && !ctx.negative)
      css = opts.named[value]!;
    else if (opts.fraction && fraction(value))
      css = ctx.negative ? `calc(${fraction(value)} * -1)` : fraction(value)!;
    else if (isArbitrary(value)) {
      const a = arbitraryValue(value);
      css = ctx.negative ? `calc(${a} * -1)` : a;
    } else {
      const cp = customProp(value);
      if (cp) css = ctx.negative ? `calc(${cp} * -1)` : cp;
      else {
        const n = bareSpacing(value);
        if (n === null) return null;
        css = spacingCalc(n, ctx.negative);
      }
    }
    if (css === null) return null;
    return out(props.map((p) => d(p, css!)));
  };
}

/** color-emitting utility (bg-*, text color, border color, …) */
function colorDecl(props: string[], v: string, ctx: Ctx): UtilityOutput | null {
  const base = resolveColor(v, ctx);
  if (base === null) return null;
  const c = withOpacity(base, ctx.modifier);
  if (c === null) return null;
  return out(props.map((p) => d(p, c)));
}

// sizing named values shared by w/h/min/max
const SIZE_NAMED: Record<string, string> = {
  auto: "auto",
  full: "100%",
  min: "min-content",
  max: "max-content",
  fit: "fit-content",
};

function sizeUtil(
  prop: string,
  axis: "w" | "h",
  opts: { container?: boolean } = {},
): Handler {
  return (rawValue, ctx) => {
    if (rawValue === null || ctx.negative) return null;
    const joined = rejoinFraction(rawValue, ctx);
    if (joined === undefined) return null;
    const value = joined!;
    const vp = axis === "w" ? "vw" : "vh";
    const named: Record<string, string> = {
      ...SIZE_NAMED,
      screen: `100${vp}`,
      dvw: "100dvw",
      dvh: "100dvh",
      lvw: "100lvw",
      lvh: "100lvh",
      svw: "100svw",
      svh: "100svh",
    };
    let css: string | null = null;
    if (value === "px") css = "1px";
    else if (value === "lh") css = "1lh";
    else if (value in named) css = named[value]!;
    else if (opts.container && ctx.theme.has(`--container-${value}`))
      css = `var(--container-${value})`;
    else if (fraction(value)) css = fraction(value);
    else if (isArbitrary(value)) css = arbitraryValue(value);
    else if (customProp(value)) css = customProp(value);
    else {
      const n = bareSpacing(value);
      if (n === null) return null;
      css = spacingCalc(n, false);
    }
    return out([d(prop, css!)]);
  };
}

/** bare-int → px scale (underline-offset, outline-offset, border width…) */
function bareToPx(v: string, negative: boolean): string | null {
  if (!/^\d+$/.test(v)) return null;
  return negative ? `calc(${v}px * -1)` : `${v}px`;
}

// ---------- static utilities ----------
// Value: array of [prop, value] declarations.
const S: Record<string, [string, string][]> = {
  // display
  block: [["display", "block"]],
  "inline-block": [["display", "inline-block"]],
  inline: [["display", "inline"]],
  flex: [["display", "flex"]],
  "inline-flex": [["display", "inline-flex"]],
  grid: [["display", "grid"]],
  "inline-grid": [["display", "inline-grid"]],
  contents: [["display", "contents"]],
  table: [["display", "table"]],
  "table-row": [["display", "table-row"]],
  "table-cell": [["display", "table-cell"]],
  "flow-root": [["display", "flow-root"]],
  "list-item": [["display", "list-item"]],
  hidden: [["display", "none"]],
  // position
  static: [["position", "static"]],
  fixed: [["position", "fixed"]],
  absolute: [["position", "absolute"]],
  relative: [["position", "relative"]],
  sticky: [["position", "sticky"]],
  // visibility
  visible: [["visibility", "visible"]],
  invisible: [["visibility", "hidden"]],
  collapse: [["visibility", "collapse"]],
  // isolation
  isolate: [["isolation", "isolate"]],
  "isolation-auto": [["isolation", "auto"]],
  // flex
  "flex-row": [["flex-direction", "row"]],
  "flex-row-reverse": [["flex-direction", "row-reverse"]],
  "flex-col": [["flex-direction", "column"]],
  "flex-col-reverse": [["flex-direction", "column-reverse"]],
  "flex-wrap": [["flex-wrap", "wrap"]],
  "flex-wrap-reverse": [["flex-wrap", "wrap-reverse"]],
  "flex-nowrap": [["flex-wrap", "nowrap"]],
  "flex-auto": [["flex", "auto"]],
  "flex-initial": [["flex", "0 auto"]],
  "flex-none": [["flex", "none"]],
  grow: [["flex-grow", "1"]],
  "grow-0": [["flex-grow", "0"]],
  shrink: [["flex-shrink", "1"]],
  "shrink-0": [["flex-shrink", "0"]],
  "flex-grow": [["flex-grow", "1"]],
  "flex-grow-0": [["flex-grow", "0"]],
  "flex-shrink": [["flex-shrink", "1"]],
  "flex-shrink-0": [["flex-shrink", "0"]],
  // align / justify
  "items-start": [["align-items", "flex-start"]],
  "items-end": [["align-items", "flex-end"]],
  "items-center": [["align-items", "center"]],
  "items-baseline": [["align-items", "baseline"]],
  "items-stretch": [["align-items", "stretch"]],
  "justify-start": [["justify-content", "flex-start"]],
  "justify-end": [["justify-content", "flex-end"]],
  "justify-center": [["justify-content", "center"]],
  "justify-between": [["justify-content", "space-between"]],
  "justify-around": [["justify-content", "space-around"]],
  "justify-evenly": [["justify-content", "space-evenly"]],
  "justify-stretch": [["justify-content", "stretch"]],
  "justify-items-start": [["justify-items", "start"]],
  "justify-items-end": [["justify-items", "end"]],
  "justify-items-center": [["justify-items", "center"]],
  "justify-items-stretch": [["justify-items", "stretch"]],
  "self-auto": [["align-self", "auto"]],
  "self-start": [["align-self", "flex-start"]],
  "self-end": [["align-self", "flex-end"]],
  "self-center": [["align-self", "center"]],
  "self-stretch": [["align-self", "stretch"]],
  "self-baseline": [["align-self", "baseline"]],
  "content-start": [["align-content", "flex-start"]],
  "content-end": [["align-content", "flex-end"]],
  "content-center": [["align-content", "center"]],
  "content-between": [["align-content", "space-between"]],
  "content-around": [["align-content", "space-around"]],
  "content-evenly": [["align-content", "space-evenly"]],
  "place-items-center": [["place-items", "center"]],
  "place-content-center": [["place-content", "center"]],
  // overflow
  "overflow-auto": [["overflow", "auto"]],
  "overflow-hidden": [["overflow", "hidden"]],
  "overflow-clip": [["overflow", "clip"]],
  "overflow-visible": [["overflow", "visible"]],
  "overflow-scroll": [["overflow", "scroll"]],
  "overflow-x-auto": [["overflow-x", "auto"]],
  "overflow-y-auto": [["overflow-y", "auto"]],
  "overflow-x-hidden": [["overflow-x", "hidden"]],
  "overflow-y-hidden": [["overflow-y", "hidden"]],
  "overflow-x-clip": [["overflow-x", "clip"]],
  "overflow-y-clip": [["overflow-y", "clip"]],
  "overflow-x-visible": [["overflow-x", "visible"]],
  "overflow-y-visible": [["overflow-y", "visible"]],
  "overflow-x-scroll": [["overflow-x", "scroll"]],
  "overflow-y-scroll": [["overflow-y", "scroll"]],
  // text align / transform / style
  "text-left": [["text-align", "left"]],
  "text-center": [["text-align", "center"]],
  "text-right": [["text-align", "right"]],
  "text-justify": [["text-align", "justify"]],
  "text-start": [["text-align", "start"]],
  "text-end": [["text-align", "end"]],
  uppercase: [["text-transform", "uppercase"]],
  lowercase: [["text-transform", "lowercase"]],
  capitalize: [["text-transform", "capitalize"]],
  "normal-case": [["text-transform", "none"]],
  italic: [["font-style", "italic"]],
  "not-italic": [["font-style", "normal"]],
  underline: [["text-decoration-line", "underline"]],
  overline: [["text-decoration-line", "overline"]],
  "line-through": [["text-decoration-line", "line-through"]],
  "no-underline": [["text-decoration-line", "none"]],
  // decoration style
  "decoration-solid": [["text-decoration-style", "solid"]],
  "decoration-double": [["text-decoration-style", "double"]],
  "decoration-dotted": [["text-decoration-style", "dotted"]],
  "decoration-dashed": [["text-decoration-style", "dashed"]],
  "decoration-wavy": [["text-decoration-style", "wavy"]],
  // whitespace / wrapping
  "whitespace-normal": [["white-space", "normal"]],
  "whitespace-nowrap": [["white-space", "nowrap"]],
  "whitespace-pre": [["white-space", "pre"]],
  "whitespace-pre-line": [["white-space", "pre-line"]],
  "whitespace-pre-wrap": [["white-space", "pre-wrap"]],
  "whitespace-break-spaces": [["white-space", "break-spaces"]],
  "text-wrap": [["text-wrap", "wrap"]],
  "text-nowrap": [["text-wrap", "nowrap"]],
  "text-balance": [["text-wrap", "balance"]],
  "text-pretty": [["text-wrap", "pretty"]],
  "break-normal": [
    ["overflow-wrap", "normal"],
    ["word-break", "normal"],
  ],
  "break-words": [["overflow-wrap", "break-word"]],
  "break-all": [["word-break", "break-all"]],
  "break-keep": [["word-break", "keep-all"]],
  truncate: [
    ["overflow", "hidden"],
    ["text-overflow", "ellipsis"],
    ["white-space", "nowrap"],
  ],
  "text-ellipsis": [["text-overflow", "ellipsis"]],
  "text-clip": [["text-overflow", "clip"]],
  // vertical-align
  "align-baseline": [["vertical-align", "baseline"]],
  "align-top": [["vertical-align", "top"]],
  "align-middle": [["vertical-align", "middle"]],
  "align-bottom": [["vertical-align", "bottom"]],
  "align-text-top": [["vertical-align", "text-top"]],
  "align-text-bottom": [["vertical-align", "text-bottom"]],
  // list
  "list-none": [["list-style-type", "none"]],
  "list-disc": [["list-style-type", "disc"]],
  "list-decimal": [["list-style-type", "decimal"]],
  "list-inside": [["list-style-position", "inside"]],
  "list-outside": [["list-style-position", "outside"]],
  // font smoothing
  antialiased: [
    ["-webkit-font-smoothing", "antialiased"],
    ["-moz-osx-font-smoothing", "grayscale"],
  ],
  "subpixel-antialiased": [
    ["-webkit-font-smoothing", "auto"],
    ["-moz-osx-font-smoothing", "auto"],
  ],
  // interactivity
  "pointer-events-none": [["pointer-events", "none"]],
  "pointer-events-auto": [["pointer-events", "auto"]],
  "select-none": [
    ["-webkit-user-select", "none"],
    ["user-select", "none"],
  ],
  "select-text": [
    ["-webkit-user-select", "text"],
    ["user-select", "text"],
  ],
  "select-all": [
    ["-webkit-user-select", "all"],
    ["user-select", "all"],
  ],
  "select-auto": [
    ["-webkit-user-select", "auto"],
    ["user-select", "auto"],
  ],
  "resize-none": [["resize", "none"]],
  resize: [["resize", "both"]],
  "resize-y": [["resize", "vertical"]],
  "resize-x": [["resize", "horizontal"]],
  // sr
  "sr-only": [
    ["position", "absolute"],
    ["width", "1px"],
    ["height", "1px"],
    ["padding", "0"],
    ["margin", "-1px"],
    ["overflow", "hidden"],
    ["clip-path", "inset(50%)"],
    ["white-space", "nowrap"],
    ["border-width", "0"],
  ],
  "not-sr-only": [
    ["position", "static"],
    ["width", "auto"],
    ["height", "auto"],
    ["padding", "0"],
    ["margin", "0"],
    ["overflow", "visible"],
    ["clip-path", "none"],
    ["white-space", "normal"],
  ],
  // box
  "box-border": [["box-sizing", "border-box"]],
  "box-content": [["box-sizing", "content-box"]],
  // tables
  "border-collapse": [["border-collapse", "collapse"]],
  "border-separate": [["border-collapse", "separate"]],
  "table-auto": [["table-layout", "auto"]],
  "table-fixed": [["table-layout", "fixed"]],
};

// ---------- functional utilities ----------

const F: Record<string, Handler> = {
  p: spacingUtil(["padding"]),
  px: spacingUtil(["padding-inline"]),
  py: spacingUtil(["padding-block"]),
  ps: spacingUtil(["padding-inline-start"]),
  pe: spacingUtil(["padding-inline-end"]),
  pt: spacingUtil(["padding-top"]),
  pr: spacingUtil(["padding-right"]),
  pb: spacingUtil(["padding-bottom"]),
  pl: spacingUtil(["padding-left"]),
  m: spacingUtil(["margin"], { auto: true, negative: true }),
  mx: spacingUtil(["margin-inline"], { auto: true, negative: true }),
  my: spacingUtil(["margin-block"], { auto: true, negative: true }),
  ms: spacingUtil(["margin-inline-start"], { auto: true, negative: true }),
  me: spacingUtil(["margin-inline-end"], { auto: true, negative: true }),
  mt: spacingUtil(["margin-top"], { auto: true, negative: true }),
  mr: spacingUtil(["margin-right"], { auto: true, negative: true }),
  mb: spacingUtil(["margin-bottom"], { auto: true, negative: true }),
  ml: spacingUtil(["margin-left"], { auto: true, negative: true }),
  gap: spacingUtil(["gap"]),
  "gap-x": spacingUtil(["column-gap"]),
  "gap-y": spacingUtil(["row-gap"]),
  inset: spacingUtil(["inset"], {
    auto: true,
    negative: true,
    fraction: true,
    full: true,
  }),
  "inset-x": spacingUtil(["inset-inline"], {
    auto: true,
    negative: true,
    fraction: true,
    full: true,
  }),
  "inset-y": spacingUtil(["inset-block"], {
    auto: true,
    negative: true,
    fraction: true,
    full: true,
  }),
  top: spacingUtil(["top"], {
    auto: true,
    negative: true,
    fraction: true,
    full: true,
  }),
  right: spacingUtil(["right"], {
    auto: true,
    negative: true,
    fraction: true,
    full: true,
  }),
  bottom: spacingUtil(["bottom"], {
    auto: true,
    negative: true,
    fraction: true,
    full: true,
  }),
  left: spacingUtil(["left"], {
    auto: true,
    negative: true,
    fraction: true,
    full: true,
  }),

  w: sizeUtil("width", "w", { container: true }),
  h: sizeUtil("height", "h"),
  "min-w": sizeUtil("min-width", "w", { container: true }),
  "min-h": sizeUtil("min-height", "h"),
  "max-w": (value, ctx) => {
    if (value === "none")
      return ctx.negative || ctx.modifier
        ? null
        : out([d("max-width", "none")]);
    if (value !== null && !ctx.negative && !ctx.modifier) {
      const inline = ctx.theme.inline.get(`--max-width-${value}`);
      if (inline !== undefined) return out([d("max-width", inline)]);
    }
    return sizeUtil("max-width", "w", { container: true })(value, ctx);
  },
  "max-h": sizeUtil("max-height", "h"),
  size: (value, ctx) => {
    const w = sizeUtil("width", "w")(value, ctx);
    const h = sizeUtil("height", "h")(value, ctx);
    if (!w || !h) return null;
    return out([...w.nodes, ...h.nodes]);
  },

  bg: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    return colorDecl(["background-color"], value, ctx);
  },

  text: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    // font-size path
    if (ctx.theme.has(`--text-${value}`)) {
      const nodes = [d("font-size", `var(--text-${value})`)];
      if (ctx.modifier !== null) {
        let lh: string | null = null;
        const n = bareSpacing(ctx.modifier);
        if (n !== null) lh = spacingCalc(n, false);
        else if (ctx.theme.has(`--leading-${ctx.modifier}`))
          lh = `var(--leading-${ctx.modifier})`;
        else if (isArbitrary(ctx.modifier)) lh = arbitraryValue(ctx.modifier);
        if (lh === null) return null;
        nodes.push(d("line-height", lh));
        return out(nodes);
      }
      nodes.push(
        d(
          "line-height",
          `var(--tw-leading, var(--text-${value}--line-height))`,
        ),
      );
      return out(nodes);
    }
    if (isArbitrary(value)) {
      let a = arbitraryValue(value);
      if (a.startsWith("length:") || a.startsWith("size:"))
        return out([d("font-size", a.slice(a.indexOf(":") + 1))]);
      if (a.startsWith("color:")) return colorDecl(["color"], value, ctx);
      if (looksLikeColor(a) || a.startsWith("var("))
        return colorDecl(["color"], value, ctx);
      if (ctx.modifier !== null) return null;
      return out([d("font-size", a)]);
    }
    return colorDecl(["color"], value, ctx);
  },

  border: borderUtil(""),
  "border-t": borderUtil("top"),
  "border-r": borderUtil("right"),
  "border-b": borderUtil("bottom"),
  "border-l": borderUtil("left"),
  "border-x": borderUtil("inline"),
  "border-y": borderUtil("block"),
  "border-s": borderUtil("inline-start"),
  "border-e": borderUtil("inline-end"),

  rounded: roundedUtil([""]),
  "rounded-t": roundedUtil(["top-left", "top-right"]),
  "rounded-r": roundedUtil(["top-right", "bottom-right"]),
  "rounded-b": roundedUtil(["bottom-right", "bottom-left"]),
  "rounded-l": roundedUtil(["top-left", "bottom-left"]),
  "rounded-tl": roundedUtil(["top-left"]),
  "rounded-tr": roundedUtil(["top-right"]),
  "rounded-br": roundedUtil(["bottom-right"]),
  "rounded-bl": roundedUtil(["bottom-left"]),
  "rounded-s": roundedUtil(["start-start", "end-start"]),
  "rounded-e": roundedUtil(["start-end", "end-end"]),
  "rounded-ss": roundedUtil(["start-start"]),
  "rounded-se": roundedUtil(["start-end"]),
  "rounded-es": roundedUtil(["end-start"]),
  "rounded-ee": roundedUtil(["end-end"]),

  "outline-offset": (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    const px = bareToPx(value, ctx.negative);
    if (px) return out([d("outline-offset", px)]);
    if (isArbitrary(value))
      return out([
        d(
          "outline-offset",
          ctx.negative
            ? `calc(${arbitraryValue(value)} * -1)`
            : arbitraryValue(value),
        ),
      ]);
    return null;
  },

  z: (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    if (value === "auto")
      return ctx.negative ? null : out([d("z-index", "auto")]);
    if (/^\d+$/.test(value))
      return out([d("z-index", ctx.negative ? `calc(${value} * -1)` : value)]);
    if (isArbitrary(value) && !ctx.negative)
      return out([d("z-index", arbitraryValue(value))]);
    if (customProp(value) && !ctx.negative)
      return out([d("z-index", customProp(value)!)]);
    return null;
  },

  opacity: (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    if (/^\d+(\.\d+)?$/.test(value))
      return out([d("opacity", `${Number(value)}%`)]);
    if (isArbitrary(value)) return out([d("opacity", arbitraryValue(value))]);
    if (customProp(value)) return out([d("opacity", customProp(value)!)]);
    return null;
  },

  font: (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    if (ctx.theme.has(`--font-weight-${value}`)) {
      return out(
        [
          d("--tw-font-weight", `var(--font-weight-${value})`),
          d("font-weight", `var(--font-weight-${value})`),
        ],
        FONT_WEIGHT_PROPS,
      );
    }
    if (ctx.theme.has(`--font-${value}`))
      return out([d("font-family", `var(--font-${value})`)]);
    if (isArbitrary(value)) {
      const a = arbitraryValue(value);
      if (/^\d+$/.test(a))
        return out(
          [d("--tw-font-weight", a), d("font-weight", a)],
          FONT_WEIGHT_PROPS,
        );
      return out([d("font-family", a)]);
    }
    return null;
  },

  leading: (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    let v: string | null = null;
    if (value === "none") v = "1";
    else if (ctx.theme.has(`--leading-${value}`)) v = `var(--leading-${value})`;
    else if (isArbitrary(value)) v = arbitraryValue(value);
    else if (customProp(value)) v = customProp(value);
    else {
      const n = bareSpacing(value);
      if (n === null) return null;
      v = spacingCalc(n, false);
    }
    return out([d("--tw-leading", v!), d("line-height", v!)], LEADING_PROPS);
  },

  tracking: (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    let v: string | null = null;
    if (ctx.theme.has(`--tracking-${value}`)) {
      v = `var(--tracking-${value})`;
      if (ctx.negative) v = `calc(${v} * -1)`;
    } else if (isArbitrary(value)) {
      v = arbitraryValue(value);
      if (ctx.negative) v = `calc(${v} * -1)`;
    } else if (customProp(value)) {
      v = customProp(value)!;
      if (ctx.negative) v = `calc(${v} * -1)`;
    } else return null;
    return out([d("--tw-tracking", v), d("letter-spacing", v)], TRACKING_PROPS);
  },

  duration: (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    let v: string | null = null;
    if (value === "initial") v = "initial";
    else if (/^\d+(\.\d+)?$/.test(value)) v = `${value}ms`;
    else if (isArbitrary(value)) v = arbitraryValue(value);
    else return null;
    return out(
      [d("--tw-duration", v), d("transition-duration", v)],
      DURATION_PROPS,
    );
  },

  delay: (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    if (/^\d+(\.\d+)?$/.test(value))
      return out([d("transition-delay", `${value}ms`)]);
    if (isArbitrary(value))
      return out([d("transition-delay", arbitraryValue(value))]);
    return null;
  },

  ease: (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    if (value === "initial")
      return out([d("--tw-ease", "initial")], EASE_PROPS);
    let v: string | null = null;
    if (value === "linear") v = "linear";
    else if (ctx.theme.has(`--ease-${value}`)) v = `var(--ease-${value})`;
    else if (isArbitrary(value)) v = arbitraryValue(value);
    else return null;
    return out(
      [d("--tw-ease", v), d("transition-timing-function", v)],
      EASE_PROPS,
    );
  },

  animate: (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    if (value === "none") return out([d("animation", "none")]);
    if (ctx.theme.has(`--animate-${value}`))
      return out([d("animation", `var(--animate-${value})`)]);
    if (isArbitrary(value)) return out([d("animation", arbitraryValue(value))]);
    return null;
  },

  transition: (value, ctx) => {
    if (ctx.negative || ctx.modifier) return null;
    const TIMING = [
      d(
        "transition-timing-function",
        "var(--tw-ease, var(--default-transition-timing-function))",
      ),
      d(
        "transition-duration",
        "var(--tw-duration, var(--default-transition-duration))",
      ),
    ];
    const COLORS =
      "color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to";
    const DEFAULT = `${COLORS}, opacity, box-shadow, transform, translate, scale, rotate, filter, -webkit-backdrop-filter, backdrop-filter, display, content-visibility, overlay, pointer-events`;
    if (value === null)
      return out([d("transition-property", DEFAULT), ...TIMING]);
    if (value === "all")
      return out([d("transition-property", "all"), ...TIMING]);
    if (value === "colors")
      return out([d("transition-property", COLORS), ...TIMING]);
    if (value === "opacity")
      return out([d("transition-property", "opacity"), ...TIMING]);
    if (value === "shadow")
      return out([d("transition-property", "box-shadow"), ...TIMING]);
    if (value === "transform")
      return out([
        d("transition-property", "transform, translate, scale, rotate"),
        ...TIMING,
      ]);
    if (value === "none") return out([d("transition-property", "none")]);
    if (isArbitrary(value))
      return out([d("transition-property", arbitraryValue(value)), ...TIMING]);
    return null;
  },

  shadow: (value, ctx) => {
    if (ctx.negative) return null;
    const boxShadow = d("box-shadow", BOX_SHADOW_VALUE);
    if (value === "none")
      return ctx.modifier
        ? null
        : out([d("--tw-shadow", "0 0 #0000"), boxShadow], SHADOW_PROPS);
    if (value === "initial")
      return ctx.modifier
        ? null
        : out([d("--tw-shadow-color", "initial")], SHADOW_PROPS);
    const themeKey = value === null ? "--shadow" : `--shadow-${value}`;
    const raw = ctx.theme.get(themeKey);
    if (raw !== undefined) {
      const alpha = shadowAlpha(ctx);
      if (alpha === undefined) return null;
      const folded = foldShadowColors(
        raw,
        "--tw-shadow-color",
        alpha ?? undefined,
      );
      const nodes = alpha ? [d("--tw-shadow-alpha", alpha)] : [];
      return out([...nodes, d("--tw-shadow", folded), boxShadow], SHADOW_PROPS);
    }
    if (value !== null && isArbitrary(value)) {
      const arb = arbitraryValue(value);
      if (!looksLikeColor(arb) && !arb.startsWith("var(")) {
        if (ctx.modifier) return null;
        return out(
          [
            d("--tw-shadow", foldShadowColors(arb, "--tw-shadow-color")),
            boxShadow,
          ],
          SHADOW_PROPS,
        );
      }
    }
    if (value === null) return null;
    const cm = shadowColorValue(value, ctx, "--tw-shadow-alpha");
    if (cm === null) return null;
    return out([d("--tw-shadow-color", cm)], SHADOW_PROPS);
  },

  ring: (value, ctx) => {
    if (ctx.negative) return null;
    const width =
      value === null
        ? "1px"
        : /^\d+$/.test(value)
          ? `${value}px`
          : isArbitrary(value)
            ? arbitraryValue(value)
            : null;
    if (width !== null && !ctx.modifier) {
      const looksColor = width !== null && looksLikeColor(width);
      if (!looksColor)
        return out(
          [
            d(
              "--tw-ring-shadow",
              `var(--tw-ring-inset,) 0 0 0 calc(${width} + var(--tw-ring-offset-width)) var(--tw-ring-color, currentcolor)`,
            ),
            d("box-shadow", BOX_SHADOW_VALUE),
          ],
          SHADOW_PROPS,
        );
    }
    if (value === null) return null;
    const c = resolveColor(value, ctx);
    if (c === null) return null;
    const cm = withOpacity(c, ctx.modifier);
    if (cm === null) return null;
    return out([d("--tw-ring-color", cm)]);
  },

  outline: (value, ctx) => {
    if (ctx.negative) return null;
    // outline / outline-2 width path, outline-color path
    if (value === null)
      return ctx.modifier
        ? null
        : out(
            [
              d("outline-style", "var(--tw-outline-style)"),
              d("outline-width", "1px"),
            ],
            OUTLINE_STYLE_PROPS,
          );
    if (/^\d+$/.test(value) && !ctx.modifier)
      return out(
        [
          d("outline-style", "var(--tw-outline-style)"),
          d("outline-width", `${value}px`),
        ],
        OUTLINE_STYLE_PROPS,
      );
    const c = resolveColor(value, ctx);
    if (c !== null) {
      const cm = withOpacity(c, ctx.modifier);
      if (cm === null) return null;
      return out([d("outline-color", cm)]);
    }
    return null;
  },

  "underline-offset": (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    if (value === "auto")
      return ctx.negative ? null : out([d("text-underline-offset", "auto")]);
    const px = bareToPx(value, ctx.negative);
    if (px) return out([d("text-underline-offset", px)]);
    if (isArbitrary(value))
      return out([
        d(
          "text-underline-offset",
          ctx.negative
            ? `calc(${arbitraryValue(value)} * -1)`
            : arbitraryValue(value),
        ),
      ]);
    return null;
  },

  decoration: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    // thickness: decoration-2, decoration-[3px]; colors otherwise
    if (/^\d+$/.test(value) && !ctx.modifier)
      return out([d("text-decoration-thickness", `${value}px`)]);
    if (value === "auto" && !ctx.modifier)
      return out([d("text-decoration-thickness", "auto")]);
    if (value === "from-font" && !ctx.modifier)
      return out([d("text-decoration-thickness", "from-font")]);
    return colorDecl(["text-decoration-color"], value, ctx);
  },

  "grid-cols": gridTemplate("grid-template-columns"),
  "grid-rows": gridTemplate("grid-template-rows"),
  "col-span": gridSpan("grid-column"),
  "row-span": gridSpan("grid-row"),

  "translate-x": translateUtil("x"),
  "translate-y": translateUtil("y"),

  "space-x": spaceUtil("x"),
  "space-y": spaceUtil("y"),
  "divide-x": divideUtil("x"),
  "divide-y": divideUtil("y"),
  divide: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    const c = resolveColor(value, ctx);
    if (c === null) return null;
    const cm = withOpacity(c, ctx.modifier);
    if (cm === null) return null;
    return {
      nodes: [d("border-color", cm)],
      selectorWrap: (sel) => `:where(${sel} > :not(:last-child))`,
    };
  },

  flex: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    const joined = rejoinFraction(value, ctx);
    if (joined === undefined) return null;
    const v = joined!;
    if (/^\d+$/.test(v)) return out([d("flex", v)]);
    if (fraction(v)) return out([d("flex", fraction(v)!)]);
    if (isArbitrary(v)) return out([d("flex", arbitraryValue(v))]);
    if (customProp(v)) return out([d("flex", customProp(v)!)]);
    return null;
  },

  placeholder: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    const c = colorDecl(["color"], value, ctx);
    if (c === null) return null;
    return { ...c, selectorWrap: (sel) => `${sel}::placeholder` };
  },

  "ring-offset": (value, ctx) => {
    if (value === null || ctx.negative) return null;
    if (/^\d+$/.test(value) && !ctx.modifier)
      return out([
        d("--tw-ring-offset-width", `${value}px`),
        d(
          "--tw-ring-offset-shadow",
          "var(--tw-ring-inset,) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color)",
        ),
      ]);
    if (isArbitrary(value) && !ctx.modifier) {
      const a = arbitraryValue(value);
      if (!looksLikeColor(a))
        return out([
          d("--tw-ring-offset-width", a),
          d(
            "--tw-ring-offset-shadow",
            "var(--tw-ring-inset,) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color)",
          ),
        ]);
    }
    const c = resolveColor(value, ctx);
    if (c === null) return null;
    const cm = withOpacity(c, ctx.modifier);
    if (cm === null) return null;
    return out([d("--tw-ring-offset-color", cm)]);
  },

  cursor: (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    const CURSORS = new Set([
      "auto",
      "default",
      "pointer",
      "wait",
      "text",
      "move",
      "help",
      "not-allowed",
      "none",
      "context-menu",
      "progress",
      "cell",
      "crosshair",
      "vertical-text",
      "alias",
      "copy",
      "no-drop",
      "grab",
      "grabbing",
      "all-scroll",
      "col-resize",
      "row-resize",
      "n-resize",
      "e-resize",
      "s-resize",
      "w-resize",
      "ne-resize",
      "nw-resize",
      "se-resize",
      "sw-resize",
      "ew-resize",
      "ns-resize",
      "nesw-resize",
      "nwse-resize",
      "zoom-in",
      "zoom-out",
    ]);
    if (CURSORS.has(value)) return out([d("cursor", value)]);
    if (isArbitrary(value)) return out([d("cursor", arbitraryValue(value)!)]);
    if (customProp(value)) return out([d("cursor", customProp(value)!)]);
    return null;
  },

  fill: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    if (value === "none") return out([d("fill", "none")]);
    return colorDecl(["fill"], value, ctx);
  },
  stroke: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    if (value === "none") return out([d("stroke", "none")]);
    if (/^\d+$/.test(value) && !ctx.modifier)
      return out([d("stroke-width", value)]);
    return colorDecl(["stroke"], value, ctx);
  },
  accent: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    if (value === "auto") return out([d("accent-color", "auto")]);
    return colorDecl(["accent-color"], value, ctx);
  },
  caret: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    return colorDecl(["caret-color"], value, ctx);
  },
};

/**
 * Rewrite each shadow's color to var(--tw-shadow-color, <color>) like v4.
 * With an opacity modifier, the fallback becomes a relative-color transform:
 * oklab(from <color> l a b / <alpha>).
 */
function foldShadowColors(
  shadowList: string,
  colorVar: string,
  alpha?: string,
): string {
  const shadows = splitTopLevelCommas(shadowList);
  return shadows
    .map((shadow) => {
      const parts = splitTopLevelSpaces(shadow.trim());
      let colorIdx = -1;
      for (let i = 0; i < parts.length; i++) {
        if (looksLikeColor(parts[i]!)) {
          colorIdx = i;
          break;
        }
      }
      if (colorIdx === -1) return shadow.trim();
      const fallback = alpha
        ? `oklab(from ${parts[colorIdx]} l a b / ${alpha})`
        : parts[colorIdx];
      parts[colorIdx] = `var(${colorVar}, ${fallback})`;
      return parts.join(" ");
    })
    .join(", ");
}

/** numeric opacity modifier for shadow-family alpha machinery */
function shadowAlpha(ctx: Ctx): string | null | undefined {
  if (ctx.modifier === null) return null; // no modifier
  if (/^\d+(\.\d+)?$/.test(ctx.modifier)) return `${Number(ctx.modifier)}%`;
  return undefined; // unsupported modifier form
}

function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function splitTopLevelSpaces(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === " " && depth === 0) {
      if (i > start) parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (s.length > start) parts.push(s.slice(start));
  return parts;
}

function borderUtil(side: string): Handler {
  const widthProps =
    side === ""
      ? ["border-width"]
      : side === "inline" || side === "block"
        ? [`border-${side}-width`]
        : [`border-${side}-width`];
  const styleProps =
    side === ""
      ? ["border-style"]
      : side === "inline" || side === "block"
        ? [`border-${side}-style`]
        : [`border-${side}-style`];
  const colorProps = side === "" ? ["border-color"] : [`border-${side}-color`];
  const BORDER_STYLES = new Set([
    "solid",
    "dashed",
    "dotted",
    "double",
    "hidden",
    "none",
  ]);
  return (value, ctx) => {
    if (ctx.negative) return null;
    // width path
    if (value === null || /^\d+$/.test(value)) {
      if (ctx.modifier) return null;
      const w = value === null ? "1px" : `${value}px`;
      return out(
        [
          ...styleProps.map((p) => d(p, "var(--tw-border-style)")),
          ...widthProps.map((p) => d(p, w)),
        ],
        BORDER_STYLE_PROPS,
      );
    }
    if (BORDER_STYLES.has(value)) {
      if (ctx.modifier) return null;
      return out([
        d("--tw-border-style", value),
        ...styleProps.map((p) => d(p, value)),
      ]);
    }
    if (isArbitrary(value)) {
      const a = arbitraryValue(value);
      if (!looksLikeColor(a) && !a.startsWith("var(")) {
        if (ctx.modifier) return null;
        return out(
          [
            ...styleProps.map((p) => d(p, "var(--tw-border-style)")),
            ...widthProps.map((p) => d(p, a)),
          ],
          BORDER_STYLE_PROPS,
        );
      }
    }
    return colorDecl(colorProps, value, ctx);
  };
}

function roundedUtil(corners: string[]): Handler {
  const props = corners.map((c) =>
    c === "" ? "border-radius" : `border-${c}-radius`,
  );
  return (value, ctx) => {
    if (ctx.negative || ctx.modifier) return null;
    let v: string | null = null;
    if (value === null) v = ctx.theme.get("--radius") ?? null;
    else if (value === "none") v = "0";
    else if (value === "full") v = "calc(infinity * 1px)";
    else if (ctx.theme.has(`--radius-${value}`)) v = `var(--radius-${value})`;
    else if (isArbitrary(value)) v = arbitraryValue(value);
    else if (customProp(value)) v = customProp(value);
    if (v === null) return null;
    return out(props.map((p) => d(p, v!)));
  };
}

function gridTemplate(prop: string): Handler {
  return (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    if (/^\d+$/.test(value) && Number(value) > 0)
      return out([d(prop, `repeat(${value}, minmax(0, 1fr))`)]);
    if (value === "none") return out([d(prop, "none")]);
    if (value === "subgrid") return out([d(prop, "subgrid")]);
    if (isArbitrary(value)) return out([d(prop, arbitraryValue(value))]);
    return null;
  };
}

function gridSpan(prop: string): Handler {
  return (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    if (/^\d+$/.test(value))
      return out([d(prop, `span ${value} / span ${value}`)]);
    if (value === "full") return out([d(prop, "1 / -1")]);
    return null;
  };
}

function translateUtil(axis: "x" | "y"): Handler {
  return (rawValue, ctx) => {
    if (rawValue === null) return null;
    const joined = rejoinFraction(rawValue, ctx);
    if (joined === undefined) return null;
    const value = joined!;
    let v: string | null = null;
    if (value === "px") v = ctx.negative ? "-1px" : "1px";
    else if (value === "full") v = ctx.negative ? "-100%" : "100%";
    else if (fraction(value))
      v = ctx.negative ? `calc(${fraction(value)} * -1)` : fraction(value)!;
    else if (isArbitrary(value))
      v = ctx.negative
        ? `calc(${arbitraryValue(value)} * -1)`
        : arbitraryValue(value);
    else {
      const n = bareSpacing(value);
      if (n === null) return null;
      v = spacingCalc(n, ctx.negative);
    }
    return out(
      [
        d(`--tw-translate-${axis}`, v!),
        d("translate", "var(--tw-translate-x) var(--tw-translate-y)"),
      ],
      TRANSLATE_PROPS,
    );
  };
}

function spaceUtil(axis: "x" | "y"): Handler {
  const props =
    axis === "x"
      ? ["margin-inline-start", "margin-inline-end"]
      : ["margin-block-start", "margin-block-end"];
  return (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    let v: string | null = null;
    if (value === "px") v = ctx.negative ? "-1px" : "1px";
    else if (isArbitrary(value))
      v = ctx.negative
        ? `calc(${arbitraryValue(value)} * -1)`
        : arbitraryValue(value);
    else {
      const n = bareSpacing(value);
      if (n === null) return null;
      v = spacingCalc(n, ctx.negative);
    }
    const rev = `--tw-space-${axis}-reverse`;
    const zero = v === "0px";
    return {
      nodes: [
        d(rev, "0"),
        d(props[0]!, zero ? "0" : `calc(${v} * var(${rev}))`),
        d(props[1]!, zero ? "0" : `calc(${v} * calc(1 - var(${rev})))`),
      ],
      properties: [P(rev, "0")],
      selectorWrap: (sel) => `:where(${sel} > :not(:last-child))`,
    };
  };
}

function divideUtil(axis: "x" | "y"): Handler {
  const [styles, widthA, widthB] =
    axis === "x"
      ? [
          ["border-inline-style"],
          "border-inline-start-width",
          "border-inline-end-width",
        ]
      : [
          ["border-bottom-style", "border-top-style"],
          "border-top-width",
          "border-bottom-width",
        ];
  return (value, ctx) => {
    if (ctx.negative || ctx.modifier) return null;
    let w: string | null = null;
    if (value === null) w = "1px";
    else if (/^\d+$/.test(value)) w = `${value}px`;
    else if (isArbitrary(value)) w = arbitraryValue(value);
    else return null;
    const rev = `--tw-divide-${axis}-reverse`;
    return {
      nodes: [
        d(rev, "0"),
        ...styles.map((sp) => d(sp, "var(--tw-border-style)")),
        d(widthA, `calc(${w} * var(${rev}))`),
        d(widthB, `calc(${w} * calc(1 - var(${rev})))`),
      ],
      properties: [P(rev, "0"), ...BORDER_STYLE_PROPS],
      selectorWrap: (sel) => `:where(${sel} > :not(:last-child))`,
    };
  };
}

// ---------- composed families: filters, transforms, gradients, masks ----------

const GRADIENT_PROPS = [
  P("--tw-gradient-position"),
  P("--tw-gradient-from", "#0000", "<color>"),
  P("--tw-gradient-via", "#0000", "<color>"),
  P("--tw-gradient-to", "#0000", "<color>"),
  P("--tw-gradient-stops"),
  P("--tw-gradient-via-stops"),
  P("--tw-gradient-from-position", "0%", "<length-percentage>"),
  P("--tw-gradient-via-position", "50%", "<length-percentage>"),
  P("--tw-gradient-to-position", "100%", "<length-percentage>"),
];
const FILTER_PROPS = [
  P("--tw-blur"),
  P("--tw-brightness"),
  P("--tw-contrast"),
  P("--tw-grayscale"),
  P("--tw-hue-rotate"),
  P("--tw-invert"),
  P("--tw-opacity"),
  P("--tw-saturate"),
  P("--tw-sepia"),
  P("--tw-drop-shadow"),
  P("--tw-drop-shadow-color"),
  P("--tw-drop-shadow-alpha", "100%", "<percentage>"),
  P("--tw-drop-shadow-size"),
];
const BACKDROP_PROPS = [
  P("--tw-backdrop-blur"),
  P("--tw-backdrop-brightness"),
  P("--tw-backdrop-contrast"),
  P("--tw-backdrop-grayscale"),
  P("--tw-backdrop-hue-rotate"),
  P("--tw-backdrop-invert"),
  P("--tw-backdrop-opacity"),
  P("--tw-backdrop-saturate"),
  P("--tw-backdrop-sepia"),
];
const TRANSFORM_PROPS = [
  P("--tw-rotate-x"),
  P("--tw-rotate-y"),
  P("--tw-rotate-z"),
  P("--tw-skew-x"),
  P("--tw-skew-y"),
];
const SCALE_PROPS = [
  P("--tw-scale-x", "1"),
  P("--tw-scale-y", "1"),
  P("--tw-scale-z", "1"),
];
const TEXT_SHADOW_PROPS = [
  P("--tw-text-shadow-color"),
  P("--tw-text-shadow-alpha", "100%", "<percentage>"),
];
const SCROLLBAR_PROPS = [
  P("--tw-scrollbar-thumb", "#0000", "<color>"),
  P("--tw-scrollbar-track", "#0000", "<color>"),
];

const FILTER_VALUE =
  "var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)";
const BACKDROP_VALUE =
  "var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,)";
const TRANSFORM_VALUE =
  "var(--tw-rotate-x,) var(--tw-rotate-y,) var(--tw-rotate-z,) var(--tw-skew-x,) var(--tw-skew-y,)";
const GRADIENT_STOPS_VALUE =
  "var(--tw-gradient-via-stops, var(--tw-gradient-position), var(--tw-gradient-from) var(--tw-gradient-from-position), var(--tw-gradient-to) var(--tw-gradient-to-position))";

const filterDecl = () => d("filter", FILTER_VALUE);
const backdropDecls = () => [
  d("-webkit-backdrop-filter", BACKDROP_VALUE),
  d("backdrop-filter", BACKDROP_VALUE),
];

/** shadow-family color values: color-mix(in oklab, C var(--X-alpha), transparent) */
function shadowColorValue(
  v: string,
  ctx: Ctx,
  alphaVar: string,
): string | null {
  const base = resolveColor(v, ctx);
  if (base === null) return null;
  if (base === "inherit") return ctx.modifier ? null : "inherit";
  const c = withOpacity(base, ctx.modifier);
  if (c === null) return null;
  return `color-mix(in oklab, ${c} var(${alphaVar}), transparent)`;
}

/** percentage-taking filter fn (brightness, contrast, …) */
function pctFilter(
  fn: string,
  twVar: string,
  props: PropDef[],
  tail: () => ReturnType<typeof d>[],
  bareDefault?: string,
): Handler {
  return (value, ctx) => {
    if (ctx.negative || ctx.modifier) return null;
    let arg: string | null = null;
    if (value === null && bareDefault !== undefined) arg = bareDefault;
    else if (value !== null && /^\d+(\.\d+)?$/.test(value)) arg = `${value}%`;
    else if (value !== null && isArbitrary(value)) arg = arbitraryValue(value);
    else if (value !== null && customProp(value)) arg = customProp(value)!;
    else return null;
    return out([d(twVar, `${fn}(${arg})`), ...tail()], props);
  };
}

const COMPOSED: Record<string, Handler> = {
  // --- filters ---
  blur: (value, ctx) => {
    if (ctx.negative || ctx.modifier) return null;
    let arg: string | null = null;
    if (value === "none")
      return out([d("--tw-blur", " "), filterDecl()], FILTER_PROPS);
    if (value === null) arg = ctx.theme.get("--blur") ?? null;
    else if (ctx.theme.has(`--blur-${value}`)) arg = `var(--blur-${value})`;
    else if (isArbitrary(value)) arg = arbitraryValue(value);
    else if (customProp(value)) arg = customProp(value);
    if (arg === null) return null;
    return out([d("--tw-blur", `blur(${arg})`), filterDecl()], FILTER_PROPS);
  },
  brightness: pctFilter("brightness", "--tw-brightness", FILTER_PROPS, () => [
    filterDecl(),
  ]),
  contrast: pctFilter("contrast", "--tw-contrast", FILTER_PROPS, () => [
    filterDecl(),
  ]),
  saturate: pctFilter("saturate", "--tw-saturate", FILTER_PROPS, () => [
    filterDecl(),
  ]),
  grayscale: pctFilter(
    "grayscale",
    "--tw-grayscale",
    FILTER_PROPS,
    () => [filterDecl()],
    "100%",
  ),
  invert: pctFilter(
    "invert",
    "--tw-invert",
    FILTER_PROPS,
    () => [filterDecl()],
    "100%",
  ),
  sepia: pctFilter(
    "sepia",
    "--tw-sepia",
    FILTER_PROPS,
    () => [filterDecl()],
    "100%",
  ),
  "hue-rotate": (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    let arg: string | null = null;
    if (/^\d+(\.\d+)?$/.test(value))
      arg = ctx.negative ? `calc(${value}deg * -1)` : `${value}deg`;
    else if (isArbitrary(value) && !ctx.negative) arg = arbitraryValue(value);
    if (arg === null) return null;
    return out(
      [d("--tw-hue-rotate", `hue-rotate(${arg})`), filterDecl()],
      FILTER_PROPS,
    );
  },
  "drop-shadow": (value, ctx) => {
    if (ctx.negative) return null;
    if (value === "none") {
      if (ctx.modifier) return null;
      return out([d("--tw-drop-shadow", " "), filterDecl()], FILTER_PROPS);
    }
    const themeKey =
      value === null ? "--drop-shadow" : `--drop-shadow-${value}`;
    const raw = ctx.theme.get(themeKey);
    if (raw !== undefined) {
      if (ctx.modifier) return null;
      const size = splitTopLevelCommas(raw)
        .map(
          (s) =>
            `drop-shadow(${foldShadowColors(s.trim(), "--tw-drop-shadow-color")})`,
        )
        .join(" ");
      return out(
        [
          d("--tw-drop-shadow-size", size),
          d(
            "--tw-drop-shadow",
            value === null
              ? "var(--tw-drop-shadow-size)"
              : `drop-shadow(var(${themeKey}))`,
          ),
          filterDecl(),
        ],
        FILTER_PROPS,
      );
    }
    if (value !== null && isArbitrary(value)) {
      const a = arbitraryValue(value);
      if (!looksLikeColor(a) && !a.startsWith("var(")) {
        if (ctx.modifier) return null;
        const size = splitTopLevelCommas(a)
          .map(
            (s) =>
              `drop-shadow(${foldShadowColors(s.trim(), "--tw-drop-shadow-color")})`,
          )
          .join(" ");
        return out(
          [
            d("--tw-drop-shadow-size", size),
            d("--tw-drop-shadow", "var(--tw-drop-shadow-size)"),
            filterDecl(),
          ],
          FILTER_PROPS,
        );
      }
    }
    if (value === null) return null;
    const cm = shadowColorValue(value, ctx, "--tw-drop-shadow-alpha");
    if (cm === null) return null;
    return out(
      [
        d("--tw-drop-shadow-color", cm),
        d("--tw-drop-shadow", "var(--tw-drop-shadow-size)"),
      ],
      FILTER_PROPS,
    );
  },
  "filter-none": () => out([d("filter", "none")]),

  // --- backdrop filters ---
  "backdrop-blur": (value, ctx) => {
    if (ctx.negative || ctx.modifier) return null;
    let arg: string | null = null;
    if (value === "none")
      return out(
        [d("--tw-backdrop-blur", " "), ...backdropDecls()],
        BACKDROP_PROPS,
      );
    if (value === null) arg = ctx.theme.get("--blur") ?? null;
    else if (ctx.theme.has(`--blur-${value}`)) arg = `var(--blur-${value})`;
    else if (isArbitrary(value)) arg = arbitraryValue(value);
    else if (customProp(value)) arg = customProp(value);
    if (arg === null) return null;
    return out(
      [d("--tw-backdrop-blur", `blur(${arg})`), ...backdropDecls()],
      BACKDROP_PROPS,
    );
  },
  "backdrop-brightness": pctFilter(
    "brightness",
    "--tw-backdrop-brightness",
    BACKDROP_PROPS,
    backdropDecls,
  ),
  "backdrop-contrast": pctFilter(
    "contrast",
    "--tw-backdrop-contrast",
    BACKDROP_PROPS,
    backdropDecls,
  ),
  "backdrop-saturate": pctFilter(
    "saturate",
    "--tw-backdrop-saturate",
    BACKDROP_PROPS,
    backdropDecls,
  ),
  "backdrop-opacity": pctFilter(
    "opacity",
    "--tw-backdrop-opacity",
    BACKDROP_PROPS,
    backdropDecls,
  ),
  "backdrop-grayscale": pctFilter(
    "grayscale",
    "--tw-backdrop-grayscale",
    BACKDROP_PROPS,
    backdropDecls,
    "100%",
  ),
  "backdrop-invert": pctFilter(
    "invert",
    "--tw-backdrop-invert",
    BACKDROP_PROPS,
    backdropDecls,
    "100%",
  ),
  "backdrop-sepia": pctFilter(
    "sepia",
    "--tw-backdrop-sepia",
    BACKDROP_PROPS,
    backdropDecls,
    "100%",
  ),
  "backdrop-hue-rotate": (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    let arg: string | null = null;
    if (/^\d+(\.\d+)?$/.test(value))
      arg = ctx.negative ? `calc(${value}deg * -1)` : `${value}deg`;
    else if (isArbitrary(value) && !ctx.negative) arg = arbitraryValue(value);
    if (arg === null) return null;
    return out(
      [d("--tw-backdrop-hue-rotate", `hue-rotate(${arg})`), ...backdropDecls()],
      BACKDROP_PROPS,
    );
  },
  "backdrop-filter-none": () =>
    out([d("-webkit-backdrop-filter", "none"), d("backdrop-filter", "none")]),

  // --- transforms ---
  rotate: (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    if (value === "none")
      return ctx.negative ? null : out([d("rotate", "none")]);
    if (/^\d+(\.\d+)?$/.test(value))
      return out([
        d("rotate", ctx.negative ? `calc(${value}deg * -1)` : `${value}deg`),
      ]);
    if (isArbitrary(value) && !ctx.negative)
      return out([d("rotate", arbitraryValue(value))]);
    return null;
  },
  scale: (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    if (value === "none")
      return ctx.negative ? null : out([d("scale", "none")]);
    if (/^\d+(\.\d+)?$/.test(value)) {
      const v = ctx.negative ? `calc(${value}% * -1)` : `${value}%`;
      return out(
        [
          d("--tw-scale-x", v),
          d("--tw-scale-y", v),
          d("--tw-scale-z", v),
          d("scale", "var(--tw-scale-x) var(--tw-scale-y)"),
        ],
        SCALE_PROPS,
      );
    }
    if (isArbitrary(value) && !ctx.negative)
      return out([d("scale", arbitraryValue(value))]);
    return null;
  },
  transform: (value, ctx) => {
    if (ctx.negative || ctx.modifier) return null;
    if (value === null)
      return out([d("transform", TRANSFORM_VALUE)], TRANSFORM_PROPS);
    if (value === "none") return out([d("transform", "none")]);
    if (value === "gpu")
      return out([d("transform", `translateZ(0) ${TRANSFORM_VALUE}`)]);
    if (value === "cpu") return out([d("transform", TRANSFORM_VALUE)]);
    if (isArbitrary(value)) return out([d("transform", arbitraryValue(value))]);
    return null;
  },
  translate: (value, ctx) => {
    if (value === null) return null;
    if (value === "none")
      return ctx.negative || ctx.modifier
        ? null
        : out([d("translate", "none")]);
    const joined = rejoinFraction(value, ctx);
    if (joined === undefined) return null;
    const v = translateValue(joined!, ctx);
    if (v === null) return null;
    return out(
      [
        d("--tw-translate-x", v),
        d("--tw-translate-y", v),
        d("translate", "var(--tw-translate-x) var(--tw-translate-y)"),
      ],
      TRANSLATE_PROPS,
    );
  },
  "translate-z": (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    const v = translateValue(value, ctx);
    if (v === null) return null;
    return out(
      [
        d("--tw-translate-z", v),
        d(
          "translate",
          "var(--tw-translate-x) var(--tw-translate-y) var(--tw-translate-z)",
        ),
      ],
      TRANSLATE_PROPS,
    );
  },

  // --- gradient stops ---
  from: gradientStop("from"),
  via: gradientStop("via"),
  to: gradientStop("to"),

  // --- text-shadow ---
  "text-shadow": (value, ctx) => {
    if (ctx.negative) return null;
    if (value === "none")
      return ctx.modifier
        ? null
        : out([d("text-shadow", "none")], TEXT_SHADOW_PROPS);
    if (value === "initial")
      return ctx.modifier
        ? null
        : out([d("--tw-text-shadow-color", "initial")], TEXT_SHADOW_PROPS);
    const themeKey =
      value === null ? "--text-shadow" : `--text-shadow-${value}`;
    const raw = ctx.theme.get(themeKey);
    if (raw !== undefined) {
      const alpha = shadowAlpha(ctx);
      if (alpha === undefined) return null;
      const nodes = alpha ? [d("--tw-text-shadow-alpha", alpha)] : [];
      return out(
        [
          ...nodes,
          d(
            "text-shadow",
            foldShadowColors(raw, "--tw-text-shadow-color", alpha ?? undefined),
          ),
        ],
        TEXT_SHADOW_PROPS,
      );
    }
    if (value !== null && isArbitrary(value)) {
      const a = arbitraryValue(value);
      if (!looksLikeColor(a) && !a.startsWith("var(")) {
        if (ctx.modifier) return null;
        return out(
          [d("text-shadow", foldShadowColors(a, "--tw-text-shadow-color"))],
          TEXT_SHADOW_PROPS,
        );
      }
    }
    if (value === null) return null;
    const cm = shadowColorValue(value, ctx, "--tw-text-shadow-alpha");
    if (cm === null) return null;
    return out([d("--tw-text-shadow-color", cm)], TEXT_SHADOW_PROPS);
  },

  // --- scrollbar ---
  "scrollbar-thumb": scrollbarColor("--tw-scrollbar-thumb"),
  "scrollbar-track": scrollbarColor("--tw-scrollbar-track"),

  // --- inset ring / inset shadow ---
  "inset-ring": (value, ctx) => {
    if (ctx.negative) return null;
    const width =
      value === null
        ? "1px"
        : /^\d+$/.test(value)
          ? `${value}px`
          : isArbitrary(value) && !looksLikeColor(arbitraryValue(value))
            ? arbitraryValue(value)
            : null;
    if (width !== null && !ctx.modifier)
      return out(
        [
          d(
            "--tw-inset-ring-shadow",
            `inset 0 0 0 ${width} var(--tw-inset-ring-color, currentcolor)`,
          ),
          d("box-shadow", BOX_SHADOW_VALUE),
        ],
        SHADOW_PROPS,
      );
    if (value === null) return null;
    const c = resolveColor(value, ctx);
    if (c === null) return null;
    const cm = withOpacity(c, ctx.modifier);
    if (cm === null) return null;
    return out([d("--tw-inset-ring-color", cm)]);
  },
  "inset-shadow": (value, ctx) => {
    if (ctx.negative) return null;
    const boxShadow = d("box-shadow", BOX_SHADOW_VALUE);
    if (value === "none")
      return ctx.modifier
        ? null
        : out(
            [d("--tw-inset-shadow", "inset 0 0 #0000"), boxShadow],
            SHADOW_PROPS,
          );
    if (value === "initial")
      return ctx.modifier
        ? null
        : out([d("--tw-inset-shadow-color", "initial")], SHADOW_PROPS);
    const themeKey =
      value === null ? "--inset-shadow" : `--inset-shadow-${value}`;
    const raw = ctx.theme.get(themeKey);
    if (raw !== undefined) {
      const alpha = shadowAlpha(ctx);
      if (alpha === undefined) return null;
      const folded = foldShadowColors(
        raw,
        "--tw-inset-shadow-color",
        alpha ?? undefined,
      );
      const nodes = alpha ? [d("--tw-inset-shadow-alpha", alpha)] : [];
      return out(
        [...nodes, d("--tw-inset-shadow", folded), boxShadow],
        SHADOW_PROPS,
      );
    }
    if (value !== null && isArbitrary(value)) {
      const a = arbitraryValue(value);
      if (!looksLikeColor(a) && !a.startsWith("var(")) {
        if (ctx.modifier) return null;
        return out(
          [
            d(
              "--tw-inset-shadow",
              `inset ${foldShadowColors(a, "--tw-inset-shadow-color")}`,
            ),
            boxShadow,
          ],
          SHADOW_PROPS,
        );
      }
    }
    if (value === null) return null;
    const cm = shadowColorValue(value, ctx, "--tw-inset-shadow-alpha");
    if (cm === null) return null;
    return out([d("--tw-inset-shadow-color", cm)], SHADOW_PROPS);
  },

  // --- misc ---
  indent: spacingUtil(["text-indent"], { negative: true }),
  zoom: (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    if (/^\d+(\.\d+)?$/.test(value)) return out([d("zoom", `${value}%`)]);
    if (isArbitrary(value)) return out([d("zoom", arbitraryValue(value))]);
    return null;
  },
  tab: (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    if (/^\d+$/.test(value)) return out([d("tab-size", value)]);
    if (isArbitrary(value)) return out([d("tab-size", arbitraryValue(value))]);
    return null;
  },
  "font-stretch": (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    if (/^\d+(\.\d+)?%$/.test(value)) return out([d("font-stretch", value)]);
    if (isArbitrary(value))
      return out([d("font-stretch", arbitraryValue(value))]);
    return null;
  },
  basis: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    const joined = rejoinFraction(value, ctx);
    if (joined === undefined) return null;
    const v = joined!;
    if (v === "full") return out([d("flex-basis", "100%")]);
    if (v === "auto") return out([d("flex-basis", "auto")]);
    if (v === "px") return out([d("flex-basis", "1px")]);
    if (ctx.theme.has(`--container-${v}`))
      return out([d("flex-basis", `var(--container-${v})`)]);
    if (fraction(v)) return out([d("flex-basis", fraction(v)!)]);
    if (isArbitrary(v)) return out([d("flex-basis", arbitraryValue(v))]);
    if (customProp(v)) return out([d("flex-basis", customProp(v)!)]);
    const n = bareSpacing(v);
    if (n === null) return null;
    return out([d("flex-basis", spacingCalc(n, false))]);
  },
  order: intUtil("order", { first: "-9999", last: "9999", none: "0" }),
  "row-start": intUtil("grid-row-start", { auto: "auto" }),
  "row-end": intUtil("grid-row-end", { auto: "auto" }),
  "col-start": intUtil("grid-column-start", { auto: "auto" }),
  "col-end": intUtil("grid-column-end", { auto: "auto" }),

  // logical sizing
  block: logicalSize("block-size"),
  inline: logicalSize("inline-size"),
  "min-block": logicalSize("min-block-size"),
  "min-inline": logicalSize("min-inline-size"),
  "max-block": logicalSize("max-block-size", { none: true }),
  "max-inline": logicalSize("max-inline-size", { none: true }),

  columns: (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    if (/^\d+$/.test(value)) return out([d("columns", value)]);
    if (value === "auto") return out([d("columns", "auto")]);
    if (ctx.theme.has(`--container-${value}`))
      return out([d("columns", `var(--container-${value})`)]);
    if (isArbitrary(value)) return out([d("columns", arbitraryValue(value))]);
    if (customProp(value)) return out([d("columns", customProp(value)!)]);
    return null;
  },

  perspective: (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    if (value === "none") return out([d("perspective", "none")]);
    if (ctx.theme.has(`--perspective-${value}`))
      return out([d("perspective", `var(--perspective-${value})`)]);
    if (isArbitrary(value))
      return out([d("perspective", arbitraryValue(value))]);
    if (customProp(value)) return out([d("perspective", customProp(value)!)]);
    return null;
  },

  "border-spacing": borderSpacing(["x", "y"]),
  "border-spacing-x": borderSpacing(["x"]),
  "border-spacing-y": borderSpacing(["y"]),

  "line-clamp": (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    if (value === "none")
      return out([
        d("overflow", "visible"),
        d("display", "block"),
        d("-webkit-box-orient", "horizontal"),
        d("-webkit-line-clamp", "unset"),
      ]);
    let n: string | null = null;
    if (/^\d+$/.test(value)) n = value;
    else if (isArbitrary(value)) n = arbitraryValue(value);
    else if (customProp(value)) n = customProp(value);
    if (n === null) return null;
    return out([
      d("overflow", "hidden"),
      d("display", "-webkit-box"),
      d("-webkit-box-orient", "vertical"),
      d("-webkit-line-clamp", n),
    ]);
  },

  aspect: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    const joined = rejoinFraction(value, ctx);
    if (joined === undefined) return null;
    const v = joined!;
    if (v === "auto") return out([d("aspect-ratio", "auto")]);
    if (v === "square") return out([d("aspect-ratio", "1 / 1")]);
    if (ctx.theme.has(`--aspect-${v}`))
      return out([d("aspect-ratio", `var(--aspect-${v})`)]);
    if (/^\d+\/\d+$/.test(v)) return out([d("aspect-ratio", v)]);
    if (isArbitrary(v)) return out([d("aspect-ratio", arbitraryValue(v))]);
    if (customProp(v)) return out([d("aspect-ratio", customProp(v)!)]);
    return null;
  },

  // gradient background images
  "bg-linear": bgGradient("linear"),
  "bg-conic": bgGradient("conic"),
  "bg-radial": bgGradient("radial"),
};

function intUtil(prop: string, named: Record<string, string> = {}): Handler {
  return (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    if (value in named)
      return ctx.negative ? null : out([d(prop, named[value]!)]);
    if (/^\d+$/.test(value))
      return out([d(prop, ctx.negative ? `calc(${value} * -1)` : value)]);
    if (isArbitrary(value) && !ctx.negative)
      return out([d(prop, arbitraryValue(value))]);
    if (customProp(value) && !ctx.negative)
      return out([d(prop, customProp(value)!)]);
    return null;
  };
}

function logicalSize(prop: string, opts: { none?: boolean } = {}): Handler {
  const vp = prop.includes("inline") ? "vw" : "vh";
  return (rawValue, ctx) => {
    if (rawValue === null || ctx.negative) return null;
    const joined = rejoinFraction(rawValue, ctx);
    if (joined === undefined) return null;
    const value = joined!;
    let css: string | null = null;
    if (value === "px") css = "1px";
    else if (value === "lh") css = "1lh";
    else if (value === "none" && opts.none) css = "none";
    else if (value === "screen") css = `100${vp}`;
    else if (/^[dls]v[wh]$/.test(value)) css = `100${value}`;
    else if (value in SIZE_NAMED) css = SIZE_NAMED[value]!;
    else if (ctx.theme.has(`--container-${value}`))
      css = `var(--container-${value})`;
    else if (fraction(value)) css = fraction(value);
    else if (isArbitrary(value)) css = arbitraryValue(value);
    else if (customProp(value)) css = customProp(value);
    else {
      const n = bareSpacing(value);
      if (n === null) return null;
      css = spacingCalc(n, false);
    }
    return out([d(prop, css!)]);
  };
}

const BORDER_SPACING_PROPS = [
  P("--tw-border-spacing-x", "0", "<length>"),
  P("--tw-border-spacing-y", "0", "<length>"),
];
function borderSpacing(axes: ("x" | "y")[]): Handler {
  return (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    let v: string | null = null;
    if (value === "px") v = "1px";
    else if (isArbitrary(value)) v = arbitraryValue(value);
    else if (customProp(value)) v = customProp(value);
    else {
      const n = bareSpacing(value);
      if (n === null) return null;
      v = spacingCalc(n, false);
    }
    return out(
      [
        ...axes.map((a) => d(`--tw-border-spacing-${a}`, v!)),
        d(
          "border-spacing",
          "var(--tw-border-spacing-x) var(--tw-border-spacing-y)",
        ),
      ],
      BORDER_SPACING_PROPS,
    );
  };
}

/** bg-linear-45, bg-linear-to-r, bg-conic-0, bg-radial-[at_50%_75%] */
function bgGradient(shape: "linear" | "conic" | "radial"): Handler {
  const SIDES: Record<string, string> = {
    t: "top",
    tr: "top right",
    r: "right",
    br: "bottom right",
    b: "bottom",
    bl: "bottom left",
    l: "left",
    tl: "top left",
  };
  return (value, ctx) => {
    if (
      ctx.modifier !== null &&
      !/^(oklab|oklch|srgb|hsl|longer|shorter|increasing|decreasing)$/.test(
        ctx.modifier,
      )
    )
      return null;
    const interp = ctx.modifier
      ? /^(longer|shorter|increasing|decreasing)$/.test(ctx.modifier)
        ? `oklch ${ctx.modifier} hue`
        : ctx.modifier
      : "oklab";
    const image = (fallback?: string) =>
      d(
        "background-image",
        `${shape}-gradient(var(--tw-gradient-stops${fallback ? `,${fallback}` : ""}))`,
      );
    if (shape === "linear") {
      if (value === null) return null;
      let pos: string | null = null;
      if (value.startsWith("to-") && SIDES[value.slice(3)] && !ctx.negative)
        pos = `to ${SIDES[value.slice(3)]}`;
      else if (/^\d+(\.\d+)?$/.test(value))
        pos = ctx.negative ? `calc(${value}deg * -1)` : `${value}deg`;
      if (pos !== null)
        return out([
          d("--tw-gradient-position", pos),
          {
            at: "@supports (background-image: linear-gradient(in lab, red, red))",
            nodes: [d("--tw-gradient-position", `${pos} in ${interp}`)],
          },
          image(),
        ]);
      if (isArbitrary(value) && !ctx.negative) {
        const a = arbitraryValue(value);
        return out([d("--tw-gradient-position", a), image(a)]);
      }
      return null;
    }
    if (shape === "conic") {
      if (value === null) return null;
      if (/^\d+(\.\d+)?$/.test(value)) {
        const deg = ctx.negative ? `calc(${value}deg * -1)` : `${value}deg`;
        return out([
          d("--tw-gradient-position", `from ${deg} in ${interp}`),
          image(),
        ]);
      }
      if (isArbitrary(value) && !ctx.negative) {
        const a = arbitraryValue(value);
        return out([d("--tw-gradient-position", a), image(a)]);
      }
      return null;
    }
    // radial
    if (ctx.negative) return null;
    if (value === null)
      return out([d("--tw-gradient-position", `in ${interp}`), image()]);
    if (isArbitrary(value)) {
      const a = arbitraryValue(value);
      return out([d("--tw-gradient-position", a), image(a)]);
    }
    return null;
  };
}

function translateValue(v: string, ctx: Ctx): string | null {
  if (v === "px") return ctx.negative ? "-1px" : "1px";
  if (v === "full") return ctx.negative ? "-100%" : "100%";
  if (fraction(v))
    return ctx.negative ? `calc(${fraction(v)} * -1)` : fraction(v)!;
  if (isArbitrary(v))
    return ctx.negative ? `calc(${arbitraryValue(v)} * -1)` : arbitraryValue(v);
  if (customProp(v))
    return ctx.negative ? `calc(${customProp(v)} * -1)` : customProp(v)!;
  const n = bareSpacing(v);
  if (n === null) return null;
  return spacingCalc(n, ctx.negative);
}

function gradientStop(kind: "from" | "via" | "to"): Handler {
  const viaStops =
    "var(--tw-gradient-position), var(--tw-gradient-from) var(--tw-gradient-from-position), var(--tw-gradient-via) var(--tw-gradient-via-position), var(--tw-gradient-to) var(--tw-gradient-to-position)";
  return (value, ctx) => {
    if (value === null || ctx.negative) return null;
    if (kind === "via" && value === "none")
      return ctx.modifier
        ? null
        : out([d("--tw-gradient-via-stops", "initial")]);
    // position: from-10%, from-[3rem]
    if (/^\d+(\.\d+)?%$/.test(value) && !ctx.modifier)
      return out([d(`--tw-gradient-${kind}-position`, value)], GRADIENT_PROPS);
    if (isArbitrary(value)) {
      const a = arbitraryValue(value);
      if (
        !looksLikeColor(a) &&
        !a.startsWith("var(") &&
        (/^[\d.]+(%|px|rem|em|vw|vh)$/.test(a) || a.startsWith("calc("))
      ) {
        if (ctx.modifier) return null;
        return out([d(`--tw-gradient-${kind}-position`, a)], GRADIENT_PROPS);
      }
    }
    const c = resolveColor(value, ctx);
    if (c === null) return null;
    const cm = withOpacity(c, ctx.modifier);
    if (cm === null) return null;
    if (kind === "via")
      return out(
        [
          d("--tw-gradient-via", cm),
          d("--tw-gradient-via-stops", viaStops),
          d("--tw-gradient-stops", "var(--tw-gradient-via-stops)"),
        ],
        GRADIENT_PROPS,
      );
    return out(
      [
        d(`--tw-gradient-${kind}`, cm),
        d("--tw-gradient-stops", GRADIENT_STOPS_VALUE),
      ],
      GRADIENT_PROPS,
    );
  };
}

function scrollbarColor(twVar: string): Handler {
  return (value, ctx) => {
    if (value === null || ctx.negative) return null;
    const c = resolveColor(value, ctx);
    if (c === null) return null;
    const cm = withOpacity(c, ctx.modifier);
    if (cm === null) return null;
    return out(
      [
        d(twVar, cm),
        d(
          "scrollbar-color",
          "var(--tw-scrollbar-thumb) var(--tw-scrollbar-track)",
        ),
      ],
      SCROLLBAR_PROPS,
    );
  };
}

// ---------- masks ----------

const MASK_BASE_PROPS = [
  P("--tw-mask-linear", "linear-gradient(#fff, #fff)"),
  P("--tw-mask-radial", "linear-gradient(#fff, #fff)"),
  P("--tw-mask-conic", "linear-gradient(#fff, #fff)"),
];
const MASK_SIDE_PROPS = [
  P("--tw-mask-left", "linear-gradient(#fff, #fff)"),
  P("--tw-mask-right", "linear-gradient(#fff, #fff)"),
  P("--tw-mask-bottom", "linear-gradient(#fff, #fff)"),
  P("--tw-mask-top", "linear-gradient(#fff, #fff)"),
];
const maskEdgeProps = (side: string) => [
  P(`--tw-mask-${side}-from-position`, "0%"),
  P(`--tw-mask-${side}-to-position`, "100%"),
  P(`--tw-mask-${side}-from-color`, "black"),
  P(`--tw-mask-${side}-to-color`, "transparent"),
];

const MASK_HEAD = [
  d(
    "mask-image",
    "var(--tw-mask-linear), var(--tw-mask-radial), var(--tw-mask-conic)",
  ),
  d("mask-composite", "intersect"),
];
const MASK_EDGES_DECL = d(
  "--tw-mask-linear",
  "var(--tw-mask-left), var(--tw-mask-right), var(--tw-mask-bottom), var(--tw-mask-top)",
);
const maskSideGradient = (side: string) =>
  d(
    `--tw-mask-${side}`,
    `linear-gradient(to ${side}, var(--tw-mask-${side}-from-color) var(--tw-mask-${side}-from-position), var(--tw-mask-${side}-to-color) var(--tw-mask-${side}-to-position))`,
  );

function maskAngle(value: string, negative: boolean): string {
  if (value === "0") return "0deg";
  if (value === "1") return negative ? "-1deg" : "1deg";
  return negative ? `calc(1deg * -${value})` : `calc(1deg * ${value})`;
}

/** stop value for mask from/to: spacing number, %, arbitrary, or color */
function maskStop(
  value: string,
  ctx: Ctx,
): { kind: "position" | "color"; css: string } | null {
  if (/^\d+(\.\d+)?%$/.test(value)) return { kind: "position", css: value };
  const n = bareSpacing(value);
  if (n !== null) return { kind: "position", css: spacingCalc(n, false) };
  if (isArbitrary(value)) {
    const a = arbitraryValue(value);
    if (looksLikeColor(a)) return { kind: "color", css: a };
    return { kind: "position", css: a };
  }
  const c = resolveColor(value, ctx);
  if (c !== null) {
    const cm = withOpacity(c, ctx.modifier);
    if (cm === null) return null;
    return { kind: "color", css: cm };
  }
  return null;
}

const MASK_SIDES: Record<string, string[]> = {
  t: ["top"],
  r: ["right"],
  b: ["bottom"],
  l: ["left"],
  x: ["right", "left"],
  y: ["top", "bottom"],
};

function maskSideUtil(sides: string[], stop: "from" | "to"): Handler {
  return (value, ctx) => {
    if (value === null || ctx.negative) return null;
    const s = maskStop(value, ctx);
    if (s === null) return null;
    if (s.kind === "position" && ctx.modifier) return null;
    const nodes = [...MASK_HEAD, MASK_EDGES_DECL];
    const props = [...MASK_BASE_PROPS, ...MASK_SIDE_PROPS];
    for (const side of sides) {
      nodes.push(
        maskSideGradient(side),
        d(`--tw-mask-${side}-${stop}-${s.kind}`, s.css),
      );
      props.push(...maskEdgeProps(side));
    }
    return out(nodes, props);
  };
}

const MASK_LINEAR_STOPS =
  "var(--tw-mask-linear-position), var(--tw-mask-linear-from-color) var(--tw-mask-linear-from-position), var(--tw-mask-linear-to-color) var(--tw-mask-linear-to-position)";
const MASK_RADIAL_STOPS =
  "var(--tw-mask-radial-shape) var(--tw-mask-radial-size) at var(--tw-mask-radial-position), var(--tw-mask-radial-from-color) var(--tw-mask-radial-from-position), var(--tw-mask-radial-to-color) var(--tw-mask-radial-to-position)";
const MASK_CONIC_STOPS =
  "from var(--tw-mask-conic-position), var(--tw-mask-conic-from-color) var(--tw-mask-conic-from-position), var(--tw-mask-conic-to-color) var(--tw-mask-conic-to-position)";

function maskShapeUtil(
  shape: "linear" | "radial" | "conic",
  stop: "from" | "to",
): Handler {
  const stopsVar = `--tw-mask-${shape}-stops`;
  const stopsValue =
    shape === "linear"
      ? MASK_LINEAR_STOPS
      : shape === "radial"
        ? MASK_RADIAL_STOPS
        : MASK_CONIC_STOPS;
  const gradientFn =
    shape === "linear"
      ? "linear-gradient"
      : shape === "radial"
        ? "radial-gradient"
        : "conic-gradient";
  const shapeProps =
    shape === "linear"
      ? [P("--tw-mask-linear-position", "0deg"), ...maskEdgeProps("linear")]
      : shape === "radial"
        ? [
            ...maskEdgeProps("radial"),
            P("--tw-mask-radial-shape", "ellipse"),
            P("--tw-mask-radial-size", "farthest-corner"),
            P("--tw-mask-radial-position", "center"),
          ]
        : [P("--tw-mask-conic-position", "0deg"), ...maskEdgeProps("conic")];
  return (value, ctx) => {
    if (value === null || ctx.negative) return null;
    const s = maskStop(value, ctx);
    if (s === null) return null;
    if (s.kind === "position" && ctx.modifier) return null;
    return out(
      [
        ...MASK_HEAD,
        d(stopsVar, stopsValue),
        d(`--tw-mask-${shape}`, `${gradientFn}(var(${stopsVar}))`),
        d(`--tw-mask-${shape}-${stop}-${s.kind}`, s.css),
      ],
      [...MASK_BASE_PROPS, ...shapeProps],
    );
  };
}

for (const [abbr, sides] of Object.entries(MASK_SIDES)) {
  COMPOSED[`mask-${abbr}-from`] = maskSideUtil(sides, "from");
  COMPOSED[`mask-${abbr}-to`] = maskSideUtil(sides, "to");
}
for (const shape of ["linear", "radial", "conic"] as const) {
  COMPOSED[`mask-${shape}-from`] = maskShapeUtil(shape, "from");
  COMPOSED[`mask-${shape}-to`] = maskShapeUtil(shape, "to");
}
COMPOSED["mask-linear"] = (value, ctx) => {
  if (value === null || ctx.modifier) return null;
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  return out(
    [
      ...MASK_HEAD,
      d(
        "--tw-mask-linear",
        "linear-gradient(var(--tw-mask-linear-stops, var(--tw-mask-linear-position)))",
      ),
      d("--tw-mask-linear-position", maskAngle(value, ctx.negative)),
    ],
    [
      ...MASK_BASE_PROPS,
      P("--tw-mask-linear-position", "0deg"),
      ...maskEdgeProps("linear"),
    ],
  );
};
for (const pos of [
  "top",
  "top-left",
  "top-right",
  "bottom",
  "bottom-left",
  "bottom-right",
  "left",
  "right",
  "center",
]) {
  S[`mask-radial-at-${pos}`] = [
    ["--tw-mask-radial-position", pos.replace(/-/g, " ")],
  ];
}
COMPOSED["mask-conic"] = (value, ctx) => {
  if (value === null || ctx.modifier) return null;
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  return out(
    [
      ...MASK_HEAD,
      d(
        "--tw-mask-conic",
        "conic-gradient(var(--tw-mask-conic-stops, var(--tw-mask-conic-position)))",
      ),
      d("--tw-mask-conic-position", maskAngle(value, ctx.negative)),
    ],
    [
      ...MASK_BASE_PROPS,
      P("--tw-mask-conic-position", "0deg"),
      ...maskEdgeProps("conic"),
    ],
  );
};
COMPOSED["mask-none"] = (value, ctx) =>
  value === null && !ctx.negative && !ctx.modifier
    ? out([d("mask-image", "none")])
    : null;

// rotate-x/y/z and skew/skew-x/skew-y and scale-x/y/z axis handlers
for (const axis of ["x", "y", "z"] as const) {
  COMPOSED[`rotate-${axis}`] = (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    let arg: string | null = null;
    if (/^\d+(\.\d+)?$/.test(value))
      arg = ctx.negative ? `calc(${value}deg * -1)` : `${value}deg`;
    else if (isArbitrary(value) && !ctx.negative) arg = arbitraryValue(value);
    if (arg === null) return null;
    const fn = `rotate${axis.toUpperCase()}`;
    return out(
      [
        d(`--tw-rotate-${axis}`, `${fn}(${arg})`),
        d("transform", TRANSFORM_VALUE),
      ],
      TRANSFORM_PROPS,
    );
  };
  COMPOSED[`scale-${axis}`] = (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    let v: string | null = null;
    if (/^\d+(\.\d+)?$/.test(value))
      v = ctx.negative ? `calc(${value}% * -1)` : `${value}%`;
    else if (isArbitrary(value) && !ctx.negative) v = arbitraryValue(value);
    if (v === null) return null;
    const scaleDecl =
      axis === "z"
        ? "var(--tw-scale-x) var(--tw-scale-y) var(--tw-scale-z)"
        : "var(--tw-scale-x) var(--tw-scale-y)";
    return out(
      [d(`--tw-scale-${axis}`, v), d("scale", scaleDecl)],
      SCALE_PROPS,
    );
  };
}
for (const axis of ["x", "y"] as const) {
  COMPOSED[`skew-${axis}`] = (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    let arg: string | null = null;
    if (/^\d+(\.\d+)?$/.test(value))
      arg = ctx.negative ? `calc(${value}deg * -1)` : `${value}deg`;
    else if (isArbitrary(value) && !ctx.negative) arg = arbitraryValue(value);
    if (arg === null) return null;
    const fn = `skew${axis.toUpperCase()}`;
    return out(
      [
        d(`--tw-skew-${axis}`, `${fn}(${arg})`),
        d("transform", TRANSFORM_VALUE),
      ],
      TRANSFORM_PROPS,
    );
  };
}
COMPOSED["skew"] = (value, ctx) => {
  if (value === null || ctx.modifier) return null;
  let arg: string | null = null;
  if (/^\d+(\.\d+)?$/.test(value))
    arg = ctx.negative ? `calc(${value}deg * -1)` : `${value}deg`;
  else if (isArbitrary(value) && !ctx.negative) arg = arbitraryValue(value);
  if (arg === null) return null;
  return out(
    [
      d("--tw-skew-x", `skewX(${arg})`),
      d("--tw-skew-y", `skewY(${arg})`),
      d("transform", TRANSFORM_VALUE),
    ],
    TRANSFORM_PROPS,
  );
};

// logical + scroll spacing families
Object.assign(COMPOSED, {
  mbs: spacingUtil(["margin-block-start"], { auto: true, negative: true }),
  mbe: spacingUtil(["margin-block-end"], { auto: true, negative: true }),
  pbs: spacingUtil(["padding-block-start"]),
  pbe: spacingUtil(["padding-block-end"]),
  "inset-s": spacingUtil(["inset-inline-start"], {
    auto: true,
    negative: true,
    fraction: true,
    full: true,
  }),
  "inset-e": spacingUtil(["inset-inline-end"], {
    auto: true,
    negative: true,
    fraction: true,
    full: true,
  }),
  "inset-bs": spacingUtil(["inset-block-start"], {
    auto: true,
    negative: true,
    fraction: true,
    full: true,
  }),
  "inset-be": spacingUtil(["inset-block-end"], {
    auto: true,
    negative: true,
    fraction: true,
    full: true,
  }),
  start: spacingUtil(["inset-inline-start"], {
    auto: true,
    negative: true,
    fraction: true,
    full: true,
  }),
  end: spacingUtil(["inset-inline-end"], {
    auto: true,
    negative: true,
    fraction: true,
    full: true,
  }),
  "scroll-m": spacingUtil(["scroll-margin"], { negative: true }),
  "scroll-mx": spacingUtil(["scroll-margin-inline"], { negative: true }),
  "scroll-my": spacingUtil(["scroll-margin-block"], { negative: true }),
  "scroll-ms": spacingUtil(["scroll-margin-inline-start"], { negative: true }),
  "scroll-me": spacingUtil(["scroll-margin-inline-end"], { negative: true }),
  "scroll-mt": spacingUtil(["scroll-margin-top"], { negative: true }),
  "scroll-mr": spacingUtil(["scroll-margin-right"], { negative: true }),
  "scroll-mb": spacingUtil(["scroll-margin-bottom"], { negative: true }),
  "scroll-ml": spacingUtil(["scroll-margin-left"], { negative: true }),
  "scroll-mbs": spacingUtil(["scroll-margin-block-start"], {
    negative: true,
  }),
  "scroll-mbe": spacingUtil(["scroll-margin-block-end"], { negative: true }),
  "scroll-p": spacingUtil(["scroll-padding"]),
  "scroll-px": spacingUtil(["scroll-padding-inline"]),
  "scroll-py": spacingUtil(["scroll-padding-block"]),
  "scroll-ps": spacingUtil(["scroll-padding-inline-start"]),
  "scroll-pe": spacingUtil(["scroll-padding-inline-end"]),
  "scroll-pt": spacingUtil(["scroll-padding-top"]),
  "scroll-pr": spacingUtil(["scroll-padding-right"]),
  "scroll-pb": spacingUtil(["scroll-padding-bottom"]),
  "scroll-pl": spacingUtil(["scroll-padding-left"]),
  "scroll-pbs": spacingUtil(["scroll-padding-block-start"]),
  "scroll-pbe": spacingUtil(["scroll-padding-block-end"]),
  "border-bs": borderUtil("block-start"),
  "border-be": borderUtil("block-end"),
});

Object.assign(F, COMPOSED);

// scrollbar + long-tail statics
Object.assign(S, {
  "scrollbar-thin": [["scrollbar-width", "thin"]],
  "scrollbar-auto": [["scrollbar-width", "auto"]],
  "scrollbar-none": [["scrollbar-width", "none"]],
  "scrollbar-gutter-auto": [["scrollbar-gutter", "auto"]],
  "scrollbar-gutter-stable": [["scrollbar-gutter", "stable"]],
  "scrollbar-gutter-both-edges": [["scrollbar-gutter", "stable both-edges"]],
  // outline styles (pair with --tw-outline-style like border styles)
  "outline-solid": [
    ["--tw-outline-style", "solid"],
    ["outline-style", "solid"],
  ],
  "outline-dashed": [
    ["--tw-outline-style", "dashed"],
    ["outline-style", "dashed"],
  ],
  "outline-dotted": [
    ["--tw-outline-style", "dotted"],
    ["outline-style", "dotted"],
  ],
  "outline-double": [
    ["--tw-outline-style", "double"],
    ["outline-style", "double"],
  ],
  // wrapping
  "wrap-normal": [["overflow-wrap", "normal"]],
  "wrap-break-word": [["overflow-wrap", "break-word"]],
  "wrap-anywhere": [["overflow-wrap", "anywhere"]],
  // float / clear
  "float-left": [["float", "left"]],
  "float-right": [["float", "right"]],
  "float-start": [["float", "inline-start"]],
  "float-end": [["float", "inline-end"]],
  "float-none": [["float", "none"]],
  "clear-left": [["clear", "left"]],
  "clear-right": [["clear", "right"]],
  "clear-both": [["clear", "both"]],
  "clear-start": [["clear", "inline-start"]],
  "clear-end": [["clear", "inline-end"]],
  "clear-none": [["clear", "none"]],
  // object
  "object-contain": [["object-fit", "contain"]],
  "object-cover": [["object-fit", "cover"]],
  "object-fill": [["object-fit", "fill"]],
  "object-none": [["object-fit", "none"]],
  "object-scale-down": [["object-fit", "scale-down"]],
  "object-center": [["object-position", "center"]],
  "object-top": [["object-position", "top"]],
  "object-bottom": [["object-position", "bottom"]],
  "object-left": [["object-position", "left"]],
  "object-right": [["object-position", "right"]],
  "object-top-left": [["object-position", "left top"]],
  "object-top-right": [["object-position", "right top"]],
  "object-bottom-left": [["object-position", "left bottom"]],
  "object-bottom-right": [["object-position", "right bottom"]],
  // will-change / appearance / field-sizing
  "will-change-auto": [["will-change", "auto"]],
  "will-change-scroll": [["will-change", "scroll-position"]],
  "will-change-contents": [["will-change", "contents"]],
  "will-change-transform": [["will-change", "transform"]],
  "appearance-none": [["appearance", "none"]],
  "appearance-auto": [["appearance", "auto"]],
  "field-sizing-content": [["field-sizing", "content"]],
  "field-sizing-fixed": [["field-sizing", "fixed"]],
  // background statics
  "bg-clip-border": [["background-clip", "border-box"]],
  "bg-clip-padding": [["background-clip", "padding-box"]],
  "bg-clip-content": [["background-clip", "content-box"]],
  "bg-clip-text": [["background-clip", "text"]],
  "bg-origin-border": [["background-origin", "border-box"]],
  "bg-origin-padding": [["background-origin", "padding-box"]],
  "bg-origin-content": [["background-origin", "content-box"]],
  "bg-repeat": [["background-repeat", "repeat"]],
  "bg-no-repeat": [["background-repeat", "no-repeat"]],
  "bg-repeat-x": [["background-repeat", "repeat-x"]],
  "bg-repeat-y": [["background-repeat", "repeat-y"]],
  "bg-repeat-round": [["background-repeat", "round"]],
  "bg-repeat-space": [["background-repeat", "space"]],
  "bg-fixed": [["background-attachment", "fixed"]],
  "bg-local": [["background-attachment", "local"]],
  "bg-scroll": [["background-attachment", "scroll"]],
  "bg-auto": [["background-size", "auto"]],
  "bg-cover": [["background-size", "cover"]],
  "bg-contain": [["background-size", "contain"]],
  "bg-center": [["background-position", "center"]],
  "bg-top": [["background-position", "top"]],
  "bg-bottom": [["background-position", "bottom"]],
  "bg-left": [["background-position", "left"]],
  "bg-right": [["background-position", "right"]],
  "bg-top-left": [["background-position", "left top"]],
  "bg-top-right": [["background-position", "right top"]],
  "bg-bottom-left": [["background-position", "left bottom"]],
  "bg-bottom-right": [["background-position", "right bottom"]],
  "bg-none": [["background-image", "none"]],
  // mask statics
  "mask-clip-border": [["mask-clip", "border-box"]],
  "mask-clip-padding": [["mask-clip", "padding-box"]],
  "mask-clip-content": [["mask-clip", "content-box"]],
  "mask-clip-fill": [["mask-clip", "fill-box"]],
  "mask-clip-stroke": [["mask-clip", "stroke-box"]],
  "mask-clip-view": [["mask-clip", "view-box"]],
  "mask-no-clip": [["mask-clip", "no-clip"]],
  "mask-origin-border": [["mask-origin", "border-box"]],
  "mask-origin-padding": [["mask-origin", "padding-box"]],
  "mask-origin-content": [["mask-origin", "content-box"]],
  "mask-origin-fill": [["mask-origin", "fill-box"]],
  "mask-origin-stroke": [["mask-origin", "stroke-box"]],
  "mask-origin-view": [["mask-origin", "view-box"]],
  "mask-repeat": [["mask-repeat", "repeat"]],
  "mask-no-repeat": [["mask-repeat", "no-repeat"]],
  "mask-repeat-x": [["mask-repeat", "repeat-x"]],
  "mask-repeat-y": [["mask-repeat", "repeat-y"]],
  "mask-repeat-round": [["mask-repeat", "round"]],
  "mask-repeat-space": [["mask-repeat", "space"]],
  "mask-auto": [["mask-size", "auto"]],
  "mask-cover": [["mask-size", "cover"]],
  "mask-contain": [["mask-size", "contain"]],
  "mask-center": [["mask-position", "center"]],
  "mask-top": [["mask-position", "top"]],
  "mask-bottom": [["mask-position", "bottom"]],
  "mask-left": [["mask-position", "left"]],
  "mask-right": [["mask-position", "right"]],
  "mask-alpha": [["mask-mode", "alpha"]],
  "mask-luminance": [["mask-mode", "luminance"]],
  "mask-match": [["mask-mode", "match-source"]],
  "mask-add": [["mask-composite", "add"]],
  "mask-subtract": [["mask-composite", "subtract"]],
  "mask-intersect": [["mask-composite", "intersect"]],
  "mask-exclude": [["mask-composite", "exclude"]],
  "mask-type-alpha": [["mask-type", "alpha"]],
  "mask-type-luminance": [["mask-type", "luminance"]],
  // page/column breaks
  "break-before-auto": [["break-before", "auto"]],
  "break-before-avoid": [["break-before", "avoid"]],
  "break-before-all": [["break-before", "all"]],
  "break-before-avoid-page": [["break-before", "avoid-page"]],
  "break-before-page": [["break-before", "page"]],
  "break-before-left": [["break-before", "left"]],
  "break-before-right": [["break-before", "right"]],
  "break-before-column": [["break-before", "column"]],
  "break-after-auto": [["break-after", "auto"]],
  "break-after-avoid": [["break-after", "avoid"]],
  "break-after-all": [["break-after", "all"]],
  "break-after-avoid-page": [["break-after", "avoid-page"]],
  "break-after-page": [["break-after", "page"]],
  "break-after-left": [["break-after", "left"]],
  "break-after-right": [["break-after", "right"]],
  "break-after-column": [["break-after", "column"]],
  "break-inside-auto": [["break-inside", "auto"]],
  "break-inside-avoid": [["break-inside", "avoid"]],
  "break-inside-avoid-page": [["break-inside", "avoid-page"]],
  "break-inside-avoid-column": [["break-inside", "avoid-column"]],
  // box decoration
  "box-decoration-clone": [
    ["-webkit-box-decoration-break", "clone"],
    ["box-decoration-break", "clone"],
  ],
  "box-decoration-slice": [
    ["-webkit-box-decoration-break", "slice"],
    ["box-decoration-break", "slice"],
  ],
  // blend modes
  ...Object.fromEntries(
    [
      "normal",
      "multiply",
      "screen",
      "overlay",
      "darken",
      "lighten",
      "color-dodge",
      "color-burn",
      "hard-light",
      "soft-light",
      "difference",
      "exclusion",
      "hue",
      "saturation",
      "color",
      "luminosity",
      "plus-darker",
      "plus-lighter",
    ].flatMap((m) => [
      [`mix-blend-${m}`, [["mix-blend-mode", m]]],
      [`bg-blend-${m}`, [["background-blend-mode", m]]],
    ]),
  ),
  // scroll behavior / snap align-stop
  "scroll-smooth": [["scroll-behavior", "smooth"]],
  "scroll-auto": [["scroll-behavior", "auto"]],
  "snap-start": [["scroll-snap-align", "start"]],
  "snap-end": [["scroll-snap-align", "end"]],
  "snap-center": [["scroll-snap-align", "center"]],
  "snap-align-none": [["scroll-snap-align", "none"]],
  "snap-normal": [["scroll-snap-stop", "normal"]],
  "snap-always": [["scroll-snap-stop", "always"]],
  // backface / perspective origins
  "backface-visible": [["backface-visibility", "visible"]],
  "backface-hidden": [["backface-visibility", "hidden"]],
  "perspective-origin-center": [["perspective-origin", "center"]],
  "perspective-origin-top": [["perspective-origin", "top"]],
  "perspective-origin-top-right": [["perspective-origin", "100% 0"]],
  "perspective-origin-right": [["perspective-origin", "right"]],
  "perspective-origin-bottom-right": [["perspective-origin", "100% 100%"]],
  "perspective-origin-bottom": [["perspective-origin", "bottom"]],
  "perspective-origin-bottom-left": [["perspective-origin", "0 100%"]],
  "perspective-origin-left": [["perspective-origin", "left"]],
  "perspective-origin-top-left": [["perspective-origin", "0 0"]],
  // alignment long tail
  "justify-baseline": [["justify-content", "baseline"]],
  "justify-normal": [["justify-content", "normal"]],
  "content-normal": [["align-content", "normal"]],
  "content-baseline": [["align-content", "baseline"]],
  "content-stretch": [["align-content", "stretch"]],
  "justify-self-auto": [["justify-self", "auto"]],
  "justify-self-start": [["justify-self", "start"]],
  "justify-self-end": [["justify-self", "end"]],
  "justify-self-center": [["justify-self", "center"]],
  "justify-self-stretch": [["justify-self", "stretch"]],
  "place-self-auto": [["place-self", "auto"]],
  "place-self-start": [["place-self", "start"]],
  "place-self-end": [["place-self", "end"]],
  "place-self-center": [["place-self", "center"]],
  "place-self-stretch": [["place-self", "stretch"]],
  "place-items-start": [["place-items", "start"]],
  "place-items-end": [["place-items", "end"]],
  "place-items-baseline": [["place-items", "baseline"]],
  "place-items-stretch": [["place-items", "stretch"]],
  "place-content-start": [["place-content", "start"]],
  "place-content-end": [["place-content", "end"]],
  "place-content-between": [["place-content", "space-between"]],
  "place-content-around": [["place-content", "space-around"]],
  "place-content-evenly": [["place-content", "space-evenly"]],
  "place-content-baseline": [["place-content", "baseline"]],
  "place-content-stretch": [["place-content", "stretch"]],
  // grid auto flow / auto tracks / row-col auto
  "grid-flow-row": [["grid-auto-flow", "row"]],
  "grid-flow-col": [["grid-auto-flow", "column"]],
  "grid-flow-dense": [["grid-auto-flow", "dense"]],
  "grid-flow-row-dense": [["grid-auto-flow", "row dense"]],
  "grid-flow-col-dense": [["grid-auto-flow", "column dense"]],
  "auto-cols-auto": [["grid-auto-columns", "auto"]],
  "auto-cols-min": [["grid-auto-columns", "min-content"]],
  "auto-cols-max": [["grid-auto-columns", "max-content"]],
  "auto-cols-fr": [["grid-auto-columns", "minmax(0, 1fr)"]],
  "auto-rows-auto": [["grid-auto-rows", "auto"]],
  "auto-rows-min": [["grid-auto-rows", "min-content"]],
  "auto-rows-max": [["grid-auto-rows", "max-content"]],
  "auto-rows-fr": [["grid-auto-rows", "minmax(0, 1fr)"]],
  "row-auto": [["grid-row", "auto"]],
  "col-auto": [["grid-column", "auto"]],
  // transform origin / box / style
  "origin-center": [["transform-origin", "center"]],
  "origin-top": [["transform-origin", "top"]],
  "origin-top-right": [["transform-origin", "100% 0"]],
  "origin-right": [["transform-origin", "right"]],
  "origin-bottom-right": [["transform-origin", "100% 100%"]],
  "origin-bottom": [["transform-origin", "bottom"]],
  "origin-bottom-left": [["transform-origin", "0 100%"]],
  "origin-left": [["transform-origin", "left"]],
  "origin-top-left": [["transform-origin", "0 0"]],
  "transform-3d": [["transform-style", "preserve-3d"]],
  "transform-flat": [["transform-style", "flat"]],
  "transform-content": [["transform-box", "content-box"]],
  "transform-border": [["transform-box", "border-box"]],
  "transform-fill": [["transform-box", "fill-box"]],
  "transform-stroke": [["transform-box", "stroke-box"]],
  "transform-view": [["transform-box", "view-box"]],
  // safe / last-baseline alignment
  "self-center-safe": [["align-self", "safe center"]],
  "self-end-safe": [["align-self", "safe flex-end"]],
  "self-baseline-last": [["align-self", "last baseline"]],
  "items-center-safe": [["align-items", "safe center"]],
  "items-end-safe": [["align-items", "safe flex-end"]],
  "items-baseline-last": [["align-items", "last baseline"]],
  "justify-center-safe": [["justify-content", "safe center"]],
  "justify-end-safe": [["justify-content", "safe flex-end"]],
  "content-center-safe": [["align-content", "safe center"]],
  "content-end-safe": [["align-content", "safe flex-end"]],
  "justify-items-center-safe": [["justify-items", "safe center"]],
  "justify-items-end-safe": [["justify-items", "safe end"]],
  "justify-self-center-safe": [["justify-self", "safe center"]],
  "justify-self-end-safe": [["justify-self", "safe flex-end"]],
  "place-content-center-safe": [["place-content", "safe center"]],
  "place-content-end-safe": [["place-content", "safe end"]],
  "place-items-center-safe": [["place-items", "safe center"]],
  "place-items-end-safe": [["place-items", "safe end"]],
  "place-self-center-safe": [["place-self", "safe center"]],
  "place-self-end-safe": [["place-self", "safe end"]],
  // tables (display)
  "table-caption": [["display", "table-caption"]],
  "table-column": [["display", "table-column"]],
  "table-column-group": [["display", "table-column-group"]],
  "table-footer-group": [["display", "table-footer-group"]],
  "table-header-group": [["display", "table-header-group"]],
  "table-row-group": [["display", "table-row-group"]],
  "inline-table": [["display", "inline-table"]],
  "forced-color-adjust-auto": [["forced-color-adjust", "auto"]],
  "forced-color-adjust-none": [["forced-color-adjust", "none"]],
  "@container": [["container-type", "inline-size"]],
  "@container-normal": [["container-type", "normal"]],
  // hyphens / color-scheme
  "hyphens-none": [
    ["-webkit-hyphens", "none"],
    ["hyphens", "none"],
  ],
  "hyphens-manual": [
    ["-webkit-hyphens", "manual"],
    ["hyphens", "manual"],
  ],
  "hyphens-auto": [
    ["-webkit-hyphens", "auto"],
    ["hyphens", "auto"],
  ],
  "scheme-normal": [["color-scheme", "normal"]],
  "scheme-light": [["color-scheme", "light"]],
  "scheme-dark": [["color-scheme", "dark"]],
  "scheme-light-dark": [["color-scheme", "light dark"]],
  "scheme-only-light": [["color-scheme", "only light"]],
  "scheme-only-dark": [["color-scheme", "only dark"]],
  // font-stretch named
  ...Object.fromEntries(
    [
      "ultra-condensed",
      "extra-condensed",
      "condensed",
      "semi-condensed",
      "normal",
      "semi-expanded",
      "expanded",
      "extra-expanded",
      "ultra-expanded",
    ].map((k) => [`font-stretch-${k}`, [["font-stretch", k]]]),
  ),
  // overscroll
  "overscroll-auto": [["overscroll-behavior", "auto"]],
  "overscroll-contain": [["overscroll-behavior", "contain"]],
  "overscroll-none": [["overscroll-behavior", "none"]],
  "overscroll-x-auto": [["overscroll-behavior-x", "auto"]],
  "overscroll-x-contain": [["overscroll-behavior-x", "contain"]],
  "overscroll-x-none": [["overscroll-behavior-x", "none"]],
  "overscroll-y-auto": [["overscroll-behavior-y", "auto"]],
  "overscroll-y-contain": [["overscroll-behavior-y", "contain"]],
  "overscroll-y-none": [["overscroll-behavior-y", "none"]],
  // radial mask shape / size
  "mask-circle": [["--tw-mask-radial-shape", "circle"]],
  "mask-ellipse": [["--tw-mask-radial-shape", "ellipse"]],
  "mask-radial-closest-side": [["--tw-mask-radial-size", "closest-side"]],
  "mask-radial-closest-corner": [["--tw-mask-radial-size", "closest-corner"]],
  "mask-radial-farthest-side": [["--tw-mask-radial-size", "farthest-side"]],
  "mask-radial-farthest-corner": [["--tw-mask-radial-size", "farthest-corner"]],
  // mask position corners
  "mask-top-left": [["mask-position", "left top"]],
  "mask-top-right": [["mask-position", "right top"]],
  "mask-bottom-left": [["mask-position", "left bottom"]],
  "mask-bottom-right": [["mask-position", "right bottom"]],
});

// outline statics need nested rules — expressed as handlers on exact match
const STATIC_SPECIAL: Record<string, (ctx: Ctx) => UtilityOutput> = {
  "outline-none": () =>
    out([d("--tw-outline-style", "none"), d("outline-style", "none")]),
  "outline-hidden": () => ({
    nodes: [
      d("--tw-outline-style", "none"),
      d("outline-style", "none"),
      {
        at: "@media (forced-colors: active)",
        nodes: [
          d("outline", "2px solid transparent"),
          d("outline-offset", "2px"),
        ],
      },
    ],
  }),
  "tabular-nums": () => numericUtil("--tw-numeric-spacing", "tabular-nums"),
  ordinal: () => numericUtil("--tw-ordinal", "ordinal"),
  "slashed-zero": () => numericUtil("--tw-slashed-zero", "slashed-zero"),
  "lining-nums": () => numericUtil("--tw-numeric-figure", "lining-nums"),
  "oldstyle-nums": () => numericUtil("--tw-numeric-figure", "oldstyle-nums"),
  "proportional-nums": () =>
    numericUtil("--tw-numeric-spacing", "proportional-nums"),
  "diagonal-fractions": () =>
    numericUtil("--tw-numeric-fraction", "diagonal-fractions"),
  "stacked-fractions": () =>
    numericUtil("--tw-numeric-fraction", "stacked-fractions"),
  "normal-nums": () => out([d("font-variant-numeric", "normal")]),
  "content-none": () => out([d("--tw-content", "none"), d("content", "none")]),
  container: (ctx) => {
    const bps: string[] = [];
    for (const [name, value] of ctx.theme.vars) {
      if (name.startsWith("--breakpoint-")) bps.push(value);
    }
    bps.sort((a, b) => parseFloat(a) - parseFloat(b));
    return {
      nodes: [
        d("width", "100%"),
        ...bps.map((bp) => ({
          at: `@media (width >= ${bp})`,
          nodes: [d("max-width", bp)],
        })),
      ],
    };
  },
  "translate-3d": () =>
    out(
      [
        d(
          "translate",
          "var(--tw-translate-x) var(--tw-translate-y) var(--tw-translate-z)",
        ),
      ],
      TRANSLATE_PROPS,
    ),
  ...reverseStatics(),
  ...divideStyleStatics(),
  ...touchStatics(),
  ...snapStatics(),
  ...containStatics(),
};

function touchStatics() {
  const TOUCH_PROPS = [P("--tw-pan-x"), P("--tw-pan-y"), P("--tw-pinch-zoom")];
  const decl = d(
    "touch-action",
    "var(--tw-pan-x,) var(--tw-pan-y,) var(--tw-pinch-zoom,)",
  );
  const entries: Record<string, () => UtilityOutput> = {
    "touch-auto": () => out([d("touch-action", "auto")]),
    "touch-none": () => out([d("touch-action", "none")]),
    "touch-manipulation": () => out([d("touch-action", "manipulation")]),
  };
  for (const pan of ["x", "y", "left", "right", "up", "down"]) {
    const axis = pan === "x" || pan === "left" || pan === "right" ? "x" : "y";
    entries[`touch-pan-${pan}`] = () =>
      out([d(`--tw-pan-${axis}`, `pan-${pan}`), decl], TOUCH_PROPS);
  }
  entries["touch-pinch-zoom"] = () =>
    out([d("--tw-pinch-zoom", "pinch-zoom"), decl], TOUCH_PROPS);
  return entries;
}

function snapStatics() {
  const SNAP_PROPS = [P("--tw-scroll-snap-strictness", "proximity")];
  const entries: Record<string, () => UtilityOutput> = {
    "snap-none": () => out([d("scroll-snap-type", "none")]),
    "snap-proximity": () =>
      out([d("--tw-scroll-snap-strictness", "proximity")], SNAP_PROPS),
    "snap-mandatory": () =>
      out([d("--tw-scroll-snap-strictness", "mandatory")], SNAP_PROPS),
  };
  for (const axis of ["x", "y", "both"]) {
    entries[`snap-${axis}`] = () =>
      out(
        [d("scroll-snap-type", `${axis} var(--tw-scroll-snap-strictness)`)],
        SNAP_PROPS,
      );
  }
  return entries;
}

function reverseStatics() {
  const wrap = (sel: string) => `:where(${sel} > :not(:last-child))`;
  const entries: Record<string, () => UtilityOutput> = {};
  for (const [kind, axis] of [
    ["space", "x"],
    ["space", "y"],
    ["divide", "x"],
    ["divide", "y"],
  ] as const) {
    const rev = `--tw-${kind}-${axis}-reverse`;
    entries[`${kind}-${axis}-reverse`] = () => ({
      nodes: [d(rev, "1")],
      properties: [P(rev, "0")],
      selectorWrap: wrap,
    });
  }
  return entries;
}

function divideStyleStatics() {
  const wrap = (sel: string) => `:where(${sel} > :not(:last-child))`;
  const entries: Record<string, () => UtilityOutput> = {};
  for (const style of ["solid", "dashed", "dotted", "double", "none"]) {
    entries[`divide-${style}`] = () => ({
      nodes: [d("--tw-border-style", style), d("border-style", style)],
      selectorWrap: wrap,
    });
  }
  return entries;
}

function containStatics() {
  const CONTAIN_PROPS = [
    P("--tw-contain-size"),
    P("--tw-contain-layout"),
    P("--tw-contain-paint"),
    P("--tw-contain-style"),
  ];
  const decl = d(
    "contain",
    "var(--tw-contain-size,) var(--tw-contain-layout,) var(--tw-contain-paint,) var(--tw-contain-style,)",
  );
  const entries: Record<string, () => UtilityOutput> = {
    "contain-none": () => out([d("contain", "none")]),
    "contain-content": () => out([d("contain", "content")]),
    "contain-strict": () => out([d("contain", "strict")]),
  };
  for (const kind of ["size", "layout", "paint", "style"]) {
    entries[`contain-${kind}`] = () =>
      out([d(`--tw-contain-${kind}`, kind), decl], CONTAIN_PROPS);
  }
  return entries;
}

function numericUtil(prop: string, value: string): UtilityOutput {
  return out(
    [
      d(prop, value),
      d(
        "font-variant-numeric",
        "var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,)",
      ),
    ],
    NUMERIC_PROPS,
  );
}

// ---------- dispatch ----------

/** Try `base` against static then functional tables. */
export function lookupUtility(base: string, ctx: Ctx): UtilityOutput | null {
  // arbitrary property: [color:red] / [--x:1rem]
  if (base.startsWith("[") && base.endsWith("]")) {
    if (ctx.negative || ctx.modifier) return null;
    const body = base.slice(1, -1);
    const colon = body.indexOf(":");
    if (colon <= 0) return null;
    const prop = body.slice(0, colon);
    if (!/^(--)?[\w-]+$/.test(prop)) return null;
    const value = mathSpace(dearbitrary(body.slice(colon + 1)));
    if (!value) return null;
    return out([d(prop, value)]);
  }

  if (!ctx.negative && !ctx.modifier && base in STATIC_SPECIAL)
    return STATIC_SPECIAL[base]!(ctx);
  if (!ctx.negative && !ctx.modifier && base in S)
    return out(S[base]!.map(([p, v]) => d(p, v)));

  // functional: longest root first
  for (let idx = base.length; idx > 0; idx = base.lastIndexOf("-", idx - 1)) {
    const root = base.slice(0, idx);
    const fn = F[root];
    if (!fn) continue;
    const value = idx === base.length ? null : base.slice(idx + 1);
    if (value === "") return null;
    const result = fn(value, ctx);
    if (result) return result;
  }
  return null;
}
