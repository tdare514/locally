import { describe, expect, it } from "vitest";
import {
  COPIED_LABEL,
  COPY_LABEL,
  MAC_SUPPORTS_MULTISELECT,
  PLAYLIST_FALLBACK,
  playlistSteps,
} from "../../src/lib/playlist-copy";

describe("playlist-copy", () => {
  it("gives the per-track steps for the non-multiselect flow", () => {
    expect(playlistSteps("Rumours", 11, false)).toBe(
      "Open Spotify, then Your Library, then Local Files. On the first track, right-click, Add to playlist, New playlist, paste the name. For each other track: right-click, Add to playlist, Rumours."
    );
  });

  it("gives the multiselect steps when enabled", () => {
    expect(playlistSteps("Rumours", 11, true)).toBe(
      "Open Spotify, then Your Library, then Local Files. Command-click these 11 tracks. Right-click, Add to playlist, New playlist. Paste the name."
    );
  });

  it("defaults the multiselect flag to MAC_SUPPORTS_MULTISELECT", () => {
    expect(playlistSteps("X", 2)).toBe(playlistSteps("X", 2, MAC_SUPPORTS_MULTISELECT));
  });

  it("has the exact fallback and copy-button strings", () => {
    expect(PLAYLIST_FALLBACK).toBe("If Add to playlist is missing, update Spotify and open it again.");
    expect(COPY_LABEL).toBe("Copy");
    expect(COPIED_LABEL).toBe("Copied");
  });
});
