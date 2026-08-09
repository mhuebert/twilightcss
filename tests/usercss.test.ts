import { describe, it, expect } from "vitest";
import { expandApply, extractTheme } from "../src/core/usercss.ts";
import { defaultTheme } from "../src/core/index.ts";

describe("extractTheme", () => {
  it("collects vars and lowers @theme to :root", () => {
    const { vars, css } = extractTheme(
      `@theme { --color-brand-500: oklch(0.7 0.15 200); --breakpoint-huge: 100rem }
       .plain { color: red; }`,
    );
    expect(vars.get("--color-brand-500")).toBe("oklch(0.7 0.15 200)");
    expect(vars.get("--breakpoint-huge")).toBe("100rem");
    expect(css).toContain(":root {");
    expect(css).toContain("--color-brand-500: oklch(0.7 0.15 200)");
    expect(css).toContain(".plain { color: red; }");
    expect(css).not.toContain("@theme");
  });

  it("treats @theme inline/static as plain @theme", () => {
    const { vars, css } = extractTheme(
      `@theme inline { --font-display: Poppins, sans-serif; }`,
    );
    expect(vars.get("--font-display")).toBe("Poppins, sans-serif");
    expect(css).toContain(":root {");
  });

  it("hoists @keyframes out of @theme bodies", () => {
    const { vars, css } = extractTheme(
      `@theme { --animate-wiggle: wiggle 1s infinite;
        @keyframes wiggle { 50% { transform: rotate(3deg); } } }`,
    );
    expect(vars.get("--animate-wiggle")).toBe("wiggle 1s infinite");
    expect(vars.has("--transform")).toBe(false);
    // keyframes land at top level, not inside :root
    const root = css.slice(css.indexOf(":root"), css.indexOf("}") + 1);
    expect(root).not.toContain("@keyframes");
    expect(css).toContain("@keyframes wiggle");
  });

  it("ignores @theme-like text inside strings, comments, and blocks", () => {
    const input = `/* @theme { --color-fake-500: red } */
      .x { content: "@theme { --color-fake2-500: red }"; }`;
    const { vars, css } = extractTheme(input);
    expect(vars.size).toBe(0);
    expect(css).toBe(input);
  });

  it("handles a final declaration without a semicolon", () => {
    const { vars } = extractTheme(`@theme { --color-last-500: blue }`);
    expect(vars.get("--color-last-500")).toBe("blue");
  });
});

const expand = (text: string) => expandApply(text, defaultTheme);

describe("expandApply", () => {
  it("splices bare utilities' declarations in at the @apply site", () => {
    const { css, unknown } = expand(`.btn { color: red; @apply px-4 mt-2; }`);
    expect(unknown).toEqual([]);
    expect(css).toContain("color: red;");
    expect(css).toContain("padding-inline: calc(var(--spacing) * 4);");
    expect(css).toContain("margin-top: calc(var(--spacing) * 2);");
    // canonical order: margin before padding, like the real compiler
    expect(css.indexOf("margin-top")).toBeLessThan(css.indexOf("padding-inline"));
    expect(css).not.toContain("@apply");
  });

  it("nests variant-bearing utilities on &", () => {
    const { css } = expand(`.btn { @apply hover:underline md:flex; }`);
    expect(css).toContain("&:hover");
    expect(css).toContain("text-decoration-line: underline;");
    // md: wraps a & rule in its media query, nested in the author's rule
    expect(css).toMatch(/@media[^{]*48rem[^{]*\{\s*& \{\s*display: flex;/);
  });

  it("honors the important flag per utility", () => {
    const { css } = expand(`.btn { @apply bg-red-500!; }`);
    expect(css).toContain("background-color: var(--color-red-500) !important;");
  });

  it("expands inside nested rules and grouping at-rules", () => {
    const { css } = expand(
      `@media (min-width: 40rem) { .card { @apply underline; } }`,
    );
    expect(css).toContain("text-decoration-line: underline;");
    const kf = `@keyframes spin2 { to { transform: rotate(360deg); } }`;
    expect(expand(kf).css).toBe(kf);
  });

  it("reports unknown utilities and leaves a comment", () => {
    const { css, unknown } = expand(`.btn { @apply bg-nope-500 px-2; }`);
    expect(unknown).toEqual(["bg-nope-500"]);
    expect(css).toContain("unknown @apply utility: bg-nope-500");
    expect(css).toContain("padding-inline: calc(var(--spacing) * 2);");
  });

  it("hoists @property registrations once", () => {
    const { css } = expand(`.a { @apply shadow-md; } .b { @apply shadow-lg; }`);
    const first = css.indexOf("@property --tw-shadow {");
    expect(first).toBeGreaterThan(-1);
    expect(css.indexOf("@property --tw-shadow {", first + 1)).toBe(-1);
  });

  it("does not touch @apply-like text outside rules or in strings", () => {
    const input = `.x { content: "@apply px-4"; }`;
    expect(expand(input).css).toBe(input);
  });
});
