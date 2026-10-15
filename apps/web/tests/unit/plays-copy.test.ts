import { describe, expect, it } from "vitest";
import { PLAYS_ACROSS_DEVICES, playsLabel } from "../../src/lib/plays-copy";

describe("plays copy (#107)", () => {
  it("says '1 play' and 'N plays', matching the iPhone", () => {
    expect(playsLabel(1)).toBe("1 play");
    expect(playsLabel(2)).toBe("2 plays");
    expect(playsLabel(12)).toBe("12 plays");
    expect(playsLabel(1234)).toBe("1234 plays");
  });

  it("has the one line under the tracks, verbatim", () => {
    expect(PLAYS_ACROSS_DEVICES).toBe("Plays are counted across all your devices.");
  });

  it("is sentence case: no capitals beyond the first letter, no uppercase styling words", () => {
    expect(playsLabel(5)).toBe(playsLabel(5).toLowerCase());
    expect(PLAYS_ACROSS_DEVICES).not.toBe(PLAYS_ACROSS_DEVICES.toUpperCase());
  });
});
