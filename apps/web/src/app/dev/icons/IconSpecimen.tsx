"use client";

import type { ComponentType, SVGProps } from "react";
import {
  ChevronRightIcon,
  CopyIcon,
  CoverGridIcon,
  LibraryIcon,
  ListViewIcon,
  NextTrackIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  PreviousTrackIcon,
  SearchIcon,
  SettingsIcon,
  SortIcon,
  XIcon,
} from "../../../components/Icons";

/** Sheet of the shared glyph set (#412): the same drawings the iPhone ships as `Icon/` assets
 * (its gallery's `icons-set` frame shows them there). Each glyph at 24 px and 20 px. */

type Glyph = { name: string; Icon: ComponentType<SVGProps<SVGSVGElement>> };

const SHARED: Glyph[] = [
  { name: "Settings", Icon: SettingsIcon },
  { name: "Play", Icon: PlayIcon },
  { name: "Pause", Icon: PauseIcon },
  { name: "Next", Icon: NextTrackIcon },
  { name: "Previous", Icon: PreviousTrackIcon },
  { name: "Grid", Icon: CoverGridIcon },
  { name: "List", Icon: ListViewIcon },
  { name: "Sort", Icon: SortIcon },
];

// The iPhone also draws Stats and Person; the Mac has no such glyph.
const ALSO: Glyph[] = [
  { name: "Library", Icon: LibraryIcon },
  { name: "Plus", Icon: PlusIcon },
  { name: "Chevron", Icon: ChevronRightIcon },
  { name: "X", Icon: XIcon },
  { name: "Pencil", Icon: PencilIcon },
  { name: "Search", Icon: SearchIcon },
  { name: "Copy", Icon: CopyIcon },
];

function Eyebrow({ children }: { children: string }) {
  return <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent">{children}</p>;
}

function Grid({ glyphs }: { glyphs: Glyph[] }) {
  return (
    <ul className="mt-4 grid grid-cols-4 gap-6">
      {glyphs.map(({ name, Icon }) => (
        <li key={name} className="flex flex-col items-center gap-3 rounded-[12px] bg-elevated p-4">
          <div className="flex items-center gap-4 text-text">
            <Icon className="h-6 w-6" />
            <Icon className="h-5 w-5" />
          </div>
          <span className="text-sm text-text-muted">{name}</span>
        </li>
      ))}
    </ul>
  );
}

export default function IconSpecimen() {
  return (
    <main className="min-h-screen bg-bg p-8 text-text">
      <Eyebrow>Shared glyphs</Eyebrow>
      <Grid glyphs={SHARED} />
      <div className="mt-10">
        <Eyebrow>Also drawn</Eyebrow>
        <Grid glyphs={ALSO} />
      </div>
    </main>
  );
}
