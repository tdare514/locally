import { notFound } from "next/navigation";
import { isDemo } from "../../../server/demo";
import IconSpecimen from "./IconSpecimen";

/** Dev-only sheet of the shared glyph set (#412). It answers 404 in every production build
 * (npm start, the desktop app, Vercel) and in the public demo (LOCALLY_DEMO=1). */
export default function IconsPage() {
  if (process.env.NODE_ENV === "production" || isDemo()) notFound();
  return <IconSpecimen />;
}
