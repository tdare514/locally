import { describe, expect, it, vi } from "vitest";
import { NOW_PLAYING_SCRIPT, OsascriptNowPlaying, type ExecFn } from "../../src/server/plays/OsascriptNowPlaying";

function fake(impl: () => Promise<{ stdout: string; stderr: string }>) {
  const exec = vi.fn<ExecFn>(impl);
  return { exec, np: new OsascriptNowPlaying(exec) };
}

describe("OsascriptNowPlaying", () => {
  it("runs one fixed osascript call with an argument array and a timeout", async () => {
    const { exec, np } = fake(async () => ({ stdout: '{"running":false}\n', stderr: "" }));
    await np.read();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith("/usr/bin/osascript", ["-l", "JavaScript", "-e", NOW_PLAYING_SCRIPT], {
      timeout: 4000,
    });
  });

  it("reads running:false", async () => {
    const { np } = fake(async () => ({ stdout: '{"running":false}\n', stderr: "" }));
    expect(await np.read()).toEqual({ running: false });
  });

  it("reads a playing sample", async () => {
    const out = JSON.stringify({
      running: true,
      state: "playing",
      positionSec: 12.5,
      id: "spotify:local:A:B:C:200",
      durationMs: 200000,
    });
    const { np } = fake(async () => ({ stdout: out + "\n", stderr: "" }));
    expect(await np.read()).toEqual({
      running: true,
      state: "playing",
      id: "spotify:local:A:B:C:200",
      positionSec: 12.5,
      durationMs: 200000,
    });
  });

  it("treats a missing id as no current track", async () => {
    const { np } = fake(async () => ({ stdout: '{"running":true,"state":"stopped","positionSec":0}', stderr: "" }));
    expect(await np.read()).toMatchObject({ running: true, id: null });
  });

  it("maps -1743 to permission-denied", async () => {
    const { np } = fake(async () => {
      throw Object.assign(new Error("Command failed"), { stderr: "execution error: Not authorized to send Apple events to Spotify. (-1743)" });
    });
    expect(await np.read()).toEqual({ error: "permission-denied" });
  });

  it("maps garbage output and other errors to failed", async () => {
    expect(await fake(async () => ({ stdout: "nope", stderr: "" })).np.read()).toEqual({ error: "failed" });
    expect(
      await fake(async () => {
        throw new Error("timed out");
      }).np.read(),
    ).toEqual({ error: "failed" });
  });
});
