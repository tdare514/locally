"use client";

import { useRef, useState } from "react";
import type { ImportMeta, Release, ReleaseKind } from "../shared/types";
import { importRelease, inspectFiles } from "../lib/api-client";
import Field from "./Field";
import TrackList, { type EditableTrack } from "./TrackList";
import CoverPicker from "./CoverPicker";
import { UploadCloudIcon } from "./Icons";

interface ImportViewProps {
  /** Prefill Single | Album when opened from the library empty-state CTAs. */
  initialKind?: ReleaseKind;
  onImported: (release: Release) => void;
  onToast: (kind: "success" | "error", text: string) => void;
}

interface Entry {
  /** Stable local key, assigned once when the file is added — survives reordering. */
  key: string;
  file: File;
  title: string;
}

function stripExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(0, idx) : name;
}

function segmentClass(active: boolean): string {
  return `rounded-full px-5 py-1.5 text-sm font-medium transition-colors ${
    active ? "bg-accent text-black shadow-sm" : "text-text-muted hover:text-text"
  }`;
}

export default function ImportView({
  initialKind,
  onImported,
  onToast,
}: ImportViewProps) {
  const [kind, setKind] = useState<ReleaseKind>(initialKind ?? "single");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const nextKeyRef = useRef(0);

  function newKey(): string {
    nextKeyRef.current += 1;
    return `f${nextKeyRef.current}`;
  }

  function switchKind(next: ReleaseKind) {
    if (next === kind) return;
    setKind(next);
    if (next === "single" && entries.length > 1) {
      setEntries((prev) => prev.slice(0, 1));
    }
  }

  async function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList).filter((f) => f.size > 0);
    if (incoming.length === 0) return;

    const single = kind === "single";
    const filesToUse = single ? [incoming[0]] : incoming;
    const startIndex = single ? 0 : entries.length;

    const optimistic: Entry[] = filesToUse.map((f) => ({
      key: newKey(),
      file: f,
      title: stripExtension(f.name),
    }));

    setEntries((prev) => (single ? optimistic : [...prev, ...optimistic]));

    setInspecting(true);
    try {
      const res = await inspectFiles(filesToUse);
      setEntries((prev) => {
        const next = prev.slice();
        res.files.forEach((info, i) => {
          const idx = startIndex + i;
          if (next[idx]) {
            next[idx] = {
              ...next[idx],
              title:
                (info.title && info.title.trim()) ||
                stripExtension(next[idx].file.name),
            };
          }
        });
        return next;
      });

      if (startIndex === 0) {
        const first = res.files[0];
        if (first) {
          setArtist((prev) => prev || first.artist || "");
          setTitle((prev) => prev || first.album || "");
          setYear((prev) => prev || first.year || "");
          setGenre((prev) => prev || first.genre || "");
        }
      }
    } catch (e) {
      onToast(
        "error",
        e instanceof Error ? e.message : "Failed to read file tags"
      );
    } finally {
      setInspecting(false);
    }
  }

  function handleTracksChange(tracks: EditableTrack[]) {
    setEntries((prev) => {
      const byKey = new Map(prev.map((e) => [e.key, e]));
      return tracks
        .map((t) => {
          const original = byKey.get(t.key);
          if (!original) return null;
          return { key: t.key, file: original.file, title: t.title };
        })
        .filter((e): e is Entry => e !== null);
    });
  }

  function handleRemove(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  const hasArtist = artist.trim().length > 0;
  const canSubmit = entries.length > 0 && hasArtist && !importing;

  async function handleSubmit() {
    if (!canSubmit) return;
    setImporting(true);
    try {
      const meta: ImportMeta = {
        kind,
        title: title.trim(),
        artist: artist.trim(),
        year: year.trim() || undefined,
        genre: genre.trim() || undefined,
        tracks: entries.map((e, i) => ({
          title: e.title.trim() || `Track ${i + 1}`,
          trackNumber: i + 1,
        })),
      };
      const release = await importRelease(
        meta,
        entries.map((e) => e.file),
        coverFile
      );
      onToast("success", "Imported to your library");
      onImported(release);
      setEntries([]);
      setCoverFile(null);
      setTitle("");
      setArtist("");
      setYear("");
      setGenre("");
      setKind("single");
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 pb-16">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">
          Local Library
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-[-0.02em] text-text">Import</h1>
        <p className="mt-2 text-base text-text-muted">
          Add a song or album to your Spotify library.
        </p>
      </div>

      <div className="inline-flex w-fit rounded-full bg-elevated p-1">
        <button
          type="button"
          onClick={() => switchKind("single")}
          className={segmentClass(kind === "single")}
        >
          Single
        </button>
        <button
          type="button"
          onClick={() => switchKind("album")}
          className={segmentClass(kind === "album")}
        >
          Album
        </button>
      </div>

      {/* Cover first, compact, beside title and artist so it stays in view
          while those are typed. Year and genre follow; tracks follow below. */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <CoverPicker file={coverFile} onChange={setCoverFile} presentation="compact" />
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <Field
              label="Title"
              value={title}
              onChange={setTitle}
              placeholder={kind === "single" ? "Same as track title" : "Album title"}
            />
            <Field label="Artist" value={artist} onChange={setArtist} placeholder="Artist name" />
          </div>
        </div>
        <p className="text-xs text-text-hint">Square artwork works best</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Year" value={year} onChange={setYear} placeholder="2024" />
          <Field label="Genre" value={genre} onChange={setGenre} placeholder="Genre" />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-bold text-text">Audio files</p>
        <div
          onClick={() => audioInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          role="button"
          tabIndex={0}
          className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card px-4 py-10 text-center transition-colors ${
            dragOver ? "border-accent" : "border-border-dashed"
          }`}
        >
          <UploadCloudIcon
            className={`h-[26px] w-[26px] ${dragOver ? "text-accent" : "text-text-muted"}`}
          />
          <p className="text-sm font-medium text-[#D7D7D7]">
            Drop audio files here, or click to choose
          </p>
          {kind === "single" ? (
            <p className="text-xs text-text-hint">
              Singles are one file. Switch to Album for multiple.
            </p>
          ) : (
            <p className="text-xs text-text-hint">You can select or drop multiple files.</p>
          )}
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.aiff,.aif"
            multiple={kind === "album"}
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files ?? []);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {entries.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-text">Tracks</p>
            <p className="text-xs text-text-muted">
              {inspecting
                ? "Reading tags…"
                : `${entries.length} file${entries.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <TrackList
            tracks={entries.map((e) => ({ key: e.key, title: e.title }))}
            onChange={handleTracksChange}
            onRemove={handleRemove}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-4 border-t border-border pt-6">
        <p className="text-sm text-text-dim">Your files stay on this device.</p>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="rounded-full bg-accent px-8 py-3 text-sm font-bold text-black transition-colors hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {importing ? "Importing…" : "Import to Spotify"}
        </button>
      </div>
    </div>
  );
}
