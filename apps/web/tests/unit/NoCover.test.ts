import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NoCover from "../../src/components/NoCover";
import ReleaseBar, { BarConfirm } from "../../src/components/ReleaseBar";
import RecordSleeve from "../../src/components/RecordSleeve";
import CoverPicker from "../../src/components/CoverPicker";

describe("NoCover (#294)", () => {
  it("is the card square with the double note in text-dim, hidden from assistive tech", () => {
    const html = renderToStaticMarkup(createElement(NoCover, { className: "size-14 rounded" }));
    expect(html).toContain("bg-card");
    expect(html).toContain("text-text-dim");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("size-14 rounded");
    // The double note: two circles, not the single note.
    expect(html.match(/<circle/g)).toHaveLength(2);
  });
});

describe("the record's label with no art (#294)", () => {
  const render = (labelUrl: string | null) =>
    renderToStaticMarkup(createElement(RecordSleeve, { labelUrl, spin: 0 } as ComponentProps<typeof RecordSleeve>, createElement("span")));
  it("is the black label, not the accent", () => {
    expect(render(null)).toContain("record-label-bare");
    expect(render("/cover.jpg")).not.toContain("record-label-bare");
  });
});

describe("CoverPicker sleeve with no cover (#294)", () => {
  const sleeve = (readOnly?: boolean) =>
    renderToStaticMarkup(
      createElement(CoverPicker, { file: null, onChange: () => {}, presentation: "sleeve", readOnly }),
    );
  it("shows the note over Add cover and the drop line, on a dashed edge that turns accent on hover", () => {
    const html = sleeve();
    expect(html).toContain(">Add cover<");
    expect(html).not.toContain("Add cover art");
    expect(html).toContain("Drop an image or click to choose");
    expect(html).toContain("border-dashed");
    expect(html).toContain("hover:border-accent");
    expect(html.match(/<circle/g)).toHaveLength(2);
  });
});

describe("ReleaseBar (#294)", () => {
  it("lays out left, status, secondary, main in tab order, with the main action last", () => {
    const html = renderToStaticMarkup(
      createElement(ReleaseBar, {
        label: "Release actions",
        onHeight: () => {},
        left: createElement("button", null, "Delete"),
        status: "Unsaved changes",
        beforeMain: createElement("button", null, "Show in Finder"),
        main: createElement("button", { className: "btn-save btn-save-lit" }, "Save to library"),
      }),
    );
    const order = ["Delete", "Unsaved changes", "Show in Finder", "Save to library"].map((t) => html.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("min-h-[68px]");
    expect(html).toContain("rounded-[24px]");
    expect(html).toContain("bottom-6");
    // It never animates in.
    expect(html).not.toMatch(/animate|transition|imp-/);
  });
  it("puts the confirm's safe choice last, after the confirming button", () => {
    const html = renderToStaticMarkup(
      createElement(
        BarConfirm,
        { message: "Delete this release?", onCancel: () => {} } as ComponentProps<typeof BarConfirm>,
        createElement("button", null, "Confirm delete"),
      ),
    );
    expect(html.indexOf("Confirm delete")).toBeLessThan(html.indexOf("Cancel"));
  });
});
