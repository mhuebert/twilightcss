// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createEngine } from "../src/dom.ts";
import { tw, observe } from "../src/index.ts";

describe("createEngine", () => {
  it("injects CSS synchronously on tw()", () => {
    const engine = createEngine();
    engine.tw("flex px-4");
    const el = document.querySelector("style[data-twilight]")!;
    expect(el.textContent).toContain(".flex {");
    expect(el.textContent).toContain(
      "padding-inline: calc(var(--spacing) * 4)",
    );
  });

  it("is idempotent per token", () => {
    const engine = createEngine();
    engine.tw("flex");
    const before = document.querySelector("style[data-twilight]")!.textContent;
    engine.tw("flex");
    expect(document.querySelector("style[data-twilight]")!.textContent).toBe(
      before,
    );
  });

  it("tracks unmatched tokens, exempting group/peer markers", () => {
    const engine = createEngine();
    engine.tw("group peer nonsense-token-xyz flex");
    expect([...engine.unmatched]).toEqual(["nonsense-token-xyz"]);
  });

  it("injects theme and preflight layers in cascade order", () => {
    createEngine();
    const styles = [...document.head.querySelectorAll("style")];
    const order = (sel: string) => styles.findIndex((s) => s.hasAttribute(sel));
    expect(order("data-twilight-preflight")).toBeLessThan(
      order("data-twilight-theme"),
    );
    expect(order("data-twilight-theme")).toBeLessThan(order("data-twilight"));
    const theme = styles.find((s) => s.hasAttribute("data-twilight-theme"))!;
    expect(theme.textContent).toContain("--color-red-500");
  });

  it("supports variants end-to-end", () => {
    const engine = createEngine();
    engine.tw("hover:bg-red-500/50 md:flex");
    const css = document.querySelector("style[data-twilight]")!.textContent!;
    expect(css).toContain("@media (hover: hover)");
    expect(css).toContain(
      "color-mix(in oklab, var(--color-red-500) 50%, transparent)",
    );
    expect(css).toContain("@media (width >= 48rem)");
  });
});

describe("rule ordering", () => {
  it("keeps canonical order regardless of tw() call order", () => {
    const engine = createEngine();
    engine.tw("px-2");
    engine.tw("p-4"); // canonically BEFORE px-2 — must not append
    const css = document.querySelector("style[data-twilight]")!.textContent!;
    expect(css.indexOf(".p-4 {")).toBeGreaterThanOrEqual(0);
    expect(css.indexOf(".p-4 {")).toBeLessThan(css.indexOf(".px-2 {"));
  });

  it("puts variated rules after unvariated ones", () => {
    const engine = createEngine();
    engine.tw("hover:underline");
    engine.tw("no-underline");
    const css = document.querySelector("style[data-twilight]")!.textContent!;
    expect(css.indexOf(".no-underline {")).toBeLessThan(
      css.indexOf(".hover\\:underline"),
    );
  });
});

describe("observe", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("styles existing elements and later mutations", async () => {
    const engine = createEngine();
    const root = document.createElement("div");
    root.innerHTML = `<span class="italic">a</span>`;
    document.body.append(root);
    const stop = engine.observe(root);
    expect(engine.tokens.has("italic")).toBe(true);

    const added = document.createElement("div");
    added.innerHTML = `<b class="uppercase">b</b>`; // nested [class] under an added node
    root.append(added);
    await flush();
    expect(engine.tokens.has("uppercase")).toBe(true);

    root.firstElementChild!.setAttribute("class", "lowercase");
    await flush();
    expect(engine.tokens.has("lowercase")).toBe(true);
    stop();
  });

  it("stops styling after disconnect", async () => {
    const engine = createEngine();
    const root = document.createElement("div");
    document.body.append(root);
    engine.observe(root)();
    root.innerHTML = `<span class="overline">x</span>`;
    await flush();
    expect(engine.tokens.has("overline")).toBe(false);
  });
});

describe("tw", () => {
  it("joins and returns class names synchronously with CSS present", () => {
    const joined = tw("flex", false && "hidden", "gap-2");
    expect(joined).toBe("flex gap-2");
    const els = [...document.querySelectorAll("style[data-twilight]")];
    expect(els.some((el) => el.textContent!.includes(".gap-2"))).toBe(true);
  });

  it("top-level observe() shares tw's singleton engine", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const stop = observe(root);
    root.innerHTML = `<i class="align-middle">s</i>`;
    await new Promise((r) => setTimeout(r, 0));
    // the token landed in the SAME style stack tw() writes to — no
    // duplicate engine, no second set of style elements
    const before = document.querySelectorAll("style[data-twilight]").length;
    tw("align-middle");
    expect(document.querySelectorAll("style[data-twilight]").length).toBe(before);
    const els = [...document.querySelectorAll("style[data-twilight]")];
    expect(els.some((el) => el.textContent!.includes(".align-middle"))).toBe(true);
    stop();
  });
});

describe("prose (opt-in)", () => {
  it("injects the typography CSS once, on the first `prose` token", async () => {
    const { proseCss } = await import("../assets/prose.mjs");
    const engine = createEngine({ proseCss });
    expect(document.querySelector("style[data-twilight-prose]")!.textContent)
      .toBe("");
    engine.tw("prose max-w-none");
    const el = document.querySelector("style[data-twilight-prose]")!;
    expect(el.textContent).toContain(".prose");
    expect(el.textContent).toContain("--tw-prose-body");
    expect([...engine.unmatched]).toEqual([]);
    // cascade: prose sits above the utilities layer so utilities win
    const styles = [...document.head.querySelectorAll("style")];
    const idx = (sel: string) => styles.findIndex((s) => s.hasAttribute(sel));
    expect(idx("data-twilight-prose")).toBeLessThan(idx("data-twilight"));
  });

  it("without the option, `prose` counts as unmatched", () => {
    const engine = createEngine();
    engine.tw("prose");
    expect([...engine.unmatched]).toEqual(["prose"]);
  });
});
