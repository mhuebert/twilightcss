// @vitest-environment jsdom
// text/tailwindcss style tags: @theme merging, late arrival, streaming.
// Uses createEngine() directly so the default engine stays untouched.
import { describe, it, expect } from "vitest";
import { createEngine } from "../src/dom.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

const userStyle = (text: string): HTMLStyleElement => {
  const el = document.createElement("style");
  el.setAttribute("type", "text/tailwindcss");
  el.textContent = text;
  return el;
};

describe("text/tailwindcss @theme", () => {
  it("a tag present at engine creation extends the theme", () => {
    document.head.append(
      userStyle(`@theme { --color-brand-500: oklch(0.7 0.15 200);
                          --breakpoint-huge: 100rem; }`),
    );
    const engine = createEngine();
    engine.tw("bg-brand-500 huge:flex");
    expect(engine.unmatched.size).toBe(0);
    const css = document.querySelector("style[data-twilight]")!.textContent!;
    expect(css).toContain("var(--color-brand-500)");
    expect(css).toContain("100rem");
    // the tag's CSS is compiled into a sibling the browser understands
    const compiled = document.querySelector("style[data-twilight-compiled]")!;
    expect(compiled.textContent).toContain(":root {");
    expect(compiled.textContent).toContain("--color-brand-500");
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("a late tag re-validates previously rejected tokens", async () => {
    const engine = createEngine();
    const stop = engine.observe(document.body);
    engine.tw("bg-late-500");
    expect(engine.unmatched.has("bg-late-500")).toBe(true);

    document.body.append(userStyle(`@theme { --color-late-500: purple; }`));
    await tick();
    expect(engine.unmatched.has("bg-late-500")).toBe(false);
    expect(
      document.querySelector("style[data-twilight]")!.textContent,
    ).toContain("var(--color-late-500)");
    stop();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("re-processes a tag whose content streams in", async () => {
    const engine = createEngine();
    const stop = engine.observe(document.body);
    const tag = userStyle(`@theme { --color-a-500: red; }`);
    document.body.append(tag);
    await tick();
    engine.tw("bg-a-500 bg-b-500");
    expect(engine.unmatched.has("bg-b-500")).toBe(true);

    tag.textContent += `@theme { --color-b-500: blue; }`;
    await tick();
    expect(engine.unmatched.has("bg-b-500")).toBe(false);
    const compiled = document.querySelector("style[data-twilight-compiled]")!;
    expect(compiled.textContent).toContain("--color-b-500");
    stop();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("expands @apply, and re-expands when a later @theme supplies the var", async () => {
    const engine = createEngine();
    const stop = engine.observe(document.body);
    document.body.append(
      userStyle(`.btn { @apply px-4 hover:bg-accent-500; }`),
    );
    await tick();
    const compiled = document.querySelector("style[data-twilight-compiled]")!;
    expect(compiled.textContent).toContain("padding-inline");
    expect(compiled.textContent).toContain("unknown @apply utility");

    document.body.append(userStyle(`@theme { --color-accent-500: teal; }`));
    await tick();
    expect(compiled.textContent).not.toContain("unknown @apply utility");
    expect(compiled.textContent).toContain("var(--color-accent-500)");
    expect(compiled.textContent).toContain("&:hover");
    stop();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });
});
