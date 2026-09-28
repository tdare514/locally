"use client";

import { useEffect, useState } from "react";
import type { SyncStatus } from "../shared/types";
import { DEFAULT_SYNC_BASE_URL } from "../shared/types";
import {
  deleteSyncAccount,
  getSettings,
  getSpotifySource,
  putSettings,
  putSyncBaseUrl,
  requestSyncCode,
  reveal,
  signOutSync,
  syncNow,
  verifySyncCode,
} from "../lib/api-client";
import Field from "./Field";

interface SettingsViewProps {
  onToast: (kind: "success" | "error", text: string) => void;
  syncStatus: SyncStatus | null;
  onSyncStatusChange: () => void;
}

const STEPS = [
  'Open Spotify and go to Settings.',
  'Scroll to the "Library" section.',
  'Turn on "Show Local Files".',
  '"Add a source" and pick your library folder (below).',
];

function formatQuota(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function formatLastSync(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleString();
}

export default function SettingsView({ onToast, syncStatus, onSyncStatusChange }: SettingsViewProps) {
  const [libraryDir, setLibraryDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [baseUrl, setBaseUrl] = useState(DEFAULT_SYNC_BASE_URL);
  const [knownBaseUrl, setKnownBaseUrl] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmingDeleteAccount, setConfirmingDeleteAccount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [spotifyWatching, setSpotifyWatching] = useState<boolean | null>(null);

  useEffect(() => {
    getSpotifySource()
      .then((status) => setSpotifyWatching(status.watching))
      .catch(() => {
        // Nice-to-have status line; stay hidden on error.
      });
  }, []);

  useEffect(() => {
    getSettings()
      .then((s) => setLibraryDir(s.libraryDir))
      .catch((e) =>
        onToast("error", e instanceof Error ? e.message : "Failed to load settings")
      )
      .finally(() => setLoading(false));
  }, [onToast]);

  // Adjust local state during render (not in an effect) when the server's
  // idea of the base URL first arrives or changes, per React's guidance on
  // resetting state from props: https://react.dev/learn/you-might-not-need-an-effect
  if (syncStatus && !syncStatus.signedIn && syncStatus.baseUrl !== knownBaseUrl) {
    setKnownBaseUrl(syncStatus.baseUrl);
    setBaseUrl(syncStatus.baseUrl);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await putSettings(libraryDir.trim());
      setLibraryDir(updated.libraryDir);
      onToast("success", "Settings saved");
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleReveal() {
    try {
      await reveal();
      onToast("success", "Opened in Finder");
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to open Finder");
    }
  }

  async function handleBaseUrlBlur() {
    const trimmed = baseUrl.trim();
    if (!trimmed || trimmed === syncStatus?.baseUrl) return;
    try {
      await putSyncBaseUrl(trimmed);
      onSyncStatusChange();
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to save sync service URL");
    }
  }

  async function handleSendCode() {
    if (!email.trim()) return;
    setSendingCode(true);
    try {
      await requestSyncCode(email.trim());
      setCodeSent(true);
      onToast("success", "Check the sync service log for your code");
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to send code");
    } finally {
      setSendingCode(false);
    }
  }

  async function handleVerify() {
    if (!code.trim()) return;
    setVerifying(true);
    try {
      await verifySyncCode(email.trim(), code.trim());
      onToast("success", "Signed in to sync");
      setCode("");
      setCodeSent(false);
      onSyncStatusChange();
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to verify code");
    } finally {
      setVerifying(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutSync();
      onToast("success", "Signed out of sync");
      setEmail("");
      onSyncStatusChange();
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to sign out");
    } finally {
      setSigningOut(false);
    }
  }

  async function handleDeleteAccount() {
    if (!confirmingDeleteAccount) {
      setConfirmingDeleteAccount(true);
      return;
    }
    setDeletingAccount(true);
    try {
      await deleteSyncAccount();
      onToast("success", "Sync account deleted");
      setEmail("");
      setConfirmingDeleteAccount(false);
      onSyncStatusChange();
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to delete sync account");
    } finally {
      setDeletingAccount(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const status = await syncNow();
      if (status.lastError) {
        onToast("error", status.lastError);
      } else {
        onToast("success", "Synced");
      }
      onSyncStatusChange();
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const signedIn = syncStatus?.signedIn ?? false;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 pb-16">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">
          Local Library
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-[-0.02em] text-text">Settings</h1>
      </div>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <p className="text-sm font-bold text-text">Library folder</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field
              label="Path"
              value={libraryDir}
              onChange={setLibraryDir}
              placeholder="~/Music/Spotify Local Import"
              disabled={loading}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="rounded-full bg-accent px-6 py-3 text-sm font-bold text-black transition-colors hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={handleReveal}
              className="rounded-full border border-text-dim px-6 py-3 text-sm font-medium text-text transition-colors hover:border-text"
            >
              Show in Finder
            </button>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
        <div>
          <p className="text-sm font-bold text-text">Sync with your phone</p>
          <p className="mt-1 text-sm text-text-muted">
            Songs you tag here show up on your phone, and songs your phone tags show up here for
            you to send to Spotify.
          </p>
        </div>

        {!signedIn && (
          <div className="flex flex-col gap-4">
            <div className="max-w-xs">
              <Field
                label="Service URL"
                value={baseUrl}
                onChange={setBaseUrl}
                placeholder={DEFAULT_SYNC_BASE_URL}
              />
              {/* onBlur isn't a Field prop; save when the value settles via the button flow instead. */}
              <button
                type="button"
                onClick={handleBaseUrlBlur}
                className="mt-1 text-xs font-medium text-text-dim underline-offset-2 hover:text-text hover:underline"
              >
                Use this address
              </button>
            </div>

            {!codeSent ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="max-w-xs flex-1">
                  <Field
                    label="Email"
                    value={email}
                    onChange={setEmail}
                    placeholder="you@example.com"
                    type="email"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={sendingCode || !email.trim()}
                  className="w-fit rounded-full bg-accent px-6 py-3 text-sm font-bold text-black transition-colors hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {sendingCode ? "Sending…" : "Send code"}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="max-w-xs flex-1">
                  <Field
                    label="Code"
                    value={code}
                    onChange={setCode}
                    placeholder="123456"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleVerify}
                    disabled={verifying || !code.trim()}
                    className="w-fit rounded-full bg-accent px-6 py-3 text-sm font-bold text-black transition-colors hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {verifying ? "Signing in…" : "Sign in"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCodeSent(false);
                      setCode("");
                    }}
                    className="text-sm font-medium text-text-muted hover:text-text"
                  >
                    Use a different email
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {signedIn && syncStatus && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">
                  Signed in as
                </p>
                <p className="mt-1 text-sm text-text">{syncStatus.email}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">
                  This device
                </p>
                <p className="mt-1 text-sm text-text">{syncStatus.deviceName ?? "This Mac"}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">
                  Storage used
                </p>
                <p className="mt-1 text-sm text-text">
                  {syncStatus.quota
                    ? `${formatQuota(syncStatus.quota.usedBytes)} of ${formatQuota(syncStatus.quota.limitBytes)}`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">
                  Last synced
                </p>
                <p className="mt-1 text-sm text-text">{formatLastSync(syncStatus.lastRunAt)}</p>
              </div>
            </div>

            {syncStatus.lastError && (
              <p className="text-xs text-danger">{syncStatus.lastError}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSyncNow}
                disabled={syncing}
                className="w-fit rounded-full bg-accent px-6 py-3 text-sm font-bold text-black transition-colors hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {syncing ? "Syncing…" : "Sync now"}
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="w-fit rounded-full border border-text-dim px-6 py-3 text-sm font-medium text-text transition-colors hover:border-text disabled:cursor-not-allowed disabled:opacity-40"
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>

            {confirmingDeleteAccount ? (
              <div className="flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger/5 p-4">
                <p className="text-sm font-bold text-text">Delete your sync account?</p>
                <p className="text-sm text-text-muted">
                  This removes your account and every release and file Locally has stored in the
                  cloud for it. Your music on this Mac and on your iPhone stays where it is. Other
                  devices signed in to this account are signed out.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    disabled={deletingAccount}
                    className="rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {deletingAccount ? "Deleting…" : "Delete account"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteAccount(false)}
                    disabled={deletingAccount}
                    className="rounded-full px-4 py-2 text-sm text-text-muted hover:text-text"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleDeleteAccount}
                className="w-fit px-2 py-1 text-sm font-semibold text-danger transition-colors hover:opacity-80"
              >
                Delete sync account…
              </button>
            )}
          </div>
        )}

        <p className="text-xs text-text-dim">
          A library that already existed on both this Mac and your phone before you signed in is
          treated as two separate libraries — each side&apos;s songs sync as they are, so a song
          tagged on both shows up twice.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <p className="text-sm font-semibold text-text">Connect to Spotify</p>
        {spotifyWatching !== null && (
          <p className={`text-sm ${spotifyWatching ? "text-accent" : "text-text-muted"}`}>
            {spotifyWatching
              ? "Spotify is watching your library folder."
              : "Spotify isn't watching your library folder yet."}
          </p>
        )}
        <ol className="flex flex-col gap-2 text-sm text-text-muted">
          {STEPS.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-text">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-6 text-sm text-text-muted">
        <p>
          Spotify caches local-file metadata. After editing an existing track here,{" "}
          <strong className="text-text">restart Spotify</strong> to see the changes.
        </p>
        <p>
          Non-mp3 files are converted to 320&nbsp;kbps mp3 on import, because Spotify&apos;s
          Local Files only reads mp3 (and mp4/m4a) files.
        </p>
      </section>
    </div>
  );
}
