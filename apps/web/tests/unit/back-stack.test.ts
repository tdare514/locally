import { describe, expect, it } from "vitest";
import {
  backLabel,
  canGoBack,
  clearStack,
  popEntry,
  pushEntry,
  stackAfterImport,
  type BackEntry,
  type BackStack,
  type BackView,
} from "../../src/lib/back-stack";

type Entry = BackEntry<BackView, { query: string }>;
const library: Entry = { view: { type: "library" }, scrollTop: 480, state: { query: "" } };
const stats: Entry = { view: { type: "stats" }, scrollTop: 0, state: { query: "" } };
const empty: BackStack<BackView, { query: string }> = [];

describe("back stack", () => {
  it("starts empty, so the button is hidden", () => {
    expect(canGoBack(empty)).toBe(false);
    expect(popEntry(empty)).toBeNull();
  });

  it("push keeps the previous view with its scroll and state", () => {
    const stack = pushEntry(empty, library);
    expect(canGoBack(stack)).toBe(true);
    expect(popEntry(stack)?.entry).toEqual(library);
  });

  it("pop returns the latest entry and leaves the rest", () => {
    const stack = pushEntry(pushEntry(empty, stats), library);
    const popped = popEntry(stack);
    expect(popped?.entry).toBe(library);
    expect(popped?.stack).toEqual([stats]);
  });

  it("does not mutate the stack it was given", () => {
    const stack = pushEntry(empty, library);
    pushEntry(stack, stats);
    popEntry(stack);
    expect(stack).toEqual([library]);
  });

  it("artist page to another artist's page to back keeps each page's key in order", () => {
    type ArtistView = BackView | { type: "artist"; key: string };
    const first: BackEntry<ArtistView, { query: string }> = {
      view: { type: "artist", key: "alpha" },
      scrollTop: 120,
      state: { query: "" },
    };
    const lib: BackEntry<ArtistView, { query: string }> = { view: { type: "library" }, scrollTop: 0, state: { query: "" } };
    const stack = pushEntry(pushEntry([] as BackStack<ArtistView, { query: string }>, lib), first);
    const popped = popEntry(stack);
    expect(popped?.entry.view).toEqual({ type: "artist", key: "alpha" });
    expect(popped?.entry.scrollTop).toBe(120);
    expect(popEntry(popped!.stack)?.entry.view.type).toBe("library");
  });

  it("a rail choice clears the history", () => {
    expect(canGoBack(clearStack())).toBe(false);
  });

  it("after an import the stack is just the library", () => {
    const stack = stackAfterImport(library);
    expect(stack).toEqual([library]);
    expect(popEntry(stack)?.entry.view.type).toBe("library");
  });
});

describe("backLabel", () => {
  it("names each destination", () => {
    expect(backLabel("library")).toBe("Back to Library");
    expect(backLabel("stats")).toBe("Back to Stats");
    expect(backLabel("import")).toBe("Back to Import");
    expect(backLabel("adopt")).toBe("Back to your Spotify folders");
  });

  it("names an artist page after the artist, or falls back to Back", () => {
    expect(backLabel("artist", "The Weeknd")).toBe("Back to The Weeknd");
    expect(backLabel("artist", "  ")).toBe("Back");
    expect(backLabel("artist")).toBe("Back");
  });
});
