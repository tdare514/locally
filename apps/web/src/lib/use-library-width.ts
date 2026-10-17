"use client";

import { useCallback, useEffect, useState } from "react";
import { loadLibraryWidth, saveLibraryWidth, type LibraryWidth } from "./library-view-prefs";

/** The library width setting (#207), read by every Mac page that follows it: the library, the release
 * page, Import, Stats, Settings and the Spotify folder review (#294). Starts at "full" and loads the
 * saved choice after mount so the server and first client render agree. `setWidth` saves it. */
export function useLibraryWidth(): [LibraryWidth, (next: LibraryWidth) => void] {
  const [width, setWidthState] = useState<LibraryWidth>("full");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidthState(loadLibraryWidth());
  }, []);

  const setWidth = useCallback((next: LibraryWidth) => {
    setWidthState(next);
    saveLibraryWidth(next);
  }, []);

  return [width, setWidth];
}
