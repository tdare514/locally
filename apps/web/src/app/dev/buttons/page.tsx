import { notFound } from "next/navigation";
import { isDemo } from "../../../server/demo";
import ButtonSpecimen from "./ButtonSpecimen";

/** Dev-only sheet of three button directions (#155). It answers 404 in every production build
 * (npm start, the desktop app, Vercel) and in the public demo (LOCALLY_DEMO=1). */
export default function ButtonsPage() {
  if (process.env.NODE_ENV === "production" || isDemo()) notFound();
  return <ButtonSpecimen />;
}
