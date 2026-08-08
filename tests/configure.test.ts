// @vitest-environment jsdom
// Separate file: vitest gives each file a fresh module registry, so the
// default engine here is untouched by dom.test.ts's tw() calls.
import { describe, it, expect } from "vitest";
import { configure, tw, observe } from "../src/index.ts";
import { proseCss } from "../assets/prose.mjs";

describe("configure", () => {
  it("creates the default engine that tw()/observe() then use", async () => {
    const engine = configure({ proseCss });
    tw("prose");
    expect(document.querySelector("style[data-twilight-prose]")!.textContent)
      .toContain(".prose");
    expect(engine.tokens.has("prose")).toBe(true);

    const root = document.createElement("div");
    document.body.append(root);
    observe(root);
    root.innerHTML = `<i class="capitalize">s</i>`;
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.tokens.has("capitalize")).toBe(true);
    // one engine: exactly one utilities style element on the page
    expect(document.querySelectorAll("style[data-twilight]").length).toBe(1);
  });

  it("throws once the default engine exists", () => {
    expect(() => configure()).toThrow(/before the first/);
  });
});
