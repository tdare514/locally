"use client";

import { useRef, useState } from "react";
import type { ImportMeta, Release, ReleaseKind } from "../lib/types";
import { importRelease, inspectFiles } from "../lib/api-client";
import Field from "./Field";
import TrackList, { type EditableTrack } from "./TrackList";
import CoverPicker from "./CoverPicker";

interface ImportViewProps {
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
  return `rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
    active ? "bg-accent text-black" : "text-text-muted hover:text-text"
  }`;
}

export default function ImportView({ onImported, onToast }: ImportViewProps) {
  const [kind, setKind] = useState<ReleaseKind>("single");
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6 pb-16">
      <h1 className="text-2xl font-bold">Import</h1>

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

      <div className="flex flex-col gap-4 sm:flex-row">
        <CoverPicker file={coverFile} onChange={setCoverFile} />
        <div className="flex flex-1 flex-col gap-3">
          <Field
            label="Title"
            value={title}
            onChange={setTitle}
            placeholder={kind === "single" ? "Same as track title" : "Album title"}
          />
          <Field label="Artist" value={artist} onChange={setArtist} placeholder="Artist name" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Year" value={year} onChange={setYear} placeholder="2024" />
            <Field label="Genre" value={genre} onChange={setGenre} placeholder="Genre" />
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-text-muted">Audio files</p>
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
          className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragOver ? "border-accent bg-elevated-hover" : "border-border bg-elevated"
          }`}
        >
          <p className="text-sm text-text">Drop audio files here, or click to choose</p>
          {kind === "single" ? (
            <p className="text-xs text-text-muted">
              Singles are one file. Switch to Album for multiple.
            </p>
          ) : (
            <p className="text-xs text-text-muted">You can select or drop multiple files.</p>
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
        <div>
          <p className="mb-2 text-sm font-medium text-text-muted">
            Tracks{inspecting ? " · reading tags…" : ""}
          </p>
          <TrackList
            tracks={entries.map((e) => ({ key: e.key, title: e.title }))}
            onChange={handleTracksChange}
            onRemove={handleRemove}
          />
        </div>
      )}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={handleSubmit}
        className="self-start rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-black transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        {importing ? "Importing…" : "Import to Spotify"}
      </button>
    </div>
  );
}
