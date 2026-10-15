import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isDemo } from "../../../server/demo";
import ImportPrototype, {
  type Stage,
  type Variant,
} from "../../../components/dev/import/ImportPrototype";

/**
 * Design prototype for #159, dev only: three cover beats for an immersive "make a record"
 * Import. Nothing here is wired to the real import. It 404s in any production build (including
 * the desktop app) and in the public demo (LOCALLY_DEMO=1).
 *
 *   /dev/import?v=1|2|3            variant (default 1)
 *   &stage=invite|empty|beat|done  where to open (default invite)
 *   &t=<ms>                        freeze animations that many ms into their run (frame capture)
 *   &c=0|1|2                       which sample cover the beat uses
 *   &bar=0                         hide the prototype bar (always hidden when t is set)
 */
export const metadata: Metadata = {
  title: "Import prototype (#159)",
  robots: { index: false },
};

const STAGES: Stage[] = ["invite", "empty", "beat", "done"];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ImportPrototypePage({ searchParams }: PageProps<"/dev/import">) {
  if (process.env.NODE_ENV === "production" || isDemo()) notFound();

  const params = await searchParams;
  const v = Number(first(params.v));
  const variant: Variant = v === 2 || v === 3 ? v : 1;
  const stageParam = first(params.stage);
  const stage = STAGES.find((s) => s === stageParam) ?? "invite";
  const tParam = first(params.t);
  const t = tParam !== undefined && tParam !== "" && Number.isFinite(Number(tParam)) ? Math.max(0, Number(tParam)) : null;
  const c = Number(first(params.c));
  const coverIndex = c === 1 || c === 2 ? c : 0;

  return (
    <ImportPrototype
      variant={variant}
      stage={stage}
      t={t}
      coverIndex={coverIndex}
      bar={t === null && first(params.bar) !== "0"}
    />
  );
}
