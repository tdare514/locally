import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Bone, Skeleton } from "../../src/components/Skeleton";

describe("Skeleton (#422)", () => {
  it("holds the place from the first frame but draws and says nothing until 300 ms have passed", () => {
    const html = renderToStaticMarkup(
      createElement(Skeleton, { label: "Loading your stats", className: "flex gap-4" }, createElement(Bone, { className: "h-4" })),
    );
    expect(html).toContain('<div aria-busy="true" class="flex gap-4 invisible">');
    expect(html).toContain('<span role="status" class="sr-only"></span>');
    expect(html).not.toContain("Loading your stats");
  });

  it("draws each block in card, hidden from assistive tech", () => {
    const html = renderToStaticMarkup(createElement(Bone, { className: "h-4 w-1/2" }));
    expect(html).toBe('<span aria-hidden="true" class="block rounded-[8px] bg-card h-4 w-1/2"></span>');
  });

  it("is not busy and draws nothing once the wait is over", () => {
    const html = renderToStaticMarkup(createElement(Skeleton, { busy: false, label: "Loading" }));
    expect(html).toBe('<span role="status" class="sr-only"></span><div class="invisible"></div>');
  });
});
