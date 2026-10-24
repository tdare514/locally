import { createHash } from "node:crypto";

/**
 * The fixed namespace for the ids of events the cloud sampler writes (#396). Never change it: the id of a
 * session's event is a UUID v5 under this namespace, so a retried run writes the same row.
 */
export const SAMPLER_EVENT_NAMESPACE = "6f1d5c0e-3b7a-4e0a-9a52-8c1e7d4b2f90";

/** UUID version 5 (RFC 4122 §4.3): sha1 of the namespace's bytes then the name. Node's crypto has no v5. */
export function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(ns).update(name, "utf8").digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Session starts are rounded to the second before they are hashed, so a few ms of jitter between samples can't change the id. */
const START_GRID_MS = 1000;

export function sessionEventId(userId: string, trackId: string, sessionStartMs: number): string {
  const start = Math.round(sessionStartMs / START_GRID_MS) * START_GRID_MS;
  return uuidV5(`${userId}:${trackId}:${start}`, SAMPLER_EVENT_NAMESPACE);
}
