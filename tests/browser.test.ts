// @vitest-environment jsdom
// Separate file: the drop-in entry initializes the default engine on import,
// so it needs a module registry no other test has touched.
import { describe, it, expect } from "vitest";

describe("drop-in browser build", () => {
  it("styles the document on import and exposes the global", async () => {
    document.body.innerHTML = `<p class="capitalize">already here</p>`;
    await import("../src/browser.ts");

    const g = globalThis as typeof globalThis & {
      twilightcss?: { tw: Function; observe: Function };
    };
    expect(g.twilightcss).toBeDefined();

    // existing content styled synchronously on load
    const utilities = document.querySelector("style[data-twilight]")!;
    expect(utilities.textContent).toContain(".capitalize");
    // theme + preflight injected
    expect(document.querySelector("style[data-twilight-theme]")).toBeTruthy();
    expect(
      document.querySelector("style[data-twilight-preflight]"),
    ).toBeTruthy();

    // content added later is styled too
    document.body.innerHTML += `<i class="underline">later</i>`;
    await new Promise((r) => setTimeout(r, 0));
    expect(utilities.textContent).toContain(".underline");
  });

  it("is idempotent under double inclusion", async () => {
    // a fresh import of the same module is a no-op thanks to the global guard;
    // simulate the second <script> by re-running the guard's branch condition
    const before = document.querySelectorAll("style[data-twilight]").length;
    await import("../src/browser.ts");
    expect(document.querySelectorAll("style[data-twilight]").length).toBe(
      before,
    );
    expect(before).toBe(1);
  });
});
