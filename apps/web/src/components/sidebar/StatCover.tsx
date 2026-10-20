import { coverUrl } from "../../lib/api-client";
import type { StatCover as StatCoverRef } from "../../lib/play-stats";
import NoCover from "../NoCover";

/** The URL of a stat's cover, or null when its release has none. */
export function statCoverUrl(cover: StatCoverRef | null): string | null {
  return cover ? coverUrl(cover.releaseId, cover.updatedAt) : null;
}

/** A small cover for a list row: the release's cover, round for artists, or the double note on the
 * card square when the release has none. */
export default function StatCover({
  cover,
  round,
  className,
}: {
  cover: StatCoverRef | null;
  round: boolean;
  className: string;
}) {
  const src = statCoverUrl(cover);
  const shape = round ? "rounded-full" : "rounded-md";
  if (!src) {
    return <NoCover className={`shrink-0 ${shape} ${className}`} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- local cover route, no optimisation needed
    <img src={src} alt="" loading="lazy" decoding="async" className={`shrink-0 object-cover ${shape} ${className}`} />
  );
}
