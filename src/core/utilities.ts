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
  return dearbitrary(v.slice(1, -1));
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
  return `${negative ? "-" : ""}${v}px`;
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
        const n = bareSpacing(ctx.modifier);
        if (n === null) return null;
        const lh = spacingCalc(n, false);
        nodes.push(d("--tw-leading", lh), d("line-height", lh));
        return out(nodes, LEADING_PROPS);
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

  z: (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    if (value === "auto")
      return ctx.negative ? null : out([d("z-index", "auto")]);
    if (/^\d+$/.test(value))
      return out([d("z-index", `${ctx.negative ? "-" : ""}${value}`)]);
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
    let v: string | null = null;
    if (value === "linear") v = "linear";
    else if (value === "initial") v = "initial";
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
    const themeKey = value === null ? "--shadow" : `--shadow-${value}`;
    const raw = ctx.theme.get(themeKey);
    if (raw !== undefined) {
      if (ctx.modifier) return null; // shadow opacity modifier: M3
      const folded = foldShadowColors(raw, "--tw-shadow-color");
      return out([d("--tw-shadow", folded), boxShadow], SHADOW_PROPS);
    }
    if (value !== null && isArbitrary(value)) {
      if (ctx.modifier) return null;
      return out(
        [d("--tw-shadow", arbitraryValue(value)), boxShadow],
        SHADOW_PROPS,
      );
    }
    // color path: shadow-red-500 sets --tw-shadow-color (M3: alpha machinery)
    return null;
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

/** Rewrite each shadow's color to var(--tw-shadow-color, <color>) like v4. */
function foldShadowColors(shadowList: string, colorVar: string): string {
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
      parts[colorIdx] = `var(${colorVar}, ${parts[colorIdx]})`;
      return parts.join(" ");
    })
    .join(", ");
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
    return {
      nodes: [
        d(rev, "0"),
        d(props[0]!, `calc(${v} * var(${rev}))`),
        d(props[1]!, `calc(${v} * calc(1 - var(${rev})))`),
      ],
      properties: [P(rev, "0")],
      selectorWrap: (sel) => `:where(${sel} > :not(:last-child))`,
    };
  };
}

function divideUtil(axis: "x" | "y"): Handler {
  const [styleA, styleB, widthA, widthB] =
    axis === "x"
      ? [
          "border-inline-start-style",
          "border-inline-end-style",
          "border-inline-start-width",
          "border-inline-end-width",
        ]
      : [
          "border-bottom-style",
          "border-top-style",
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
        d(styleA, "var(--tw-border-style)"),
        d(styleB, "var(--tw-border-style)"),
        d(widthA, `calc(${w} * var(${rev}))`),
        d(widthB, `calc(${w} * calc(1 - var(${rev})))`),
      ],
      properties: [P(rev, "0"), ...BORDER_STYLE_PROPS],
      selectorWrap: (sel) => `:where(${sel} > :not(:last-child))`,
    };
  };
}

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
};

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
    const value = dearbitrary(body.slice(colon + 1));
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
