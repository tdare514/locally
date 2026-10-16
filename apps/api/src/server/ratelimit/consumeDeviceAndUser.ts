import { RateLimitError } from "../../shared/errors";
import type { RateLimiter } from "./RateLimiter";

/**
 * Charge one call to a per-device limiter, then to a per-user ceiling, and
 * throw `RateLimitError` if either refuses. The device is charged first and a
 * refusal there stops the call before the ceiling is touched, so one device
 * that keeps retrying cannot use up the account's allowance and starve its
 * other devices. The ceiling caps the total across devices.
 */
export async function consumeDeviceAndUser(
  limiters: { byDevice: RateLimiter; byUser: RateLimiter },
  ids: { deviceId: string; userId: string },
  message: string
): Promise<void> {
  if (!(await limiters.byDevice.consume(ids.deviceId))) throw new RateLimitError(message);
  if (!(await limiters.byUser.consume(ids.userId))) throw new RateLimitError(message);
}
