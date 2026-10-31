"use client";

import { useId, type ComponentType, type ReactNode, type SVGProps } from "react";

/**
 * Mac Settings' groups (#416, C20 and C26): the iPhone Settings' structure on the neutral studio
 * backdrop. A section is a title in secondary text above one card of rows, with an optional footnote
 * under the card. The card is the quiet recipe of the 30 Oct 2026 rules: a 12 radius, a faint white
 * fill and a hairline; no blur, no tint, no glow (real glass is for floating things only). The account
 * card passes `prominent` and is a little brighter; nothing else differs.
 */

/** Hairline above every child but the first. The offset is where it starts: 0 for a block, past the tile for a row. */
const DIVIDER =
  "relative [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:h-px [&:not(:first-child)]:before:bg-white/[0.06]";

export function SettingsSection({
  title,
  titleId,
  id,
  footnote,
  prominent = false,
  disabled,
  children,
}: {
  title: string;
  /** Id of the title, for tests and `aria-labelledby`; one is made when it is left out. */
  titleId?: string;
  /** Id of the section, for a link that scrolls to it. */
  id?: string;
  /** A 12 line under the card. */
  footnote?: ReactNode;
  /** The account card: a little brighter than the rest. */
  prominent?: boolean;
  /** Passing it makes the card a `fieldset`, so the demo can turn off every control inside it at once. */
  disabled?: boolean;
  children: ReactNode;
}) {
  const madeId = useId();
  const headingId = titleId ?? madeId;
  const cardClass = `m-0 flex min-w-0 flex-col rounded-xl border border-white/[0.08] p-0 ${
    prominent ? "bg-white/[0.08]" : "bg-white/[0.06]"
  }`;
  return (
    <section id={id} aria-labelledby={headingId}>
      <p id={headingId} className="mb-2.5 px-1.5 text-[13px] font-semibold text-text-muted">
        {title}
      </p>
      {disabled === undefined ? (
        <div className={cardClass}>{children}</div>
      ) : (
        <fieldset disabled={disabled} className={cardClass}>
          {children}
        </fieldset>
      )}
      {footnote && <p className="mt-2 px-1.5 text-xs text-text-muted">{footnote}</p>}
    </section>
  );
}

/** Content that isn't a row (a text field, a list, a form): it sits in the card at 16 and keeps its own controls. */
export function SettingsBlock({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`${DIVIDER} p-4 [&:not(:first-child)]:before:left-0 ${className}`}>{children}</div>
  );
}

/**
 * One row, at least 44 tall: a 32 neutral tile with its glyph at 18, the title, then a value or a
 * control on the right. A row that reports a state says it in its text; the tile never changes. The
 * hairline above it starts at the title's left edge.
 */
export function SettingsRow({
  icon: Icon,
  title,
  titleId,
  note,
  value,
  trailing,
  children,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: ReactNode;
  /** Id of the title, for a switch's `labelledBy`. */
  titleId?: string;
  /** Small text under the title, in the row. */
  note?: ReactNode;
  /** A value in secondary text, right-aligned. */
  value?: ReactNode;
  /** A control on the right (a switch, a button). */
  trailing?: ReactNode;
  /** More inside the row, under the title and note (a hidden live region, a button). */
  children?: ReactNode;
}) {
  return (
    <div className={`${DIVIDER} flex min-h-11 items-center gap-3 px-4 py-1.5 [&:not(:first-child)]:before:left-[60px]`}>
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-elevated text-text-soft">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <span id={titleId} className="block text-sm text-text">
          {title}
        </span>
        {note}
        {children}
      </div>
      {value !== undefined && <span className="max-w-[55%] break-words text-right text-sm text-text-muted">{value}</span>}
      {trailing && <div className="-my-1.5 flex shrink-0 items-center gap-2">{trailing}</div>}
    </div>
  );
}
