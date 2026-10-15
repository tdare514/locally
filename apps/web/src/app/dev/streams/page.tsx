import { notFound } from "next/navigation";
import StreamsPrototype from "../../../components/dev/streams/StreamsPrototype";
import {
  COVER_IDS,
  parsePeriod,
  parseSort,
  parseTab,
  parseVariant,
} from "../../../components/dev/streams/sample-data";
import { isDemo } from "../../../server/demo";
import { getDemoCover } from "../../../server/demo/covers";

/**
 * Design prototype for #145: three directions for a Streams page, for the owner to pick from.
 * Dev only, sample data only. `?v=a|b|c` picks the direction, `?tab=tracks|albums|artists` the
 * group; `?period=` and `?sort=` set the starting period and sort (used for screenshots).
 * Production builds (which includes the desktop app) and the public demo (LOCALLY_DEMO=1)
 * answer 404.
 */
export default async function StreamsPrototypePage({ searchParams }: PageProps<"/dev/streams">) {
  if (process.env.NODE_ENV === "production" || isDemo()) notFound();

  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const variant = parseVariant(first(params.v));

  // The demo library's drawn SVG covers, as data URIs (the cover API reads from disk outside the demo).
  const covers: Record<string, string> = {};
  for (const id of COVER_IDS) {
    const svg = getDemoCover(id);
    if (svg) covers[id] = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  return (
    <StreamsPrototype
      key={variant}
      variant={variant}
      initialTab={parseTab(first(params.tab))}
      initialSort={parseSort(first(params.sort))}
      initialPeriod={parsePeriod(first(params.period))}
      covers={covers}
    />
  );
}
