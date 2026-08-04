// The utility table: root → handler. Formats mirror the oracle
// (candidatesToCss) byte-for-byte after normalization; when in doubt the
// conformance harness decides, never intuition.
import type { Node } from "./emit.ts";
import type { Theme } from "./theme.ts";
import { dearbitrary } from "./variants.ts";
import { STATICS } from "./statics.ts";

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

/** `divide-*` / `space-*` target the element's non-last children */
const siblingWrap = (sel: string) => `:where(${sel} > :not(:last-child))`;

// ---------- @property groups (order matches oracle emission) ----------
// Every registered property twilight emits lives under `--tw-`, so `P` takes
// the bare suffix and adds the prefix.
const P = (suffix: string, initial?: string, syntax = "*"): PropDef => {
  const name = `--tw-${suffix}`;
  return initial === undefined
    ? { name, syntax, inherits: false }
    : { name, syntax, inherits: false, initial };
};

const BORDER_STYLE_PROPS = [P("border-style", "solid")];
const FONT_WEIGHT_PROPS = [P("font-weight")];
const LEADING_PROPS = [P("leading")];
const TRACKING_PROPS = [P("tracking")];
const DURATION_PROPS = [P("duration")];
const EASE_PROPS = [P("ease")];
const SHADOW_PROPS = [
  P("shadow", "0 0 #0000"),
  P("shadow-color"),
  P("shadow-alpha", "100%", "<percentage>"),
  P("inset-shadow", "0 0 #0000"),
  P("inset-shadow-color"),
  P("inset-shadow-alpha", "100%", "<percentage>"),
  P("ring-color"),
  P("ring-shadow", "0 0 #0000"),
  P("inset-ring-color"),
  P("inset-ring-shadow", "0 0 #0000"),
  P("ring-inset"),
  P("ring-offset-width", "0px", "<length>"),
  P("ring-offset-color", "#fff"),
  P("ring-offset-shadow", "0 0 #0000"),
];
const TRANSLATE_PROPS = [
  P("translate-x", "0"),
  P("translate-y", "0"),
  P("translate-z", "0"),
];
const NUMERIC_PROPS = [
  P("ordinal"),
  P("slashed-zero"),
  P("numeric-figure"),
  P("numeric-spacing"),
  P("numeric-fraction"),
];
const OUTLINE_STYLE_PROPS = [P("outline-style", "solid")];
const BORDER_SPACING_PROPS = [
  P("border-spacing-x", "0", "<length>"),
  P("border-spacing-y", "0", "<length>"),
];

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
  } = {},
): Handler {
  return kindUtil(
    props,
    [
      "S:px=1px=-1px",
      ...(opts.auto ? ["K:auto=auto"] : []),
      ...(opts.full ? ["S:full=100%=-100%"] : []),
      ...(opts.fraction ? ["f"] : []),
      "a",
      "c",
      "#",
    ],
    { negative: opts.negative, fraction: opts.fraction },
  );
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
const SIZE_NAMED_KINDS = Object.entries(SIZE_NAMED).map(
  ([k, v]) => `K:${k}=${v}`,
);
// The `cursor-*` keywords: every one of them passes straight through as the
// CSS value, so a word list is all the table needs.
const CURSOR_KEYWORDS =
  "auto default pointer wait text move help not-allowed none context-menu progress cell crosshair vertical-text alias copy no-drop grab grabbing all-scroll col-resize row-resize n-resize e-resize s-resize w-resize ne-resize nw-resize se-resize sw-resize ew-resize ns-resize nesw-resize nwse-resize zoom-in zoom-out";

/** rotate/skew/hue-rotate: a bare angle (negatable) or an arbitrary (not) */
const ANGLE_KINDS = ["d", "a!"];
/** rounded-*: the two literal corners, then the radius namespace */
const ROUNDED_KINDS = [
  "K:none=0",
  "K:full=calc(infinity * 1px)",
  "T:radius",
  "a",
  "c",
];
/** translate-*: spacing scale plus the px/full/fraction escape hatches */
const TRANSLATE_KINDS = [
  "S:px=1px=-1px",
  "S:full=100%=-100%",
  "f",
  "a",
  "c",
  "#",
];

function sizeUtil(
  prop: string,
  axis: "w" | "h",
  opts: { container?: boolean } = {},
): Handler {
  return kindUtil(
    [prop],
    [
      "K:px=1px",
      "K:lh=1lh",
      ...SIZE_NAMED_KINDS,
      `K:screen=100${axis === "w" ? "vw" : "vh"}`,
      "V",
      ...(opts.container ? ["T:container"] : []),
      "f",
      "a",
      "c",
      "#",
    ],
    { fraction: true },
  );
}

/** bare-int → px scale (underline-offset, outline-offset, border width…) */
function bareToPx(v: string, negative: boolean): string | null {
  if (!/^\d+$/.test(v)) return null;
  return negative ? `calc(${v}px * -1)` : `${v}px`;
}

// ---------- the generic value engine ----------
//
// Most functional utilities are the same program: try a fixed ordered list of
// *value kinds* against the candidate's value, take the first that produces a
// CSS string, then write it into one or more properties. Encoding that list as
// a compact spec and running it through one interpreter — instead of writing
// the ladder out per utility — is what buys the size back. The kind vocabulary:
//
//   #     bare number on the spacing scale → calc(var(--spacing) * N)
//   i     bare integer, verbatim (z-index, tab-size, stroke-width)
//   I     bare integer → Npx (border width, ring width, decoration thickness)
//   d     bare number → Ndeg (rotate, skew, hue-rotate)
//   %     bare number → N%, numerically normalized (opacity, scale)
//   %v    bare number → N%, digits kept verbatim (zoom)
//   P     a literal percentage, passed through (font-stretch)
//   m     bare number → Nms (duration, delay)
//   f     fraction a/b → calc(a / b * 100%)
//   r     ratio a/b, passed through unchanged (aspect-ratio)
//   a     arbitrary [value]
//   c     custom property (--x)
//   V     viewport unit word (dvw, lvh, …) → 100<unit>
//   G     positive int → repeat(N, minmax(0, 1fr))  (grid-cols/rows)
//   N     int → span N / span N  (col-span/row-span)
//   T:ns  theme namespace → var(--ns-value) if present
//   W:a b c  a word list; a matching word is its own CSS value
//   K:k=v named keyword map entry (never negatable)
//   S:k=p=n signed keyword: `p` normally, the literal `n` when negative
//
// A kind may carry a trailing `!` meaning "reject when the candidate is
// negative" (v4 accepts `-z-10` but not `-z-[3]`). Otherwise negation wraps the
// resolved value in `calc(… * -1)`; the `#` kind bakes its own sign because
// `calc(var(--spacing) * -4)` is what the oracle prints, not a double wrap.

type Kind = string;

/** memoized split of a `W:` kind's word list */
const wordSets = new Map<string, Set<string>>();
function wordSet(list: string): Set<string> {
  let s = wordSets.get(list);
  if (s === undefined) wordSets.set(list, (s = new Set(list.split(" "))));
  return s;
}

/**
 * Resolve one value kind. Returns the CSS text, or null if this kind does not
 * apply to `v`. `arg` carries the kind's parameter (theme namespace, keyword).
 */
function resolveKind(
  kind: Kind,
  arg: string,
  v: string,
  ctx: Ctx,
): string | null {
  switch (kind) {
    case "#": {
      const n = bareSpacing(v);
      return n === null ? null : spacingCalc(n, ctx.negative);
    }
    case "i":
      return /^\d+$/.test(v) ? v : null;
    case "I":
      return /^\d+$/.test(v) ? `${v}px` : null;
    case "d":
      return /^\d+(\.\d+)?$/.test(v) ? `${v}deg` : null;
    case "%":
      // `opacity-50` normalizes through Number (so `.5` → `0.5%`), while
      // `zoom-150` keeps the literal digits — hence the two kinds.
      return /^\d+(\.\d+)?$/.test(v) ? `${Number(v)}%` : null;
    case "%v":
      return /^\d+(\.\d+)?$/.test(v) ? `${v}%` : null;
    case "P":
      return /^\d+(\.\d+)?%$/.test(v) ? v : null;
    case "m":
      return /^\d+(\.\d+)?$/.test(v) ? `${v}ms` : null;
    case "f":
      return fraction(v);
    case "r":
      return /^\d+\/\d+$/.test(v) ? v : null; // ratio kept as-is (aspect)
    case "V":
      return /^[dls]v[wh]$/.test(v) ? `100${v}` : null; // dvw/lvh/svh…
    case "G": // grid-cols-3 → repeat(3, minmax(0, 1fr)); zero is rejected
      return /^\d+$/.test(v) && Number(v) > 0
        ? `repeat(${v}, minmax(0, 1fr))`
        : null;
    case "N": // col-span-2 → span 2 / span 2
      return /^\d+$/.test(v) ? `span ${v} / span ${v}` : null;
    case "a":
      return isArbitrary(v) ? arbitraryValue(v) : null;
    case "c":
      return customProp(v);
    case "T":
      return ctx.theme.has(`--${arg}-${v}`) ? `var(--${arg}-${v})` : null;
    case "K": {
      const eq = arg.indexOf("=");
      return arg.slice(0, eq) === v ? arg.slice(eq + 1) : null;
    }
    case "W": // a space-separated word list; the word is its own CSS value
      return wordSet(arg).has(v) ? v : null;
    case "S": {
      // signed keyword `k=positive=negative`: `-mt-px` is `-1px`, not
      // `calc(1px * -1)` — the oracle prints the literal negative form.
      const [k, pos, neg] = arg.split("=");
      return k === v ? (ctx.negative ? neg! : pos!) : null;
    }
  }
  return null;
}

/**
 * Run an ordered kind list against a value. Returns the resolved CSS with
 * negation already applied, or null if nothing matched (or the match cannot
 * be negated and the candidate is negative).
 */
function runKinds(kinds: string[], v: string, ctx: Ctx): string | null {
  for (const spec of kinds) {
    const colon = spec.indexOf(":");
    let kind = colon === -1 ? spec : spec.slice(0, colon);
    const arg = colon === -1 ? "" : spec.slice(colon + 1);
    const noNeg = kind.endsWith("!");
    if (noNeg) kind = kind.slice(0, -1);
    const css = resolveKind(kind, arg, v, ctx);
    if (css === null) continue;
    if (!ctx.negative) return css;
    if (noNeg || kind === "K") return null;
    // `#` and `S` bake their own sign; everything else wraps in calc
    if (kind === "#" || kind === "S") return css;
    return `calc(${css} * -1)`;
  }
  return null;
}

/**
 * The workhorse: build a Handler from a property list and a kind list.
 * `opts.modifier` — false (default) rejects any modifier; `opts.negative`
 * gates whether `-` is accepted at all; `opts.fraction` rejoins the parser's
 * value/modifier split back into `a/b` first.
 */
function kindUtil(
  props: string[],
  kinds: string[],
  opts: {
    negative?: boolean;
    fraction?: boolean;
    /** value for the bare root (`border`, `ring`, `blur` with no value) */
    bare?: string;
    /** CSS function to wrap the resolved value in: `rotateX`, `blur`, … */
    fn?: string;
    /** declarations appended after the props (the shared `transform:` line) */
    tail?: Node[];
    properties?: PropDef[];
  } = {},
): Handler {
  return (rawValue, ctx) => {
    if (ctx.negative && !opts.negative) return null;
    let value = rawValue;
    if (opts.fraction) {
      const joined = rejoinFraction(rawValue, ctx);
      if (joined === undefined) return null;
      value = joined;
    } else if (ctx.modifier !== null) return null;
    let css: string | null;
    if (value === null) {
      if (opts.bare === undefined || ctx.negative) return null;
      css = opts.bare;
    } else css = runKinds(kinds, value, ctx);
    if (css === null) return null;
    if (opts.fn) css = `${opts.fn}(${css})`;
    const nodes: Node[] = props.map((p) => d(p, css!));
    if (opts.tail) nodes.push(...opts.tail);
    return out(nodes, opts.properties);
  };
}

// ---------- static utilities ----------
// Unpack the packed table (see statics.ts for the format) once at init into
// name → [prop, value][]. Grouped lines carry a `|`; the trailing multi-decl
// lines use the plain `name=prop:value;…` form.
const S: Record<string, [string, string][]> = {};
for (const line of STATICS.split("\n")) {
  const bar = line.indexOf("|");
  if (bar !== -1) {
    const bar2 = line.indexOf("|", bar + 1);
    const prop = line.slice(0, bar);
    const prefix = line.slice(bar + 1, bar2);
    for (const entry of line.slice(bar2 + 1).split(";")) {
      const eq = entry.indexOf("=");
      const name = eq === -1 ? entry : entry.slice(0, eq);
      S[prefix + name] = [[prop, eq === -1 ? name : entry.slice(eq + 1)]];
    }
    continue;
  }
  const eq = line.indexOf("=");
  S[line.slice(0, eq)] = line
    .slice(eq + 1)
    .split(";")
    .map((decl) => {
      const c = decl.indexOf(":");
      return [decl.slice(0, c), decl.slice(c + 1)];
    });
}

// ---------- functional utilities ----------

const F: Record<string, Handler> = {
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
    return MAX_W(value, ctx);
  },
  "max-h": sizeUtil("max-height", "h"),
  size: (value, ctx) => {
    const w = SIZE_W(value, ctx);
    const h = SIZE_H(value, ctx);
    if (!w || !h) return null;
    return out([...w.nodes, ...h.nodes]);
  },

  bg: colorUtil(["background-color"]),

  // `text-*` is three utilities wearing one root: a theme font size (whose
  // modifier is a line height), an arbitrary that may be a size or a colour,
  // and otherwise a colour.
  text: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    if (ctx.theme.has(`--text-${value}`)) {
      const size = d("font-size", `var(--text-${value})`);
      if (ctx.modifier === null)
        return out([
          size,
          d(
            "line-height",
            `var(--tw-leading, var(--text-${value}--line-height))`,
          ),
        ]);
      // the modifier is a line height in its own right
      const lh = runKinds(["#", "T:leading", "a"], ctx.modifier, {
        ...ctx,
        negative: false,
      });
      return lh === null ? null : out([size, d("line-height", lh)]);
    }
    if (isArbitrary(value)) {
      const a = arbitraryValue(value);
      // an explicit `length:`/`size:` hint forces the font-size reading
      if (a.startsWith("length:") || a.startsWith("size:"))
        return out([d("font-size", a.slice(a.indexOf(":") + 1))]);
      if (a.startsWith("color:") || looksLikeColor(a) || a.startsWith("var("))
        return colorDecl(["color"], value, ctx);
      return ctx.modifier !== null ? null : out([d("font-size", a)]);
    }
    return colorDecl(["color"], value, ctx);
  },

  "outline-offset": kindUtil(["outline-offset"], ["I", "a"], {
    negative: true,
  }),

  z: kindUtil(["z-index"], ["K:auto=auto", "i", "a!", "c!"], {
    negative: true,
  }),

  opacity: kindUtil(["opacity"], ["%", "a", "c"]),

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

  leading: kindUtil(
    ["--tw-leading", "line-height"],
    ["K:none=1", "T:leading", "a", "c", "#"],
    { properties: LEADING_PROPS },
  ),

  tracking: kindUtil(
    ["--tw-tracking", "letter-spacing"],
    ["T:tracking", "a", "c"],
    { negative: true, properties: TRACKING_PROPS },
  ),

  duration: kindUtil(
    ["--tw-duration", "transition-duration"],
    ["K:initial=initial", "m", "a"],
    { properties: DURATION_PROPS },
  ),

  delay: kindUtil(["transition-delay"], ["m", "a"]),

  // `ease-initial` sets only the custom property — the one shape that does not
  // fit the "same value into every prop" mould, so it stays a special case.
  ease: (value, ctx) =>
    value === "initial" && !ctx.negative && !ctx.modifier
      ? out([d("--tw-ease", "initial")], EASE_PROPS)
      : EASE_REST(value, ctx),

  animate: kindUtil(["animation"], ["K:none=none", "T:animate", "a"]),

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

  shadow: shadowFamily({
    prop: "--tw-shadow",
    ns: "shadow",
    none: "0 0 #0000",
    tail: [d("box-shadow", BOX_SHADOW_VALUE)],
    properties: SHADOW_PROPS,
  }),

  ring: ringUtil(
    "--tw-ring-shadow",
    "--tw-ring-color",
    (w) =>
      `var(--tw-ring-inset,) 0 0 0 calc(${w} + var(--tw-ring-offset-width)) var(--tw-ring-color, currentcolor)`,
  ),

  outline: (value, ctx) => {
    if (ctx.negative) return null;
    // `outline` / `outline-2` set a width; anything else is a colour
    if (!ctx.modifier) {
      const w = value === null ? "1px" : runKinds(["I"], value, ctx);
      if (w !== null)
        return out(
          [
            d("outline-style", "var(--tw-outline-style)"),
            d("outline-width", w),
          ],
          OUTLINE_STYLE_PROPS,
        );
    }
    if (value === null) return null;
    return colorDecl(["outline-color"], value, ctx);
  },

  "underline-offset": kindUtil(
    ["text-underline-offset"],
    ["K:auto=auto", "I", "a"],
    { negative: true },
  ),

  // thickness keywords first (decoration-2, decoration-auto), colours after
  decoration: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    if (!ctx.modifier) {
      const t = runKinds(
        ["I", "K:auto=auto", "K:from-font=from-font"],
        value,
        ctx,
      );
      if (t !== null) return out([d("text-decoration-thickness", t)]);
    }
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
      selectorWrap: siblingWrap,
    };
  },

  flex: kindUtil(["flex"], ["i", "f", "a", "c"], { fraction: true }),

  placeholder: (value, ctx) => {
    if (value === null || ctx.negative) return null;
    const c = colorDecl(["color"], value, ctx);
    if (c === null) return null;
    return { ...c, selectorWrap: (sel) => `${sel}::placeholder` };
  },

  "ring-offset": (value, ctx) => {
    if (value === null || ctx.negative) return null;
    if (!ctx.modifier) {
      const w = runKinds(["I", "a"], value, ctx);
      if (w !== null && !looksLikeColor(w))
        return out([
          d("--tw-ring-offset-width", w),
          d(
            "--tw-ring-offset-shadow",
            "var(--tw-ring-inset,) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color)",
          ),
        ]);
    }
    return colorDecl(["--tw-ring-offset-color"], value, ctx);
  },

  cursor: kindUtil(["cursor"], ["W:" + CURSOR_KEYWORDS, "a", "c"]),

  fill: colorUtil(["fill"], { none: true }),
  stroke: colorUtil(["stroke"], { none: true, width: "stroke-width" }),
  accent: colorUtil(["accent-color"], { auto: true }),
  caret: colorUtil(["caret-color"]),
};

/**
 * Color utilities with the usual keyword escape hatches in front: a `none` or
 * `auto` literal, or (for `stroke`) a bare integer that means a width rather
 * than a color. Anything else goes through the color pipeline.
 */
function colorUtil(
  props: string[],
  opts: { none?: boolean; auto?: boolean; width?: string } = {},
): Handler {
  return (value, ctx) => {
    if (value === null || ctx.negative) return null;
    if (opts.none && value === "none") return out([d(props[0]!, "none")]);
    if (opts.auto && value === "auto") return out([d(props[0]!, "auto")]);
    if (opts.width && /^\d+$/.test(value) && !ctx.modifier)
      return out([d(opts.width, value)]);
    return colorDecl(props, value, ctx);
  };
}

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

/**
 * `shadow-*`, `inset-shadow-*` and `text-shadow-*` are the same program with
 * different property names: a `none` reset, an `initial` colour reset, a theme
 * lookup whose colours fold through `var(--tw-…-color, …)` with the opacity
 * modifier becoming an alpha, an arbitrary non-colour value taking the same
 * fold, and anything else read as a colour. `drop-shadow` stays separate — it
 * splits its value across a size property and a value property, which none of
 * these three do.
 */
/**
 * `ring` and `inset-ring`: a bare or arbitrary width writes the family's
 * box-shadow slot, anything else is a colour. An arbitrary value that reads as
 * a colour falls through to the colour path rather than becoming a width.
 */
function ringUtil(
  shadowProp: string,
  colorProp: string,
  shadow: (width: string) => string,
): Handler {
  return (value, ctx) => {
    if (ctx.negative) return null;
    if (!ctx.modifier) {
      const w = value === null ? "1px" : runKinds(["I", "a"], value, ctx);
      if (w !== null && !looksLikeColor(w))
        return out(
          [d(shadowProp, shadow(w)), d("box-shadow", BOX_SHADOW_VALUE)],
          SHADOW_PROPS,
        );
    }
    if (value === null) return null;
    const c = resolveColor(value, ctx);
    if (c === null) return null;
    const cm = withOpacity(c, ctx.modifier);
    return cm === null ? null : out([d(colorProp, cm)]);
  };
}

function shadowFamily(cfg: {
  /** where the shadow list is written */
  prop: string;
  /** theme namespace, without the leading `--` */
  ns: string;
  /** the `-none` reset value */
  none: string;
  /** `--tw-<x>-color`; defaults to `<prop>-color` */
  colorProp?: string;
  /** `--tw-<x>-alpha`; defaults to `<prop>-alpha` */
  alphaProp?: string;
  /** prefix added to an arbitrary (not themed) value */
  arbPrefix?: string;
  tail?: Node[];
  properties: PropDef[];
}): Handler {
  const colorProp = cfg.colorProp ?? `${cfg.prop}-color`;
  const alphaProp = cfg.alphaProp ?? `${cfg.prop}-alpha`;
  const tail = cfg.tail ?? [];
  return (value, ctx) => {
    if (ctx.negative) return null;
    if (value === "none" || value === "initial") {
      if (ctx.modifier) return null;
      return out(
        value === "none"
          ? [d(cfg.prop, cfg.none), ...tail]
          : [d(colorProp, "initial")],
        cfg.properties,
      );
    }
    const raw = ctx.theme.get(
      value === null ? `--${cfg.ns}` : `--${cfg.ns}-${value}`,
    );
    if (raw !== undefined) {
      const alpha = shadowAlpha(ctx);
      if (alpha === undefined) return null;
      return out(
        [
          ...(alpha ? [d(alphaProp, alpha)] : []),
          d(cfg.prop, foldShadowColors(raw, colorProp, alpha ?? undefined)),
          ...tail,
        ],
        cfg.properties,
      );
    }
    if (value !== null && isArbitrary(value)) {
      const a = arbitraryValue(value);
      if (!looksLikeColor(a) && !a.startsWith("var(")) {
        if (ctx.modifier) return null;
        return out(
          [
            d(cfg.prop, (cfg.arbPrefix ?? "") + foldShadowColors(a, colorProp)),
            ...tail,
          ],
          cfg.properties,
        );
      }
    }
    if (value === null) return null;
    const cm = shadowColorValue(value, ctx, alphaProp);
    if (cm === null) return null;
    return out([d(colorProp, cm)], cfg.properties);
  };
}

/** numeric opacity modifier for shadow-family alpha machinery */
function shadowAlpha(ctx: Ctx): string | null | undefined {
  if (ctx.modifier === null) return null; // no modifier
  if (/^\d+(\.\d+)?$/.test(ctx.modifier)) return `${Number(ctx.modifier)}%`;
  return undefined; // unsupported modifier form
}

/**
 * Split on a separator that is not inside parentheses. Comma splitting keeps
 * empty parts (an empty shadow entry is still an entry); space splitting drops
 * them, so that runs of whitespace collapse.
 */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  const keepEmpty = sep === ",";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === sep && depth === 0) {
      if (keepEmpty || i > start) parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (keepEmpty || s.length > start) parts.push(s.slice(start));
  return parts;
}
const splitTopLevelCommas = (s: string) => splitTopLevel(s, ",");
const splitTopLevelSpaces = (s: string) => splitTopLevel(s, " ");

const BORDER_STYLES = /^(solid|dashed|dotted|double|hidden|none)$/;
function borderUtil(side: string): Handler {
  // `border` → border-width; `border-t` → border-top-width; and so on
  const infix = side === "" ? "" : `-${side}`;
  const widthProp = `border${infix}-width`;
  const styleProp = `border${infix}-style`;
  const width = (w: string) =>
    out(
      [d(styleProp, "var(--tw-border-style)"), d(widthProp, w)],
      BORDER_STYLE_PROPS,
    );
  return (value, ctx) => {
    if (ctx.negative) return null;
    if (value === null) return ctx.modifier ? null : width("1px");
    if (ctx.modifier === null) {
      const w = runKinds(["I"], value, ctx);
      if (w !== null) return width(w);
      if (BORDER_STYLES.test(value))
        return out([d("--tw-border-style", value), d(styleProp, value)]);
      // an arbitrary value is a width unless it reads as a colour
      if (isArbitrary(value)) {
        const a = arbitraryValue(value);
        if (!looksLikeColor(a) && !a.startsWith("var(")) return width(a);
      }
    }
    return colorDecl([`border${infix}-color`], value, ctx);
  };
}

function roundedUtil(corners: string[]): Handler {
  const props = corners.map((c) =>
    c === "" ? "border-radius" : `border-${c}-radius`,
  );
  const valued = kindUtil(props, ROUNDED_KINDS);
  return (value, ctx) => {
    // the bare `rounded` root reads the deprecated inline `--radius` value,
    // which only exists once the theme is built — so it is read per call
    if (value !== null) return valued(value, ctx);
    if (ctx.negative || ctx.modifier) return null;
    const v = ctx.theme.get("--radius");
    return v === undefined ? null : out(props.map((p) => d(p, v)));
  };
}

function gridTemplate(prop: string): Handler {
  return kindUtil(
    [prop],
    [
      "G", // positive int → repeat(N, minmax(0, 1fr))
      "K:none=none",
      "K:subgrid=subgrid",
      "a",
    ],
  );
}

function gridSpan(prop: string): Handler {
  return kindUtil([prop], ["N", "K:full=1 / -1"]);
}

function translateUtil(axis: "x" | "y"): Handler {
  return kindUtil([`--tw-translate-${axis}`], TRANSLATE_KINDS, {
    negative: true,
    fraction: true,
    tail: [d("translate", "var(--tw-translate-x) var(--tw-translate-y)")],
    properties: TRANSLATE_PROPS,
  });
}

function spaceUtil(axis: "x" | "y"): Handler {
  const props =
    axis === "x"
      ? ["margin-inline-start", "margin-inline-end"]
      : ["margin-block-start", "margin-block-end"];
  return (value, ctx) => {
    if (value === null || ctx.modifier) return null;
    const v = runKinds(["S:px=1px=-1px", "a", "#"], value, ctx);
    if (v === null) return null;
    const suffix = `space-${axis}-reverse`;
    const rev = `--tw-${suffix}`;
    const zero = v === "0px";
    return {
      nodes: [
        d(rev, "0"),
        d(props[0]!, zero ? "0" : `calc(${v} * var(${rev}))`),
        d(props[1]!, zero ? "0" : `calc(${v} * calc(1 - var(${rev})))`),
      ],
      properties: [P(suffix, "0")],
      selectorWrap: siblingWrap,
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
    const w = value === null ? "1px" : runKinds(["I", "a"], value, ctx);
    if (w === null) return null;
    const suffix = `divide-${axis}-reverse`;
    const rev = `--tw-${suffix}`;
    return {
      nodes: [
        d(rev, "0"),
        ...styles.map((sp) => d(sp, "var(--tw-border-style)")),
        d(widthA, `calc(${w} * var(${rev}))`),
        d(widthB, `calc(${w} * calc(1 - var(${rev})))`),
      ],
      properties: [P(suffix, "0"), ...BORDER_STYLE_PROPS],
      selectorWrap: siblingWrap,
    };
  };
}

// ---------- composed families: filters, transforms, gradients, masks ----------

const GRADIENT_PROPS = [
  P("gradient-position"),
  P("gradient-from", "#0000", "<color>"),
  P("gradient-via", "#0000", "<color>"),
  P("gradient-to", "#0000", "<color>"),
  P("gradient-stops"),
  P("gradient-via-stops"),
  P("gradient-from-position", "0%", "<length-percentage>"),
  P("gradient-via-position", "50%", "<length-percentage>"),
  P("gradient-to-position", "100%", "<length-percentage>"),
];
const FILTER_PROPS = [
  P("blur"),
  P("brightness"),
  P("contrast"),
  P("grayscale"),
  P("hue-rotate"),
  P("invert"),
  P("opacity"),
  P("saturate"),
  P("sepia"),
  P("drop-shadow"),
  P("drop-shadow-color"),
  P("drop-shadow-alpha", "100%", "<percentage>"),
  P("drop-shadow-size"),
];
const BACKDROP_PROPS = [
  P("backdrop-blur"),
  P("backdrop-brightness"),
  P("backdrop-contrast"),
  P("backdrop-grayscale"),
  P("backdrop-hue-rotate"),
  P("backdrop-invert"),
  P("backdrop-opacity"),
  P("backdrop-saturate"),
  P("backdrop-sepia"),
];
const TRANSFORM_PROPS = [
  P("rotate-x"),
  P("rotate-y"),
  P("rotate-z"),
  P("skew-x"),
  P("skew-y"),
];
const SCALE_PROPS = [P("scale-x", "1"), P("scale-y", "1"), P("scale-z", "1")];
const TEXT_SHADOW_PROPS = [
  P("text-shadow-color"),
  P("text-shadow-alpha", "100%", "<percentage>"),
];
const SCROLLBAR_PROPS = [
  P("scrollbar-thumb", "#0000", "<color>"),
  P("scrollbar-track", "#0000", "<color>"),
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

// Handlers that a couple of roots delegate into. Built once at module load:
// building them inside the handler would allocate a closure per compiled
// token, which the bench notices.
const MAX_W = sizeUtil("max-width", "w", { container: true });
const SIZE_W = sizeUtil("width", "w");
const SIZE_H = sizeUtil("height", "h");
const EASE_REST = kindUtil(
  ["--tw-ease", "transition-timing-function"],
  ["K:linear=linear", "T:ease", "a"],
  { properties: EASE_PROPS },
);
const SCALE_AXES = kindUtil(
  ["--tw-scale-x", "--tw-scale-y", "--tw-scale-z"],
  ["%v"],
  {
    negative: true,
    tail: [d("scale", "var(--tw-scale-x) var(--tw-scale-y)")],
    properties: SCALE_PROPS,
  },
);
const SCALE_REST = kindUtil(["scale"], ["K:none=none", "a!"], {
  negative: true,
});
const TRANSFORM_KEYWORDS = kindUtil(
  ["transform"],
  [
    "K:none=none",
    `K:gpu=translateZ(0) ${TRANSFORM_VALUE}`,
    `K:cpu=${TRANSFORM_VALUE}`,
    "a",
  ],
);
const TRANSLATE_XY = kindUtil(
  ["--tw-translate-x", "--tw-translate-y"],
  TRANSLATE_KINDS,
  {
    negative: true,
    fraction: true,
    tail: [d("translate", "var(--tw-translate-x) var(--tw-translate-y)")],
    properties: TRANSLATE_PROPS,
  },
);
const TRANSLATE_Z = kindUtil(["--tw-translate-z"], TRANSLATE_KINDS, {
  negative: true,
  tail: [
    d(
      "translate",
      "var(--tw-translate-x) var(--tw-translate-y) var(--tw-translate-z)",
    ),
  ],
  properties: TRANSLATE_PROPS,
});

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

/**
 * `blur` and `backdrop-blur`: both read the `--blur-*` namespace and both
 * spell their reset as a single space rather than `none`, because the filter
 * chain concatenates `var(--tw-blur,)` slots.
 */
function blurUtil(twVar: string, tail: Node[], props: PropDef[]): Handler {
  return (value, ctx) => {
    if (ctx.negative || ctx.modifier) return null;
    if (value === "none") return out([d(twVar, " "), ...tail], props);
    const arg =
      value === null
        ? (ctx.theme.get("--blur") ?? null)
        : runKinds(["T:blur", "a", "c"], value, ctx);
    if (arg === null) return null;
    return out([d(twVar, `blur(${arg})`), ...tail], props);
  };
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
  blur: blurUtil("--tw-blur", [filterDecl()], FILTER_PROPS),
  "hue-rotate": kindUtil(["--tw-hue-rotate"], ANGLE_KINDS, {
    negative: true,
    fn: "hue-rotate",
    tail: [filterDecl()],
    properties: FILTER_PROPS,
  }),
  "drop-shadow": (value, ctx) => {
    if (ctx.negative) return null;
    if (value === "none") {
      if (ctx.modifier) return null;
      return out([d("--tw-drop-shadow", " "), filterDecl()], FILTER_PROPS);
    }
    const themeKey =
      value === null ? "--drop-shadow" : `--drop-shadow-${value}`;
    // each comma-separated shadow becomes its own drop-shadow() function,
    // because the CSS filter property chains them rather than listing them
    const size = (list: string) =>
      splitTopLevelCommas(list)
        .map(
          (s) =>
            `drop-shadow(${foldShadowColors(s.trim(), "--tw-drop-shadow-color")})`,
        )
        .join(" ");
    const sized = (sizeValue: string, dropShadow: string) =>
      out(
        [
          d("--tw-drop-shadow-size", sizeValue),
          d("--tw-drop-shadow", dropShadow),
          filterDecl(),
        ],
        FILTER_PROPS,
      );
    const raw = ctx.theme.get(themeKey);
    if (raw !== undefined) {
      if (ctx.modifier) return null;
      return sized(
        size(raw),
        value === null
          ? "var(--tw-drop-shadow-size)"
          : `drop-shadow(var(${themeKey}))`,
      );
    }
    if (value !== null && isArbitrary(value)) {
      const a = arbitraryValue(value);
      if (!looksLikeColor(a) && !a.startsWith("var(")) {
        if (ctx.modifier) return null;
        return sized(size(a), "var(--tw-drop-shadow-size)");
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
  "backdrop-blur": blurUtil(
    "--tw-backdrop-blur",
    backdropDecls(),
    BACKDROP_PROPS,
  ),
  "backdrop-hue-rotate": kindUtil(["--tw-backdrop-hue-rotate"], ANGLE_KINDS, {
    negative: true,
    fn: "hue-rotate",
    tail: backdropDecls(),
    properties: BACKDROP_PROPS,
  }),
  "backdrop-filter-none": () =>
    out([d("-webkit-backdrop-filter", "none"), d("backdrop-filter", "none")]),

  // --- transforms ---
  rotate: kindUtil(["rotate"], ["K:none=none", ...ANGLE_KINDS], {
    negative: true,
  }),
  // `scale-none` and `scale-[…]` write the `scale` shorthand directly, while a
  // bare number fans out across the three axis custom properties — two
  // different output shapes under one root, so the dispatch stays explicit.
  scale: (value, ctx) =>
    value !== null && /^\d+(\.\d+)?$/.test(value)
      ? SCALE_AXES(value, ctx)
      : SCALE_REST(value, ctx),
  // bare `transform` also declares the @property group; the keyword forms
  // write a fixed string and do not
  transform: (value, ctx) =>
    value === null
      ? ctx.negative || ctx.modifier
        ? null
        : out([d("transform", TRANSFORM_VALUE)], TRANSFORM_PROPS)
      : TRANSFORM_KEYWORDS(value, ctx),
  translate: (value, ctx) =>
    value === "none"
      ? ctx.negative || ctx.modifier
        ? null
        : out([d("translate", "none")])
      : TRANSLATE_XY(value, ctx),
  "translate-z": TRANSLATE_Z,

  // --- gradient stops ---
  from: gradientStop("from"),
  via: gradientStop("via"),
  to: gradientStop("to"),

  // --- text-shadow ---
  // text-shadow writes the real CSS property rather than a `--tw-*` slot, but
  // its color still folds through `--tw-text-shadow-color` like the others.
  "text-shadow": shadowFamily({
    prop: "text-shadow",
    colorProp: "--tw-text-shadow-color",
    alphaProp: "--tw-text-shadow-alpha",
    ns: "text-shadow",
    none: "none",
    properties: TEXT_SHADOW_PROPS,
  }),

  // --- scrollbar ---
  "scrollbar-thumb": scrollbarColor("--tw-scrollbar-thumb"),
  "scrollbar-track": scrollbarColor("--tw-scrollbar-track"),

  // --- inset ring / inset shadow ---
  "inset-ring": ringUtil(
    "--tw-inset-ring-shadow",
    "--tw-inset-ring-color",
    (w) => `inset 0 0 0 ${w} var(--tw-inset-ring-color, currentcolor)`,
  ),
  "inset-shadow": shadowFamily({
    prop: "--tw-inset-shadow",
    ns: "inset-shadow",
    none: "inset 0 0 #0000",
    // an arbitrary inset shadow gains the `inset` keyword; a themed one
    // already carries it in the theme value
    arbPrefix: "inset ",
    tail: [d("box-shadow", BOX_SHADOW_VALUE)],
    properties: SHADOW_PROPS,
  }),

  // --- misc ---
  zoom: kindUtil(["zoom"], ["%v", "a"]),
  tab: kindUtil(["tab-size"], ["i", "a"]),
  "font-stretch": kindUtil(["font-stretch"], ["P", "a"]),
  basis: kindUtil(
    ["flex-basis"],
    [
      "K:full=100%",
      "K:auto=auto",
      "K:px=1px",
      "T:container",
      "f",
      "a",
      "c",
      "#",
    ],
    { fraction: true },
  ),
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

  columns: kindUtil(["columns"], ["i", "K:auto=auto", "T:container", "a", "c"]),

  perspective: kindUtil(
    ["perspective"],
    ["K:none=none", "T:perspective", "a", "c"],
  ),

  "border-spacing": borderSpacing(["x", "y"]),
  "border-spacing-x": borderSpacing(["x"]),
  "border-spacing-y": borderSpacing(["y"]),

  // line-clamp sets a four-declaration block whose first three flip wholesale
  // between the `none` reset and any real clamp count
  "line-clamp": (value, ctx) => {
    if (value === null || ctx.negative || ctx.modifier) return null;
    const n = value === "none" ? null : runKinds(["i", "a", "c"], value, ctx);
    if (n === null && value !== "none") return null;
    const reset = n === null;
    return out([
      d("overflow", reset ? "visible" : "hidden"),
      d("display", reset ? "block" : "-webkit-box"),
      d("-webkit-box-orient", reset ? "horizontal" : "vertical"),
      d("-webkit-line-clamp", reset ? "unset" : n),
    ]);
  },

  aspect: kindUtil(
    ["aspect-ratio"],
    ["K:auto=auto", "K:square=1 / 1", "T:aspect", "r", "a", "c"],
    { fraction: true },
  ),

  // gradient background images
  "bg-linear": bgGradient("linear"),
  "bg-conic": bgGradient("conic"),
  "bg-radial": bgGradient("radial"),
};

function intUtil(prop: string, named: Record<string, string> = {}): Handler {
  return kindUtil(
    [prop],
    [...Object.entries(named).map(([k, v]) => `K:${k}=${v}`), "i", "a!", "c!"],
    { negative: true },
  );
}

function logicalSize(prop: string, opts: { none?: boolean } = {}): Handler {
  const vp = prop.includes("inline") ? "vw" : "vh";
  return kindUtil(
    [prop],
    [
      "K:px=1px",
      "K:lh=1lh",
      ...(opts.none ? ["K:none=none"] : []),
      `K:screen=100${vp}`,
      "V", // dvw/lvh/svh… → 100<unit>
      ...SIZE_NAMED_KINDS,
      "T:container",
      "f",
      "a",
      "c",
      "#",
    ],
    { fraction: true },
  );
}

function borderSpacing(axes: ("x" | "y")[]): Handler {
  return kindUtil(
    axes.map((a) => `--tw-border-spacing-${a}`),
    ["K:px=1px", "a", "c", "#"],
    {
      tail: [
        d(
          "border-spacing",
          "var(--tw-border-spacing-x) var(--tw-border-spacing-y)",
        ),
      ],
      properties: BORDER_SPACING_PROPS,
    },
  );
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
    // an arbitrary position is written verbatim and also becomes the
    // background-image fallback — the same for all three shapes
    if (value !== null && isArbitrary(value) && !ctx.negative) {
      const a = arbitraryValue(value);
      return out([d("--tw-gradient-position", a), image(a)]);
    }
    if (shape === "radial")
      return value === null && !ctx.negative
        ? out([d("--tw-gradient-position", `in ${interp}`), image()])
        : null;
    if (value === null) return null;
    // linear takes a named side or an angle; conic takes an angle only
    const deg = runKinds(ANGLE_KINDS, value, ctx);
    if (shape === "conic")
      return deg === null
        ? null
        : out([
            d("--tw-gradient-position", `from ${deg} in ${interp}`),
            image(),
          ]);
    const pos =
      !ctx.negative && value.startsWith("to-") && SIDES[value.slice(3)]
        ? `to ${SIDES[value.slice(3)]}`
        : deg;
    if (pos === null) return null;
    return out([
      d("--tw-gradient-position", pos),
      {
        at: "@supports (background-image: linear-gradient(in lab, red, red))",
        nodes: [d("--tw-gradient-position", `${pos} in ${interp}`)],
      },
      image(),
    ]);
  };
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

// every mask slot's @property initial-value is the same opaque gradient
const MASK_WHITE = "linear-gradient(#fff, #fff)";
const maskSlotProps = (names: string) =>
  names.split(" ").map((n) => P(`mask-${n}`, MASK_WHITE));
const MASK_BASE_PROPS = maskSlotProps("linear radial conic");
const MASK_SIDE_PROPS = maskSlotProps("left right bottom top");
const maskEdgeProps = (side: string) => [
  P(`mask-${side}-from-position`, "0%"),
  P(`mask-${side}-to-position`, "100%"),
  P(`mask-${side}-from-color`, "black"),
  P(`mask-${side}-to-color`, "transparent"),
];
const maskAngleProps = (shape: string) => [
  ...MASK_BASE_PROPS,
  P(`mask-${shape}-position`, "0deg"),
  ...maskEdgeProps(shape),
];
const MASK_LINEAR_ANGLE_PROPS = maskAngleProps("linear");
const MASK_CONIC_ANGLE_PROPS = maskAngleProps("conic");

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
  const props = [
    ...MASK_BASE_PROPS,
    ...MASK_SIDE_PROPS,
    ...sides.flatMap((side) => maskEdgeProps(side)),
  ];
  return (value, ctx) => {
    if (value === null || ctx.negative) return null;
    const s = maskStop(value, ctx);
    if (s === null) return null;
    if (s.kind === "position" && ctx.modifier) return null;
    const nodes = [...MASK_HEAD, MASK_EDGES_DECL];
    for (const side of sides) {
      nodes.push(
        maskSideGradient(side),
        d(`--tw-mask-${side}-${stop}-${s.kind}`, s.css),
      );
    }
    return out(nodes, props);
  };
}

function maskShapeUtil(
  shape: "linear" | "radial" | "conic",
  stop: "from" | "to",
): Handler {
  const stopsVar = `--tw-mask-${shape}-stops`;
  // every shape ends its stop list the same way; only the head differs —
  // an angle for linear, a `from` angle for conic, shape/size/position for
  // radial (whose extra slots also add three @property entries).
  const v = (suffix: string) => `var(--tw-mask-${shape}-${suffix})`;
  const head =
    shape === "linear"
      ? v("position")
      : shape === "conic"
        ? `from ${v("position")}`
        : `${v("shape")} ${v("size")} at ${v("position")}`;
  const stopsValue = `${head}, ${v("from-color")} ${v("from-position")}, ${v("to-color")} ${v("to-position")}`;
  const shapeProps =
    shape === "radial"
      ? [
          ...maskEdgeProps("radial"),
          P("mask-radial-shape", "ellipse"),
          P("mask-radial-size", "farthest-corner"),
          P("mask-radial-position", "center"),
        ]
      : [P(`mask-${shape}-position`, "0deg"), ...maskEdgeProps(shape)];
  const gradientFn = `${shape}-gradient`;
  const allProps = [...MASK_BASE_PROPS, ...shapeProps];
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
      allProps,
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
    MASK_LINEAR_ANGLE_PROPS,
  );
};
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
    MASK_CONIC_ANGLE_PROPS,
  );
};
COMPOSED["mask-none"] = (value, ctx) =>
  value === null && !ctx.negative && !ctx.modifier
    ? out([d("mask-image", "none")])
    : null;

// rotate-x/y/z, skew/skew-x/skew-y, scale-x/y/z — all the same shape: an
// angle (or percentage) that is negatable only in its bare-numeric form, piped
// into one custom property plus the family's shared composite declaration.
// The percentage filters: identical but for the CSS function name, the slot
// they write, and whether a bare root means 100%. `filter-*` and
// `backdrop-filter-*` differ only in the prefix and the trailing declarations.
for (const spec of "brightness contrast saturate grayscale! invert! sepia! opacity=".split(
  " ",
)) {
  // trailing `!` → bare root defaults to 100%; trailing `=` → backdrop-only
  const bare = spec.endsWith("!") ? "100%" : undefined;
  const backdropOnly = spec.endsWith("=");
  const fn = spec.replace(/[!=]$/, "");
  if (!backdropOnly)
    COMPOSED[fn] = pctFilter(
      fn,
      `--tw-${fn}`,
      FILTER_PROPS,
      () => [filterDecl()],
      bare,
    );
  COMPOSED[`backdrop-${fn}`] = pctFilter(
    fn,
    `--tw-backdrop-${fn}`,
    BACKDROP_PROPS,
    backdropDecls,
    bare,
  );
}

const TRANSFORM_TAIL = [d("transform", TRANSFORM_VALUE)];
for (const axis of ["x", "y", "z"] as const) {
  const up = axis.toUpperCase();
  COMPOSED[`rotate-${axis}`] = kindUtil([`--tw-rotate-${axis}`], ANGLE_KINDS, {
    negative: true,
    fn: `rotate${up}`,
    tail: TRANSFORM_TAIL,
    properties: TRANSFORM_PROPS,
  });
  COMPOSED[`scale-${axis}`] = kindUtil([`--tw-scale-${axis}`], ["%v", "a!"], {
    negative: true,
    tail: [
      d(
        "scale",
        axis === "z"
          ? "var(--tw-scale-x) var(--tw-scale-y) var(--tw-scale-z)"
          : "var(--tw-scale-x) var(--tw-scale-y)",
      ),
    ],
    properties: SCALE_PROPS,
  });
  if (axis !== "z")
    COMPOSED[`skew-${axis}`] = kindUtil([`--tw-skew-${axis}`], ANGLE_KINDS, {
      negative: true,
      fn: `skew${up}`,
      tail: TRANSFORM_TAIL,
      properties: TRANSFORM_PROPS,
    });
}
// bare `skew-6` sets both axes, each with its own skewX/skewY wrapper — two
// different wrappers means it can't use `fn`, so it stays explicit.
COMPOSED["skew"] = (value, ctx) => {
  if (value === null || ctx.modifier) return null;
  const arg = runKinds(ANGLE_KINDS, value, ctx);
  if (arg === null) return null;
  return out(
    [
      d("--tw-skew-x", `skewX(${arg})`),
      d("--tw-skew-y", `skewY(${arg})`),
      ...TRANSFORM_TAIL,
    ],
    TRANSFORM_PROPS,
  );
};

// ---------- spacing families, generated ----------
// The padding/margin/scroll-* families are pure suffix algebra: a root letter
// picks the CSS property, a suffix letter picks the box side. Expanding them
// from this table instead of ~60 literal call sites is where most of the
// spacing bytes went. Suffix key → property suffix:
const SIDE_SUFFIX: Record<string, string> = {
  "": "",
  x: "-inline",
  y: "-block",
  s: "-inline-start",
  e: "-inline-end",
  t: "-top",
  r: "-right",
  b: "-bottom",
  l: "-left",
  bs: "-block-start",
  be: "-block-end",
};
const SIDES_ALL = ["", "x", "y", "s", "e", "t", "r", "b", "l", "bs", "be"];
// root prefix → [property base, spacingUtil opts, allowed side keys]
const INSET_OPTS = {
  auto: true,
  negative: true,
  fraction: true,
  full: true,
} as const;
for (const [prefix, prop, opts, sides] of [
  ["p", "padding", {}, SIDES_ALL],
  ["m", "margin", { auto: true, negative: true }, SIDES_ALL],
  ["scroll-p", "scroll-padding", {}, SIDES_ALL],
  ["scroll-m", "scroll-margin", { negative: true }, SIDES_ALL],
  ["inset", "inset", INSET_OPTS, ["", "x", "y", "s", "e", "bs", "be"]],
] as const) {
  // `p`+`x` → `px`, but `inset`+`x` → `inset-x` (multi-letter roots hyphenate)
  const sep = prefix === "inset" ? "-" : "";
  for (const side of sides)
    COMPOSED[side ? prefix + sep + side : prefix] = spacingUtil(
      [prop + SIDE_SUFFIX[side]!],
      opts,
    );
}
// border-* sides and rounded-* corners: two more suffix tables. The border
// suffix names a CSS box side; the rounded suffix names one or two corners.
for (const [suffix, side] of [
  ["", ""],
  ["-t", "top"],
  ["-r", "right"],
  ["-b", "bottom"],
  ["-l", "left"],
  ["-x", "inline"],
  ["-y", "block"],
  ["-s", "inline-start"],
  ["-e", "inline-end"],
  ["-bs", "block-start"],
  ["-be", "block-end"],
] as const)
  COMPOSED[`border${suffix}`] = borderUtil(side);

for (const [suffix, corners] of [
  ["", ""],
  ["-t", "top-left top-right"],
  ["-r", "top-right bottom-right"],
  ["-b", "bottom-right bottom-left"],
  ["-l", "top-left bottom-left"],
  ["-tl", "top-left"],
  ["-tr", "top-right"],
  ["-br", "bottom-right"],
  ["-bl", "bottom-left"],
  ["-s", "start-start end-start"],
  ["-e", "start-end end-end"],
  ["-ss", "start-start"],
  ["-se", "start-end"],
  ["-es", "end-start"],
  ["-ee", "end-end"],
] as const)
  COMPOSED[`rounded${suffix}`] = roundedUtil(corners.split(" "));

Object.assign(COMPOSED, {
  gap: spacingUtil(["gap"]),
  "gap-x": spacingUtil(["column-gap"]),
  "gap-y": spacingUtil(["row-gap"]),
  top: spacingUtil(["top"], INSET_OPTS),
  right: spacingUtil(["right"], INSET_OPTS),
  bottom: spacingUtil(["bottom"], INSET_OPTS),
  left: spacingUtil(["left"], INSET_OPTS),
  start: spacingUtil(["inset-inline-start"], INSET_OPTS),
  end: spacingUtil(["inset-inline-end"], INSET_OPTS),
  indent: spacingUtil(["text-indent"], { negative: true }),
});

Object.assign(F, COMPOSED);

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
  ...numericStatics(),
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

/**
 * The `font-variant-numeric` utilities. Each writes its own `--tw-*` slot; the
 * shorthand then concatenates all five slots, so they compose rather than
 * overwrite. `slot=name` where the utility name differs from its CSS value.
 */
function numericStatics() {
  const entries: Record<string, () => UtilityOutput> = {};
  for (const group of [
    "ordinal",
    "slashed-zero",
    "numeric-figure=lining-nums oldstyle-nums",
    "numeric-spacing=tabular-nums proportional-nums",
    "numeric-fraction=diagonal-fractions stacked-fractions",
  ]) {
    const eq = group.indexOf("=");
    const slot = eq === -1 ? group : group.slice(0, eq);
    for (const name of (eq === -1 ? group : group.slice(eq + 1)).split(" "))
      entries[name] = () => numericUtil(`--tw-${slot}`, name);
  }
  return entries;
}

function touchStatics() {
  const TOUCH_PROPS = [P("pan-x"), P("pan-y"), P("pinch-zoom")];
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
  const SNAP_PROPS = [P("scroll-snap-strictness", "proximity")];
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
  const entries: Record<string, () => UtilityOutput> = {};
  for (const [kind, axis] of [
    ["space", "x"],
    ["space", "y"],
    ["divide", "x"],
    ["divide", "y"],
  ] as const) {
    const suffix = `${kind}-${axis}-reverse`;
    const rev = `--tw-${suffix}`;
    entries[`${kind}-${axis}-reverse`] = () => ({
      nodes: [d(rev, "1")],
      properties: [P(suffix, "0")],
      selectorWrap: siblingWrap,
    });
  }
  return entries;
}

function divideStyleStatics() {
  const entries: Record<string, () => UtilityOutput> = {};
  for (const style of ["solid", "dashed", "dotted", "double", "none"]) {
    entries[`divide-${style}`] = () => ({
      nodes: [d("--tw-border-style", style), d("border-style", style)],
      selectorWrap: siblingWrap,
    });
  }
  return entries;
}

function containStatics() {
  const CONTAIN_PROPS = [
    P("contain-size"),
    P("contain-layout"),
    P("contain-paint"),
    P("contain-style"),
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

  if (!ctx.negative && !ctx.modifier) {
    const special = SPECIAL_MAP.get(base);
    if (special) return special(ctx);
    const statics = S_MAP.get(base);
    if (statics) return out(statics.map(([p, v]) => d(p, v)));
  }

  // functional: longest root first
  for (let idx = base.length; idx > 0; idx = base.lastIndexOf("-", idx - 1)) {
    const root = base.slice(0, idx);
    const fn = F_MAP.get(root);
    if (!fn) continue;
    const value = idx === base.length ? null : base.slice(idx + 1);
    if (value === "") return null;
    const result = fn(value, ctx);
    if (result) return result;
  }
  return null;
}

// Map-backed dispatch (built once, after all table assembly above)
const S_MAP = new Map(Object.entries(S));
const F_MAP = new Map(Object.entries(F));
const SPECIAL_MAP = new Map(Object.entries(STATIC_SPECIAL));
