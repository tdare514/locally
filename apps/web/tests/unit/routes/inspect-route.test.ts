import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../../../src/server/container";
import type { InspectedFile } from "../../../src/server/releases/InspectService";
import { MAX_AUDIO_FILES } from "../../../src/server/http/validation";

let services: Services;

vi.mock("../../../src/server/container", () => ({
  getServices: () => services,
}));

import { POST } from "../../../src/app/api/inspect/route";

let inspectCalls: File[][];
let inspectResult: InspectedFile[];
let inspectError: Error | null;

class FakeInspectService {
  async inspect(files: File[]): Promise<InspectedFile[]> {
    inspectCalls.push(files);
    if (inspectError) throw inspectError;
    return inspectResult;
  }
}

function audioFile(name = "track.mp3", bytes = new Uint8Array([1, 2, 3])): File {
  return new File([bytes], name, { type: "audio/mpeg" });
}

function inspectRequest(form: FormData): NextRequest {
  return new NextRequest("http://localhost/api/inspect", { method: "POST", body: form });
}

function formFor(audio: File[]): FormData {
  const form = new FormData();
  for (const f of audio) form.append("audio", f);
  return form;
}

beforeEach(() => {
  inspectCalls = [];
  inspectResult = [
    {
      name: "track.mp3",
      title: "Some Title",
      artist: "Some Artist",
      album: "Some Album",
      year: "2024",
      genre: "Electronic",
      durationSec: 180.5,
      hasCover: true,
    },
  ];
  inspectError = null;
  services = { inspect: new FakeInspectService() } as unknown as Services;
});

describe("POST /api/inspect", () => {
  it("returns inspected tags for valid audio uploads", async () => {
    const file = audioFile();
    const res = await POST(inspectRequest(formFor([file])));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: InspectedFile[] };
    expect(body.files).toEqual(inspectResult);
    expect(inspectCalls).toHaveLength(1);
    expect(inspectCalls[0]).toHaveLength(1);
    expect(inspectCalls[0][0].name).toBe("track.mp3");
  });

  it("rejects a request with no audio files", async () => {
    const res = await POST(inspectRequest(formFor([])));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/at least one audio file/i);
    expect(inspectCalls).toEqual([]);
  });

  it("rejects an unsupported audio extension before calling the service", async () => {
    const res = await POST(inspectRequest(formFor([audioFile("notes.txt")])));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/unsupported audio/i);
    expect(inspectCalls).toEqual([]);
  });

  it("rejects more than MAX_AUDIO_FILES files before calling the service", async () => {
    const files = Array.from({ length: MAX_AUDIO_FILES + 1 }, (_, i) => audioFile(`secret-${i}.mp3`));
    const res = await POST(inspectRequest(formFor(files)));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/at most/i);
    expect(JSON.stringify(body)).not.toContain("secret-");
    expect(inspectCalls).toEqual([]);
  });

  it("maps an unexpected service error to a 500 without leaking internals", async () => {
    inspectError = new Error("ENOENT: /Users/someone/secret/scratch/tmp.mp3");

    const res = await POST(inspectRequest(formFor([audioFile()])));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("/Users/someone/secret");
  });
});
