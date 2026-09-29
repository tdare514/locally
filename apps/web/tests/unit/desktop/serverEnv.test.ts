import { describe, expect, it } from "vitest";
import { buildServerEnv } from "../../../electron/lib/serverEnv";

// Next augments ProcessEnv so NODE_ENV is required; tests pass partial envs.
const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;

const input = { port: 4321, configDir: "/cfg", extraPathDirs: ["/opt/homebrew/bin", "/usr/local/bin"] };

describe("buildServerEnv", () => {
  it("forces HOSTNAME to loopback even when the base env says otherwise", () => {
    const out = buildServerEnv({ ...input, base: env({ HOSTNAME: "0.0.0.0" }) });
    expect(out.HOSTNAME).toBe("127.0.0.1");
  });

  it("sets port, node env and config dir", () => {
    const out = buildServerEnv({ ...input, base: env({ NODE_ENV: "development" }) });
    expect(out.PORT).toBe("4321");
    expect(out.NODE_ENV).toBe("production");
    expect(out.LOCALLY_CONFIG_DIR).toBe("/cfg");
  });

  it("sets LOCALLY_FFMPEG only when a path is given", () => {
    expect(buildServerEnv({ ...input, base: env({}) }).LOCALLY_FFMPEG).toBeUndefined();
    expect(buildServerEnv({ ...input, base: env({}), ffmpegPath: "/app/ffmpeg" }).LOCALLY_FFMPEG).toBe("/app/ffmpeg");
  });

  it("prepends extra PATH dirs once and keeps the base PATH", () => {
    const out = buildServerEnv({ ...input, base: env({ PATH: "/usr/bin:/usr/local/bin" }) });
    expect(out.PATH).toBe("/opt/homebrew/bin:/usr/bin:/usr/local/bin");
    const dup = buildServerEnv({ ...input, extraPathDirs: ["/x", "/x"], base: env({ PATH: "/usr/bin" }) });
    expect(dup.PATH).toBe("/x:/usr/bin");
  });

  it("handles a missing PATH", () => {
    expect(buildServerEnv({ ...input, base: env({}) }).PATH).toBe("/opt/homebrew/bin:/usr/local/bin");
  });

  it("does not mutate the base env", () => {
    const base = env({ PATH: "/usr/bin", HOSTNAME: "0.0.0.0" });
    buildServerEnv({ ...input, base });
    expect(base).toEqual({ PATH: "/usr/bin", HOSTNAME: "0.0.0.0" });
  });
});
