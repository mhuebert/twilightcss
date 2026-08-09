// Theme access: parse the shipped `:root` theme CSS into a Map at init.
// The CSS string is the single source of truth — the engine derives the JS
// view from it instead of embedding a second copy of the palette.

export interface Theme {
  /** var name (with leading --) → value, whitespace-collapsed */
  vars: Map<string, string>;
  /** deprecated `inline reference` values (bare --shadow, --radius, …) */
  inline: Map<string, string>;
  get(name: string): string | undefined;
  has(name: string): boolean;
}

export function parseThemeVars(css: string): Map<string, string> {
  const vars = new Map<string, string>();
  // Strip @keyframes blocks (balanced braces), then scan declarations.
  let out = "";
  let i = 0;
  while (i < css.length) {
    const kf = css.indexOf("@keyframes", i);
    if (kf === -1) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, kf);
    let j = css.indexOf("{", kf);
    let depth = 1;
    j++;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    i = j;
  }
  for (const m of out.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)[;}]/g)) {
    vars.set(m[1]!, m[2]!.replace(/\s+/g, " ").trim());
  }
  return vars;
}

export function createTheme(
  themeCss: string,
  inlineVars: Record<string, string> = {},
): Theme {
  const vars = parseThemeVars(themeCss);
  const inline = new Map(Object.entries(inlineVars));
  return {
    vars,
    inline,
    get: (name) => vars.get(name) ?? inline.get(name),
    has: (name) => vars.has(name) || inline.has(name),
  };
}

/**
 * A theme that reads `overlay` first, then `base` — without touching either
 * (`base` is often the shared defaultTheme). The overlay map stays live:
 * vars merged into it later (page `@theme` blocks) are visible to every
 * subsequent lookup, which is what lets late-arriving theme extensions
 * validate candidates and breakpoint variants with no recompute.
 */
export function overlayTheme(base: Theme, overlay: Map<string, string>): Theme {
  return {
    // the raw views stay the base's; lookups go through get/has
    vars: base.vars,
    inline: base.inline,
    get: (name) => overlay.get(name) ?? base.get(name),
    has: (name) => overlay.has(name) || base.has(name),
  };
}
