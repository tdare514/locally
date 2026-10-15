"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Period, WidgetKey } from "./sample-data";

/** Prototype-only widget state: which period, and which widgets are switched on. The shelf starts
 * off. At least one widget always stays on: the last one cannot be switched off. */
export function useStats() {
  const [period, setPeriod] = useState<Period>("week");
  const [enabled, setEnabled] = useState<Record<WidgetKey, boolean>>({
    shelf: false,
    tracks: true,
    albums: true,
    artists: true,
  });
  const toggle = (key: WidgetKey) =>
    setEnabled((prev) => {
      const onCount = Object.values(prev).filter(Boolean).length;
      if (prev[key] && onCount === 1) return prev;
      return { ...prev, [key]: !prev[key] };
    });
  return { period, setPeriod, enabled, toggle };
}

/** Cover data URIs by demo release id, built on the server from src/server/demo/covers. */
const CoverContext = createContext<Record<string, string>>({});

export function CoverProvider({
  covers,
  children,
}: {
  covers: Record<string, string>;
  children: ReactNode;
}) {
  return <CoverContext.Provider value={covers}>{children}</CoverContext.Provider>;
}

export function useCovers(): Record<string, string> {
  return useContext(CoverContext);
}
