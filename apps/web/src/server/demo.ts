import { NextResponse } from "next/server";

/**
 * Public read-only demo (#139). `LOCALLY_DEMO=1` is set only in the Vercel
 * project's env; it is off in dev, `npm start` and the desktop build.
 *
 * In demo mode nothing touches the disk, the settings store or the sync
 * service: GET routes answer from the bundled sample library in
 * `src/server/demo/`, every other API method is refused (by `src/proxy.ts`
 * first, and again by each mutating route), and `getServices()` throws so a
 * route that forgets its demo branch fails closed instead of reading the server's disk.
 */
export function isDemo(): boolean {
  return process.env.LOCALLY_DEMO === "1";
}

export const DEMO_READ_ONLY_ERROR = "Demo: read-only";

/** 403 for any write attempted against the demo. */
export function demoReadOnly(): NextResponse {
  return NextResponse.json({ error: DEMO_READ_ONLY_ERROR }, { status: 403 });
}
