/**
 * True when the app was launched by the macOS login item, so it should start without a window.
 * `wasOpenedAtLogin` is the documented macOS field in Electron 44 (electron.d.ts); it is not deprecated.
 */
export function shouldStartHidden(login: { wasOpenedAtLogin?: boolean }): boolean {
  return login.wasOpenedAtLogin === true;
}

/**
 * One GET /api/sync/status so the server builds its services (sync timer, play tracker) even with
 * no window open. Best effort: resolves true on an answer below 500, false otherwise; never throws.
 */
export async function startServices(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  onError: (message: string) => void = () => {}
): Promise<boolean> {
  try {
    const res = await fetchImpl(new URL("/api/sync/status", baseUrl), { cache: "no-store" });
    await res.arrayBuffer();
    return res.status < 500;
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
    return false;
  }
}
