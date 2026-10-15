import { notFound } from "next/navigation";
import SidebarPrototype from "../../../components/dev/sidebar/SidebarPrototype";
import { COVER_IDS, parsePanelStart } from "../../../components/dev/sidebar/sample-data";
import { isDemo } from "../../../server/demo";
import { getDemoCover } from "../../../server/demo/covers";

/**
 * Design prototype for #154: the floating sidebar, "Rail + bloom" (the owner's pick of three).
 * Dev only. `?state=closed|open|pinned` forces the starting state (used for screenshots).
 * Production builds (which includes the desktop app) and the public demo (LOCALLY_DEMO=1) answer 404.
 */
export default async function SidebarPrototypePage({ searchParams }: PageProps<"/dev/sidebar">) {
  if (process.env.NODE_ENV === "production" || isDemo()) notFound();

  const params = await searchParams;
  const state = Array.isArray(params.state) ? params.state[0] : params.state;

  // The demo library's drawn SVG covers, as data URIs (the cover API reads from disk outside the demo).
  const covers: Record<string, string> = {};
  for (const id of COVER_IDS) {
    const svg = getDemoCover(id);
    if (svg) covers[id] = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  return <SidebarPrototype start={parsePanelStart(state)} covers={covers} />;
}
