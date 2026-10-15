"use client";

import { useEffect, useState } from "react";

/** A revocable object URL for `file`, or null when there is none. Created in an effect and revoked
 * on change or unmount, as CoverPicker does, so it holds up under StrictMode. */
export function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  return url;
}
