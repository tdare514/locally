"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createShare, getShareGroups, getShareOptions, putShareGroups } from "../lib/api-client";
import { copyToClipboard } from "../lib/clipboard";
import {
  LINK_ON_COPY,
  LINK_SHOWN_ONCE,
  NOT_ON_LOCALLY,
  RESHARE_OFF_COPY,
  SIGN_IN_TO_SHARE,
  addEmails,
  addGroup,
  sharedHeading,
  showLinkOption,
  shareErrorCopy,
} from "../lib/share-copy";
import { MAX_SHARE_GROUPS, type CreateShareResponse, type ShareGroup } from "../shared/shares";
import { ShareIcon, XIcon } from "./Icons";

interface ShareControlProps {
  releaseId: string;
  /** The name in the popover's heading: the release's, or the one track's. */
  name: string;
  /** Just these tracks; absent shares the whole release. */
  trackIds?: string[];
  /** "bar": the release bar's Share word, popover opening upward. "row": a track row's icon button, opening downward. */
  variant: "bar" | "row";
  signedIn: boolean;
  /** Opens Settings at the sync account section (when signed out). */
  onSignIn: () => void;
}

type Expiry = null | 7 | 30;

/** The Share button and its popover (#182): People (emails as pills, saved groups), Link (only when the
 * service has public links on), Let them share it on, Expires, and Share. After a reply the popover shows
 * "Shared with N people", the emails that are not on Locally, and a returned link (shown only once). */
export default function ShareControl({ releaseId, name, trackIds, variant, signedIn, onSignIn }: ShareControlProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogId = useId();
  const headingId = useId();

  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [groups, setGroups] = useState<ShareGroup[]>([]);
  const [namingGroup, setNamingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [publicEnabled, setPublicEnabled] = useState(false);
  const [link, setLink] = useState(false);
  const [reshare, setReshare] = useState(false);
  const [expiry, setExpiry] = useState<Expiry>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateShareResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  // Opens upward from the bar, and from a row with more room above than below.
  const [up, setUp] = useState(variant === "bar");

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  /** Opening starts a fresh form. */
  function toggle() {
    if (!open) {
      const rect = buttonRef.current?.getBoundingClientRect();
      setUp(variant === "bar" || (rect ? rect.top > window.innerHeight - rect.bottom : false));
      setEmails([]);
      setDraft("");
      setEmailError(null);
      setNamingGroup(false);
      setLink(false);
      setReshare(false);
      setExpiry(null);
      setError(null);
      setResult(null);
      setCopied(false);
      setNote("");
    }
    setOpen(!open);
  }

  // On open: the saved groups, and whether the service has public links on.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getShareGroups()
      .then((g) => !cancelled && setGroups(g))
      .catch(() => undefined);
    getShareOptions()
      .then((o) => !cancelled && setPublicEnabled(o.publicSharesEnabled))
      .catch(() => !cancelled && setPublicEnabled(false));
    inputRef.current?.focus({ preventScroll: true });
    popRef.current?.scrollIntoView({ block: "nearest" });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close(true);
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target || wrapRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, close]);

  // Tab out of the popover (either end) closes it; focus goes where the browser sends it.
  function onFocusOut(e: React.FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget as Node | null;
    if (next && !wrapRef.current?.contains(next)) setOpen(false);
  }

  /** Turns the typed text into pills. False (with a message) when a token is not an email. */
  function commitDraft(): string[] | null {
    if (draft.trim() === "") return emails;
    const added = addEmails(emails, draft);
    setEmails(added.emails);
    if (added.invalid) {
      setDraft(added.invalid);
      setEmailError(`${added.invalid} doesn't look like an email address`);
      return null;
    }
    setDraft("");
    setEmailError(added.full ? "You can share with up to 50 people at a time" : null);
    return added.emails;
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      if (draft.trim() === "") {
        if (e.key !== "Enter") e.preventDefault();
        return;
      }
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Backspace" && draft === "" && emails.length > 0) {
      setEmails(emails.slice(0, -1));
    }
  }

  function removeEmail(email: string) {
    setEmails(emails.filter((e) => e !== email));
    inputRef.current?.focus();
  }

  async function saveGroups(next: ShareGroup[]) {
    try {
      setGroups(await putShareGroups(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the group");
    }
  }

  async function saveGroup() {
    const groupLabel = groupName.trim();
    if (!groupLabel || emails.length === 0) return;
    if (groups.length >= MAX_SHARE_GROUPS) {
      setError("You can keep up to 30 groups");
      return;
    }
    await saveGroups([...groups, { id: crypto.randomUUID(), name: groupLabel, emails }]);
    setNamingGroup(false);
    setGroupName("");
    setNote(`Saved the group ${groupLabel}`);
  }

  async function submit() {
    const all = commitDraft();
    if (!all) return;
    if (all.length === 0 && !link) {
      setError("Add someone, or turn on the link");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const reply = await createShare({
        releaseId,
        ...(trackIds ? { trackIds } : {}),
        recipients: all,
        visibility: link ? "public" : "private",
        allowReshare: reshare,
        expiresInDays: expiry,
      });
      setResult(reply);
      const missing = reply.notOnLocally.length;
      setNote(`${sharedHeading(reply)}${missing > 0 ? `. ${missing} not on Locally yet.` : ""}`);
    } catch (e) {
      setError(shareErrorCopy(e instanceof Error ? e.message : "Couldn't share it"));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!result?.link) return;
    const ok = await copyToClipboard(result.link);
    setCopied(ok);
    setNote(ok ? "Link copied" : "Couldn't copy the link");
  }

  if (!signedIn) {
    return variant === "bar" ? (
      <button type="button" onClick={onSignIn} className="btn-ink">
        <span className="btn-ink-label">{SIGN_IN_TO_SHARE}</span>
      </button>
    ) : (
      <button
        type="button"
        data-share-button
        onClick={onSignIn}
        aria-label={`${SIGN_IN_TO_SHARE}: ${name}`}
        title={SIGN_IN_TO_SHARE}
        className="btn-icon share-row-button text-text-muted"
      >
        <ShareIcon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div ref={wrapRef} className="relative shrink-0" onBlur={onFocusOut}>
      {variant === "bar" ? (
        <button
          ref={buttonRef}
          type="button"
          data-share-button
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          onClick={toggle}
          className="btn-ink"
        >
          <span className="btn-ink-label">Share</span>
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          data-share-button
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          aria-label={`Share ${name}`}
          title="Share"
          onClick={toggle}
          className="btn-icon share-row-button text-text-muted"
        >
          <ShareIcon className="h-4 w-4" />
        </button>
      )}
      {open && (
        <div
          ref={popRef}
          id={dialogId}
          role="dialog"
          aria-labelledby={headingId}
          // The track list starts a drag from a bare press; a press in here is not one.
          onPointerDown={(e) => e.stopPropagation()}
          style={{ transformOrigin: up ? "bottom right" : "top right" }}
          className={`share-pop playlist-pop glass-fake glass-frost absolute right-0 z-40 isolate w-[360px] max-w-[calc(100vw-2rem)] cursor-default rounded-[22px] p-4 text-left ${
            up ? "bottom-full mb-3" : "top-full mt-1"
          }`}
        >
          <h2 id={headingId} className="mb-3 truncate text-[15px] font-semibold text-text">
            {result ? sharedHeading(result) : `Share ${name}`}
          </h2>
          <div role="status" className="sr-only">
            {note}
          </div>

          {result ? (
            <ShareResult result={result} copied={copied} onCopy={copyLink} onDone={() => close(true)} />
          ) : (
            <div className="flex flex-col gap-4">
              <section aria-labelledby={`${dialogId}-people`} className="flex flex-col gap-2">
                <h3 id={`${dialogId}-people`} className="text-[13px] font-semibold text-text">
                  People
                </h3>
                <div
                  className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl bg-black/30 px-2 py-1.5 ring-1 ring-white/10 focus-within:ring-2 focus-within:ring-accent"
                  onClick={() => inputRef.current?.focus()}
                >
                  {emails.map((email) => (
                    <span
                      key={email}
                      className="flex max-w-full items-center gap-1 rounded-full bg-white/10 py-0.5 pl-2.5 pr-0.5 text-[13px] text-text"
                    >
                      <span className="truncate">{email}</span>
                      <button
                        type="button"
                        onClick={() => removeEmail(email)}
                        aria-label={`Remove ${email}`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-muted outline-none hover:bg-white/10 hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    ref={inputRef}
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Add people by email"
                    aria-invalid={emailError ? true : undefined}
                    aria-describedby={emailError ? `${dialogId}-email-error` : undefined}
                    value={draft}
                    placeholder={emails.length === 0 ? "Email address" : ""}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      if (emailError) setEmailError(null);
                    }}
                    onKeyDown={onInputKeyDown}
                    onBlur={() => {
                      if (draft.trim() !== "") commitDraft();
                    }}
                    className="min-w-[8ch] flex-1 bg-transparent py-1 text-sm text-text outline-none placeholder:text-white/50"
                  />
                </div>
                {emailError && (
                  <p id={`${dialogId}-email-error`} role="alert" className="text-[13px] text-danger">
                    {emailError}
                  </p>
                )}
                {groups.length > 0 && (
                  <ul aria-label="Saved groups" className="flex flex-wrap gap-1.5">
                    {groups.map((g) => (
                      <li
                        key={g.id}
                        className="flex items-center rounded-full bg-white/[0.07] pl-0.5 ring-1 ring-white/10"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setEmails(addGroup(emails, g.emails));
                            setNote(`Added ${g.name}`);
                          }}
                          aria-label={`Add ${g.name}, ${g.emails.length} ${g.emails.length === 1 ? "person" : "people"}`}
                          className="min-h-6 rounded-full px-2.5 py-0.5 text-[13px] text-text outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {g.name}
                          <span className="text-text-muted"> {g.emails.length}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => saveGroups(groups.filter((x) => x.id !== g.id))}
                          aria-label={`Delete the group ${g.name}`}
                          className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <XIcon className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {emails.length > 0 &&
                  (namingGroup ? (
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveGroup();
                      }}
                    >
                      <input
                        type="text"
                        autoFocus
                        aria-label="Group name"
                        maxLength={40}
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        placeholder="Group name"
                        className="min-w-0 flex-1 rounded-lg bg-black/30 px-2.5 py-1.5 text-sm text-text outline-none ring-1 ring-white/10 placeholder:text-white/50 focus:ring-2 focus:ring-accent"
                      />
                      <button type="submit" disabled={groupName.trim() === ""} className="btn-save btn-save-compact">
                        Save
                      </button>
                      <button type="button" onClick={() => setNamingGroup(false)} className="btn-ink">
                        <span className="btn-ink-label">Cancel</span>
                      </button>
                    </form>
                  ) : (
                    <button type="button" onClick={() => setNamingGroup(true)} className="btn-ink self-start">
                      <span className="btn-ink-label">Save these people as a group</span>
                    </button>
                  ))}
              </section>

              {showLinkOption(publicEnabled) && (
                <Option
                  id={`${dialogId}-link`}
                  label="Link"
                  on={link}
                  onChange={setLink}
                  hint={link ? LINK_ON_COPY : undefined}
                />
              )}
              <Option
                id={`${dialogId}-reshare`}
                label="Let them share it on"
                on={reshare}
                onChange={setReshare}
                hint={reshare ? undefined : RESHARE_OFF_COPY}
              />
              <div className="flex items-center justify-between gap-3">
                <span id={`${dialogId}-expires`} className="text-[13px] font-semibold text-text">
                  Expires
                </span>
                <div role="group" aria-labelledby={`${dialogId}-expires`} className="btn-seg btn-seg-3">
                  <span aria-hidden className="btn-seg-dot">
                    <span />
                  </span>
                  {(
                    [
                      { value: null, label: "Never" },
                      { value: 7, label: "7 days" },
                      { value: 30, label: "30 days" },
                    ] as const
                  ).map(({ value, label }) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={expiry === value}
                      onClick={() => setExpiry(value)}
                      className="btn-seg-opt"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <p role="alert" className="text-[13px] text-danger">
                  {error}
                </p>
              )}
              <div className="flex justify-end">
                <button type="button" onClick={submit} disabled={busy} className="btn-save btn-save-lit">
                  {busy ? "Sharing…" : "Share"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A switch row in the popover: the label, an On/Off switch (the Settings pill), and a quiet line under it. */
function Option({
  id,
  label,
  on,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span id={id} className="text-[13px] font-semibold text-text">
          {label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={id}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onClick={() => onChange(!on)}
          className={`min-h-6 rounded-full px-4 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none ${
            on ? "bg-accent text-black" : "bg-elevated-hover text-text-muted hover:text-text"
          }`}
        >
          {on ? "On" : "Off"}
        </button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-[13px] leading-snug text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** What came back: who it reached, who is not on Locally yet, and a link, shown only this once. */
function ShareResult({
  result,
  copied,
  onCopy,
  onDone,
}: {
  result: CreateShareResponse;
  copied: boolean;
  onCopy: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {result.share === null && result.notOnLocally.length > 0 && (
        <p className="text-[13px] leading-snug text-text-muted">
          Nobody on that list has Locally yet, so nothing was shared.
        </p>
      )}
      {result.share && result.share.recipients.length > 0 && (
        <ul aria-label="Shared with" className="flex flex-col gap-1">
          {result.share.recipients.map((r) => (
            <li key={r.email} className="truncate text-sm text-text">
              {r.email}
            </li>
          ))}
        </ul>
      )}
      {result.notOnLocally.length > 0 && (
        <ul aria-label={NOT_ON_LOCALLY} className="flex flex-col gap-1">
          {result.notOnLocally.map((email) => (
            <li key={email} className="flex flex-col text-sm">
              <span className="truncate text-text">{email}</span>
              <span className="text-[13px] text-text-muted">{NOT_ON_LOCALLY}</span>
            </li>
          ))}
        </ul>
      )}
      {result.link && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <input
              readOnly
              aria-label="Share link"
              value={result.link}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg bg-black/30 px-2.5 py-1.5 text-sm text-text outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-accent"
            />
            <button type="button" onClick={onCopy} className="btn-save btn-save-compact">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-[13px] leading-snug text-text-muted">{LINK_SHOWN_ONCE}</p>
        </div>
      )}
      <div className="flex justify-end">
        <button type="button" onClick={onDone} className="btn-save btn-save-lit">
          Done
        </button>
      </div>
    </div>
  );
}
