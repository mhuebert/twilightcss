// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createEngine } from "../src/dom.ts";
import { tw } from "../src/index.ts";

describe("createEngine", () => {
  it("injects CSS synchronously on ensure()", () => {
    const engine = createEngine();
    engine.ensure("flex px-4");
    const el = document.querySelector("style[data-twilight]")!;
    expect(el.textContent).toContain(".flex {");
    expect(el.textContent).toContain(
      "padding-inline: calc(var(--spacing) * 4)",
    );
  });

  it("is idempotent per token", () => {
    const engine = createEngine();
    engine.ensure("flex");
    const before = document.querySelector("style[data-twilight]")!.textContent;
    engine.ensure("flex");
    expect(document.querySelector("style[data-twilight]")!.textContent).toBe(
      before,
    );
  });

  it("tracks unmatched tokens, exempting group/peer markers", () => {
    const engine = createEngine();
    engine.ensure("group peer nonsense-token-xyz flex");
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
    engine.ensure("hover:bg-red-500/50 md:flex");
    const css = document.querySelector("style[data-twilight]")!.textContent!;
    expect(css).toContain("@media (hover: hover)");
    expect(css).toContain(
      "color-mix(in oklab, var(--color-red-500) 50%, transparent)",
    );
    expect(css).toContain("@media (width >= 48rem)");
  });
});

describe("tw", () => {
  it("joins and returns class names synchronously with CSS present", () => {
    const joined = tw("flex", false && "hidden", "gap-2");
    expect(joined).toBe("flex gap-2");
    const els = [...document.querySelectorAll("style[data-twilight]")];
    expect(els.some((el) => el.textContent!.includes(".gap-2"))).toBe(true);
  });
});
