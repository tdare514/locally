import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../../../src/server/container";
import type { ImportMeta, Release } from "../../../src/shared/types";
import { ValidationError } from "../../../src/shared/errors";

let services: Services;

vi.mock("../../../src/server/container", () => ({
  getServices: () => services,
}));

import { POST } from "../../../src/app/api/import/route";

let importCalls: { meta: ImportMeta; coverFile: File | null; audioFiles: File[] }[];
let importResult: Release | (() => Release);
let importError: Error | null;

class FakeReleaseService {
  async import(meta: ImportMeta, coverFile: File | null, audioFiles: File[]): Promise<Release> {
    importCalls.push({ meta, coverFile, audioFiles });
    if (importError) throw importError;
    return typeof importResult === "function" ? (importResult as () => Release)() : importResult;
  }
}

function sampleRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: "rel-1",
    kind: "single",
    title: "My Track",
    artist: "My Artist",
    year: null,
    genre: null,
    coverPath: null,
    folderPath: "/tmp/lib/My Artist/My Track",
    tracks: [
      {
        id: "trk-1",
        title: "My Track",
        trackNumber: 1,
        filePath: "/tmp/lib/My Artist/My Track/01 - My Track.mp3",
        originalName: "in.mp3",
        durationSec: 120,
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function audioFile(name = "track.mp3", bytes = new Uint8Array([1, 2, 3])): File {
  return new File([bytes], name, { type: "audio/mpeg" });
}

function importRequest(form: FormData): NextRequest {
  return new NextRequest("http://localhost/api/import", { method: "POST", body: form });
}

function formFor(meta: unknown, audio: File[] = [audioFile()]): FormData {
  const form = new FormData();
  form.set("meta", JSON.stringify(meta));
  for (const f of audio) form.append("audio", f);
  return form;
}

beforeEach(() => {
  importCalls = [];
  importResult = sampleRelease();
  importError = null;
  services = { releases: new FakeReleaseService() } as unknown as Services;
});

describe("POST /api/import", () => {
  it("imports a valid single and returns the created release", async () => {
    const meta = { kind: "single", artist: "My Artist", tracks: [{ title: "My Track", trackNumber: 1 }] };
    const res = await POST(importRequest(formFor(meta)));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Release;
    expect(body.id).toBe("rel-1");
    expect(importCalls).toHaveLength(1);
    expect(importCalls[0].meta.artist).toBe("My Artist");
    expect(importCalls[0].audioFiles).toHaveLength(1);
    expect(importCalls[0].coverFile).toBeNull();
  });

  it("passes the cover file through when one is attached", async () => {
    const meta = { kind: "single", artist: "My Artist", tracks: [{ title: "My Track", trackNumber: 1 }] };
    const form = formFor(meta);
    const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    form.set("cover", new File([jpegHeader], "cover.jpg", { type: "image/jpeg" }));

    const res = await POST(importRequest(form));

    expect(res.status).toBe(200);
    expect(importCalls[0].coverFile?.name).toBe("cover.jpg");
  });

  it("rejects a request with no meta field (400)", async () => {
    const form = new FormData();
    form.append("audio", audioFile());
    const res = await POST(importRequest(form));

    expect(res.status).toBe(400);
    expect(importCalls).toHaveLength(0);
  });

  it("rejects invalid meta JSON that fails schema validation (400)", async () => {
    const meta = { kind: "single", artist: "", tracks: [{ title: "My Track", trackNumber: 1 }] };
    const res = await POST(importRequest(formFor(meta)));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
    expect(importCalls).toHaveLength(0);
  });

  it("rejects a request with zero audio files (400)", async () => {
    const meta = { kind: "single", artist: "My Artist", tracks: [{ title: "My Track", trackNumber: 1 }] };
    const form = new FormData();
    form.set("meta", JSON.stringify(meta));
    const res = await POST(importRequest(form));

    expect(res.status).toBe(400);
    expect(importCalls).toHaveLength(0);
  });

  it("rejects an unsupported audio file extension (400)", async () => {
    const meta = { kind: "single", artist: "My Artist", tracks: [{ title: "My Track", trackNumber: 1 }] };
    const res = await POST(importRequest(formFor(meta, [audioFile("track.exe")])));

    expect(res.status).toBe(400);
    expect(importCalls).toHaveLength(0);
  });

  it("surfaces a ValidationError thrown by the service as 400", async () => {
    importError = new ValidationError("artist name resolves outside the library directory");
    const meta = { kind: "single", artist: "My Artist", tracks: [{ title: "My Track", trackNumber: 1 }] };

    const res = await POST(importRequest(formFor(meta)));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("artist name resolves outside the library directory");
  });
});
