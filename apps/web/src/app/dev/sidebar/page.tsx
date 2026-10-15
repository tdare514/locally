import { notFound } from "next/navigation";
import SidebarPrototype, { type VariantNumber } from "../../../components/dev/sidebar/SidebarPrototype";
import { COVER_IDS, parsePanelStart } from "../../../components/dev/sidebar/sample-data";
import { isDemo } from "../../../server/demo";
import { getDemoCover } from "../../../server/demo/covers";

/**
 * Design prototype for #154: three floating-sidebar variants, for the owner to pick from.
 * Dev only. `?v=1|2|3` picks the variant; `?state=closed|open|pinned` forces the starting state
 * (used for screenshots). Production builds (which includes the desktop app) and the public demo
 * (LOCALLY_DEMO=1) answer 404.
 */
export default async function SidebarPrototypePage({ searchParams }: PageProps<"/dev/sidebar">) {
  if (process.env.NODE_ENV === "production" || isDemo()) notFound();

  const params = await searchParams;
  const v = Array.isArray(params.v) ? params.v[0] : params.v;
  const state = Array.isArray(params.state) ? params.state[0] : params.state;
  const variant: VariantNumber = v === "2" ? 2 : v === "3" ? 3 : 1;

  // The demo library's drawn SVG covers, as data URIs (the cover API reads from disk outside the demo).
  const covers: Record<string, string> = {};
  for (const id of COVER_IDS) {
    const svg = getDemoCover(id);
    if (svg) covers[id] = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  return <SidebarPrototype variant={variant} start={parsePanelStart(state)} covers={covers} />;
}
