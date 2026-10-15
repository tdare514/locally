import type { Metadata } from "next";
import { notFound } from "next/navigation";
import StreamsPrototype from "../../../components/dev/streams/StreamsPrototype";
import {
  COVER_IDS,
  parsePeriod,
  parseSort,
  parseTab,
  parseView,
} from "../../../components/dev/streams/sample-data";
import { isDemo } from "../../../server/demo";
import { getDemoCover } from "../../../server/demo/covers";

export const metadata: Metadata = { title: "Stats" };

/**
 * Design prototype for #145: the Stats page, on sample data, dev only. Served at /dev/streams and
 * /dev/stats (the same page). `?tab=tracks|albums|artists` picks the group, `?period=day|week|
 * month|year|all` with `?back=2` the time frame, `?view=list|grid` the layout and `?sort=` the sort
 * (used for screenshots). Production builds (which includes the desktop app) and the public demo
 * (LOCALLY_DEMO=1) answer 404.
 */
export default async function StatsPrototypePage({ searchParams }: PageProps<"/dev/streams">) {
  if (process.env.NODE_ENV === "production" || isDemo()) notFound();

  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  // The demo library's drawn SVG covers, as data URIs (the cover API reads from disk outside the demo).
  const covers: Record<string, string> = {};
  for (const id of COVER_IDS) {
    const svg = getDemoCover(id);
    if (svg) covers[id] = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  return (
    <StreamsPrototype
      initialTab={parseTab(first(params.tab))}
      initialSort={parseSort(first(params.sort))}
      initialPeriod={parsePeriod(first(params.period), first(params.back))}
      initialView={parseView(first(params.view))}
      covers={covers}
    />
  );
}
