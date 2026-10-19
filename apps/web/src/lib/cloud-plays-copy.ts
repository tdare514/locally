/**
 * The words for "Count plays when this Mac is off" (#307), as a pure function of the status so
 * Settings shows each state and the tests can pin them. Sentence case.
 */
import type { CloudPlaysStatus } from "../shared/types";

export const CLOUD_PLAYS_LABEL = "Count plays when this Mac is off";

export type CloudPlaysState = "off" | "pending" | "linked" | "reconnect" | "notOnTesterList" | "rateLimited";

export interface CloudPlaysLines {
  state: CloudPlaysState;
  /** The switch reads on while pending, linked or in trouble: the owner turned it on. */
  on: boolean;
  line: string;
  /** A second quiet line, only when counting runs. */
  quiet: string | null;
  /** True when the Reconnect button shows. */
  reconnect: boolean;
}

/** "1 min ago", "3 hours ago", "2 days ago"; "just now" under a minute. */
export function relativeChecked(iso: string | null, nowMs: number): string {
  if (!iso) return "Not checked yet";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Not checked yet";
  const mins = Math.max(0, Math.floor((nowMs - t) / 60_000));
  if (mins < 1) return "Last checked just now";
  if (mins < 60) return `Last checked ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Last checked ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `Last checked ${days} ${days === 1 ? "day" : "days"} ago`;
}

export function cloudPlaysLines(status: CloudPlaysStatus, nowMs: number): CloudPlaysLines {
  if (status.pending) {
    return { state: "pending", on: true, line: "Finish linking in your browser…", quiet: null, reconnect: false };
  }
  if (!status.linked) {
    return {
      state: "off",
      on: false,
      line: "Counts your plays on any device, even while this Mac sleeps.",
      quiet: null,
      reconnect: false,
    };
  }
  switch (status.problem) {
    case "reconnect":
      return { state: "reconnect", on: true, line: "Online counting needs you to reconnect Spotify.", quiet: null, reconnect: true };
    case "notOnTesterList":
      return {
        state: "notOnTesterList",
        on: true,
        line: "This Spotify account isn't on the app's tester list.",
        quiet: null,
        reconnect: false,
      };
    case "rateLimited":
      return {
        state: "rateLimited",
        on: true,
        line: "Spotify is busy; counting resumes in a few minutes.",
        quiet: null,
        reconnect: false,
      };
    default:
      return {
        state: "linked",
        on: true,
        line: `Counted online, even when this Mac is off. ${relativeChecked(status.lastSampleAt, nowMs)}.`,
        quiet: "A track skipped in its first minute may not count.",
        reconnect: false,
      };
  }
}
