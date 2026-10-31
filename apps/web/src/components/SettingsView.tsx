"use client";

import { useEffect, useState } from "react";
import type { CloudPlaysStatus, PlaysStatus, SpotifyConnectionStatus, SyncStatus } from "../shared/types";
import { DEFAULT_SYNC_BASE_URL } from "../shared/types";
import { BRAND_FOLDER_NAME } from "../shared/brand";
import {
  deleteSyncAccount,
  disconnectSpotify,
  getCloudPlays,
  getPlaysStatus,
  putCountOtherDevices,
  getSettings,
  getSpotifyConnection,
  getSpotifySource,
  putSettings,
  putSyncBaseUrl,
  putTrackPlays,
  requestSyncCode,
  reveal,
  signOutSync,
  startCloudPlays,
  startSpotifyAuth,
  stopCloudPlays,
  syncNow,
  verifySyncCode,
} from "../lib/api-client";
import { CLOUD_PLAYS_LABEL, cloudPlaysAnnouncement, cloudPlaysLines } from "../lib/cloud-plays-copy";
import { watchCloudPlays } from "../lib/cloud-plays-refresh";
import { libraryWidthClass } from "../lib/library-view-prefs";
import { useLibraryWidth } from "../lib/use-library-width";
import { IS_DEMO } from "../lib/demo";
import AmbientBackdrop from "./AmbientBackdrop";
import Field from "./Field";
import {
  CalendarIcon,
  CloudDownIcon,
  LibraryIcon,
  MusicNoteIcon,
  NowPlayingIcon,
  PlayIcon,
  SettingsIcon,
  UploadCloudIcon,
} from "./Icons";
import KnobSwitch from "./KnobSwitch";
import LibraryMoveControl from "./LibraryMoveControl";
import { SettingsBlock, SettingsRow, SettingsSection } from "./SettingsGroup";
import SpotifyFoldersCard from "./SpotifyFoldersCard";
import { HAS_SPOTIFY_CONNECTION } from "./sidebar/flags";

interface SettingsViewProps {
  onToast: (kind: "success" | "error", text: string) => void;
  syncStatus: SyncStatus | null;
  onSyncStatusChange: () => void;
  /** Scrolls this section into view once when the page opens (the sidebar profile asks for "account"). */
  section?: "account";
  /** Opens the review page for the Spotify folders and starts the check (#249). */
  onCheckSpotifyFolders: () => void;
}

/** A sign-in the app is still waiting on is dropped after this long, as the server does. */
const SPOTIFY_POLL_MS = 2_000;
const SPOTIFY_GIVE_UP_MS = 10 * 60_000;

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

/** "Count plays when this Mac is off" (#307): the same switch row as "Count plays on my other devices". */
function CloudPlaysRow({
  status,
  busy,
  onToggle,
  onReconnect,
}: {
  status: CloudPlaysStatus;
  busy: boolean;
  onToggle: () => void;
  onReconnect: () => void;
}) {
  // The clock only moves on a timer, so "Last checked" ages while the page is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const lines = cloudPlaysLines(status, now);
  // Announce state changes only: the first state is silent, and the clock never reaches the region.
  const [seen, setSeen] = useState(lines.state);
  const [announced, setAnnounced] = useState("");
  if (seen !== lines.state) {
    setSeen(lines.state);
    setAnnounced(cloudPlaysAnnouncement(lines.state));
  }
  return (
    <SettingsRow
      icon={CloudDownIcon}
      title={CLOUD_PLAYS_LABEL}
      titleId="cloud-plays-label"
      note={
        <>
          <p id="cloud-plays-help" className="text-xs text-text-muted">
            {lines.line}
          </p>
          {lines.quiet && <p className="text-xs text-text-muted">{lines.quiet}</p>}
        </>
      }
      trailing={
        <KnobSwitch
          checked={lines.on}
          onChange={onToggle}
          disabled={busy}
          labelledBy="cloud-plays-label"
          describedBy="cloud-plays-help"
        />
      }
    >
      {lines.reconnect && (
        <button type="button" onClick={onReconnect} disabled={busy} className="btn-ink -ml-3">
          Reconnect
        </button>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announced}
      </p>
    </SettingsRow>
  );
}

import SharedByYou from "./SharedByYou";

export default function SettingsView({ onToast, syncStatus, onSyncStatusChange, section, onCheckSpotifyFolders }: SettingsViewProps) {
  const [libraryDir, setLibraryDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [libraryWidth, changeLibraryWidth] = useLibraryWidth();

  // Opened from the sidebar profile: bring the account and sync section to the top, once.
  useEffect(() => {
    if (section === "account") document.getElementById("account")?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [section]);

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

  const [trackPlays, setTrackPlays] = useState(false);
  const [savingTrackPlays, setSavingTrackPlays] = useState(false);
  const [playsStatus, setPlaysStatus] = useState<PlaysStatus>("off");
  const [countOtherDevices, setCountOtherDevices] = useState(false);
  const [savingOtherDevices, setSavingOtherDevices] = useState(false);
  const [playsSource, setPlaysSource] = useState<"account" | "this-mac" | "online">("this-mac");
  const [playsFallingBack, setPlaysFallingBack] = useState(false);

  // While counting is on: read the tracker status now, after toggling, and every 10 s.
  useEffect(() => {
    if (!trackPlays || IS_DEMO) return;
    let cancelled = false;
    const refresh = () => {
      getPlaysStatus()
        .then((r) => {
          if (cancelled) return;
          setPlaysStatus(r.status);
          setPlaysSource(r.source);
          setPlaysFallingBack(r.fallingBack);
        })
        .catch(() => {
          // Status line is a nice-to-have; keep the last known value.
        });
    };
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [trackPlays, countOtherDevices]);

  // The Spotify connection (#239). null: not loaded yet, or this build doesn't offer it (row hidden).
  const [spotify, setSpotify] = useState<SpotifyConnectionStatus | null>(null);
  const [spotifyBusy, setSpotifyBusy] = useState(false);
  const [spotifyAuthorizeUrl, setSpotifyAuthorizeUrl] = useState<string | null>(null);
  const [spotifyStartError, setSpotifyStartError] = useState<string | null>(null);
  const spotifyPending = spotify?.pending === true;

  useEffect(() => {
    if (IS_DEMO || !HAS_SPOTIFY_CONNECTION) return;
    let cancelled = false;
    getSpotifyConnection()
      .then((status) => {
        if (!cancelled) setSpotify(status);
      })
      .catch(() => {
        // Optional row; stay hidden on error.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // While a sign-in is waiting: ask every 2 s, give up after 10 min, stop on unmount.
  useEffect(() => {
    if (!spotifyPending) return;
    let cancelled = false;
    const poll = () => {
      getSpotifyConnection()
        .then((status) => {
          if (!cancelled && status) setSpotify(status);
        })
        .catch(() => {
          // Keep waiting; the next tick tries again.
        });
    };
    const timer = setInterval(poll, SPOTIFY_POLL_MS);
    const giveUp = setTimeout(() => {
      clearInterval(timer);
      setSpotify((prev) => (prev ? { ...prev, pending: false } : prev));
    }, SPOTIFY_GIVE_UP_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(giveUp);
    };
  }, [spotifyPending]);

  async function handleConnectSpotify() {
    setSpotifyBusy(true);
    setSpotifyStartError(null);
    try {
      const { authorizeUrl } = await startSpotifyAuth();
      setSpotifyAuthorizeUrl(authorizeUrl);
      // Electron hands this to the system browser (its window-open handler); a browser opens a tab.
      window.open(authorizeUrl, "_blank", "noopener,noreferrer");
      setSpotify((prev) => (prev ? { ...prev, pending: true, error: null } : prev));
    } catch (e) {
      setSpotifyStartError(e instanceof Error ? e.message : "Couldn't start Spotify sign-in.");
    } finally {
      setSpotifyBusy(false);
    }
  }

  async function handleDisconnectSpotify() {
    setSpotifyBusy(true);
    setSpotifyStartError(null);
    try {
      setSpotify(await disconnectSpotify());
      setSpotifyAuthorizeUrl(null);
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Couldn't disconnect Spotify.");
    } finally {
      setSpotifyBusy(false);
    }
  }

  // Online counting (#307). null: not loaded, signed out, or the service lacks it (row hidden).
  const [cloudState, setCloud] = useState<CloudPlaysStatus | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const cloudSignedIn = syncStatus?.signedIn ?? false;
  // Signed out (or the demo): whatever was loaded is not shown.
  const cloud = cloudSignedIn && !IS_DEMO ? cloudState : null;
  const cloudPending = cloud?.pending === true;
  // Linked with no problem: the service counts every device, so the "other devices" row has nothing to add.
  const cloudActive = cloud?.available === true && cloud.linked && cloud.problem === null;

  useEffect(() => {
    if (IS_DEMO || !HAS_SPOTIFY_CONNECTION || !cloudSignedIn) return;
    let cancelled = false;
    getCloudPlays()
      .then((status) => {
        if (!cancelled) setCloud(status.available ? status : null);
      })
      .catch(() => {
        // A 404 or an error hides the row.
        if (!cancelled) setCloud(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudSignedIn]);

  // While a link is pending: ask every 2 s, give up after 10 min, stop on unmount.
  useEffect(() => {
    if (!cloudPending) return;
    let cancelled = false;
    const timer = setInterval(() => {
      getCloudPlays()
        .then((status) => {
          if (!cancelled) setCloud(status.available ? status : null);
        })
        .catch(() => {
          // Keep waiting; the next tick tries again.
        });
    }, SPOTIFY_POLL_MS);
    const giveUp = setTimeout(() => {
      clearInterval(timer);
      setCloud((prev) => (prev ? { ...prev, pending: false } : prev));
    }, SPOTIFY_GIVE_UP_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(giveUp);
    };
  }, [cloudPending]);

  // While Settings is open: re-read every 60 s and when the window comes back (after consent in the browser).
  useEffect(() => {
    if (IS_DEMO || !HAS_SPOTIFY_CONNECTION || !cloudSignedIn) return;
    let cancelled = false;
    const reread = () => {
      getCloudPlays()
        .then((status) => {
          if (!cancelled) setCloud(status.available ? status : null);
        })
        .catch(() => {
          // Keep the last answer; the next tick tries again.
        });
    };
    const stop = watchCloudPlays(reread, window, document);
    return () => {
      cancelled = true;
      stop();
    };
  }, [cloudSignedIn]);

  async function startCloudLink() {
    setCloudBusy(true);
    try {
      const { authorizeUrl } = await startCloudPlays();
      // Electron hands this to the system browser (its window-open handler); a browser opens a tab.
      window.open(authorizeUrl, "_blank", "noopener,noreferrer");
      setCloud((prev) => (prev ? { ...prev, pending: true } : prev));
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Couldn't start linking Spotify.");
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleToggleCloud() {
    if (cloud?.linked || cloud?.pending) {
      setCloudBusy(true);
      try {
        const status = await stopCloudPlays();
        setCloud(status.available ? status : null);
      } catch (e) {
        onToast("error", e instanceof Error ? e.message : "Couldn't turn off online counting.");
      } finally {
        setCloudBusy(false);
      }
      return;
    }
    await startCloudLink();
  }

  const showOtherDevicesRow = HAS_SPOTIFY_CONNECTION && spotify?.connected === true && trackPlays && !cloudActive;
  const otherDevicesOn = showOtherDevicesRow && countOtherDevices;

  async function handleToggleTrackPlays() {
    const next = !trackPlays;
    setSavingTrackPlays(true);
    try {
      const updated = await putTrackPlays(next);
      setTrackPlays(updated.trackPlays);
      if (!updated.trackPlays) setPlaysStatus("off");
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to save setting");
    } finally {
      setSavingTrackPlays(false);
    }
  }

  async function handleToggleCountOtherDevices() {
    setSavingOtherDevices(true);
    try {
      const updated = await putCountOtherDevices(!countOtherDevices);
      setCountOtherDevices(updated.countOtherDevices);
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to save setting");
    } finally {
      setSavingOtherDevices(false);
    }
  }

  useEffect(() => {
    getSettings()
      .then((s) => {
        setLibraryDir(s.libraryDir);
        setTrackPlays(s.trackPlays);
        setCountOtherDevices(s.countOtherDevices);
      })
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
    <div className={`flex flex-col gap-8 pb-16 ${libraryWidthClass(libraryWidth)}`}>
      <AmbientBackdrop palette={null} />
      <div>
        <p className="text-sm font-semibold text-accent">
          Local library
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-[-0.02em] text-text">Settings</h1>
      </div>

      {/* Two columns from lg (CSS columns), each section at its natural height, one column below. A section is
          a title, one card of rows and an optional footnote (#416), and never splits across the columns. */}
      <div className="lg:columns-2 lg:gap-x-8 [&>*]:mb-8 [&>*]:break-inside-avoid [&>*:last-child]:mb-0">
      <SettingsSection
        id="account"
        title="Account"
        prominent
        disabled={IS_DEMO}
        footnote="A library that already existed on both this Mac and your phone before you signed in is treated as two separate libraries — each side's songs sync as they are, so a song tagged on both shows up twice."
      >
        <SettingsBlock className="flex flex-col gap-2">
          <p className="text-sm text-text-muted">
            Songs you tag here show up on your phone, and songs your phone tags show up here for
            you to send to Spotify.
          </p>
          {IS_DEMO && <p className="text-sm text-text-muted">Sync isn&apos;t available in the demo.</p>}
        </SettingsBlock>

        {!signedIn && (
          <SettingsBlock className="flex flex-col gap-4">
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
                  className="btn-save w-fit"
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
                    className="btn-save w-fit"
                  >
                    {verifying ? "Signing in…" : "Sign in"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCodeSent(false);
                      setCode("");
                    }}
                    className="btn-ink"
                  >
                    Use a different email
                  </button>
                </div>
              </div>
            )}
          </SettingsBlock>
        )}

        {signedIn && syncStatus && (
          <>
            <SettingsRow icon={UploadCloudIcon} title="Signed in as" value={syncStatus.email} />
            <SettingsRow icon={SettingsIcon} title="This device" value={syncStatus.deviceName ?? "This Mac"} />
          </>
        )}
      </SettingsSection>

      <SettingsSection title="Library folder" disabled={IS_DEMO}>
        <SettingsBlock className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field
                label="Path"
                value={libraryDir}
                onChange={setLibraryDir}
                placeholder={`~/Music/${BRAND_FOLDER_NAME}`}
                disabled={loading}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || loading}
                className="btn-save"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={handleReveal}
                className="btn-ink"
              >
                Show in Finder
              </button>
            </div>
          </div>
          <LibraryMoveControl onToast={onToast} onMoved={setLibraryDir} />
        </SettingsBlock>
      </SettingsSection>

      <SpotifyFoldersCard onToast={onToast} onCheck={onCheckSpotifyFolders} />

      {signedIn && syncStatus && (
        <SettingsSection title="Sync" disabled={IS_DEMO}>
          <SettingsRow
            icon={CloudDownIcon}
            title="Storage used"
            value={
              syncStatus.quota
                ? `${formatQuota(syncStatus.quota.usedBytes)} of ${formatQuota(syncStatus.quota.limitBytes)}`
                : "—"
            }
          />
          <SettingsRow icon={CalendarIcon} title="Last synced" value={formatLastSync(syncStatus.lastRunAt)} />
          <SettingsBlock className="flex flex-col gap-4">
            {syncStatus.lastError && (
              <p className="text-xs text-danger">{syncStatus.lastError}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSyncNow}
                disabled={syncing}
                className="btn-save w-fit"
              >
                {syncing ? "Syncing…" : "Sync now"}
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="btn-ink"
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>

            {confirmingDeleteAccount ? (
              <div className="flex flex-col gap-2 rounded-xl border border-danger/40 bg-danger/5 p-4">
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
                    className="btn-danger"
                  >
                    {deletingAccount ? "Deleting…" : "Delete account"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteAccount(false)}
                    disabled={deletingAccount}
                    className="btn-ink"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleDeleteAccount}
                className="btn-ink-danger w-fit"
              >
                Delete sync account…
              </button>
            )}
          </SettingsBlock>
        </SettingsSection>
      )}

      {signedIn && !IS_DEMO && <SharedByYou onToast={onToast} />}

      <SettingsSection title="Library">
        <SettingsRow
          icon={LibraryIcon}
          title="Library width"
          titleId="library-width-label"
          trailing={
            <div role="group" aria-labelledby="library-width-label" className="btn-seg">
              <span aria-hidden className="btn-seg-dot">
                <span />
              </span>
              {(
                [
                  { value: "full", label: "Full width" },
                  { value: "comfortable", label: "Comfortable" },
                ] as const
              ).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => changeLibraryWidth(value)}
                  aria-pressed={libraryWidth === value}
                  className="btn-seg-opt"
                >
                  {label}
                </button>
              ))}
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection title="Connect to Spotify">
        <SettingsBlock className="flex flex-col gap-3">
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
        </SettingsBlock>
      </SettingsSection>

      {spotify && (
        <SettingsSection
          title="Spotify"
          footnote={
            spotify.connected ? (
              <>
                To remove Locally&apos;s access completely, remove it in your{" "}
                <a
                  href="https://www.spotify.com/account/apps/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Spotify account
                </a>
                .
              </>
            ) : spotifyPending ? (
              spotifyAuthorizeUrl && (
                <>
                  Nothing opened?{" "}
                  <a href={spotifyAuthorizeUrl} target="_blank" rel="noopener noreferrer" className="underline">
                    Open the Spotify sign-in page
                  </a>
                  .
                </>
              )
            ) : (
              "Read-only: Locally can see your playlists and what is playing. It can't change anything."
            )
          }
        >
          {spotify.connected ? (
            <SettingsRow
              icon={MusicNoteIcon}
              title={<>Connected as {spotify.displayName}</>}
              trailing={
                <button
                  type="button"
                  onClick={handleDisconnectSpotify}
                  disabled={spotifyBusy}
                  className="btn-ink"
                >
                  Disconnect
                </button>
              }
            />
          ) : spotifyPending ? (
            <SettingsRow
              icon={MusicNoteIcon}
              title="Waiting for Spotify in your browser…"
              trailing={
                <button
                  type="button"
                  onClick={handleDisconnectSpotify}
                  disabled={spotifyBusy}
                  className="btn-ink"
                >
                  Cancel
                </button>
              }
            />
          ) : (
            <SettingsRow
              icon={MusicNoteIcon}
              title="Not connected on this Mac"
              trailing={
                <button
                  type="button"
                  onClick={handleConnectSpotify}
                  disabled={spotifyBusy}
                  className="btn-save"
                >
                  Connect Spotify
                </button>
              }
            />
          )}
          {cloud && <CloudPlaysRow status={cloud} busy={cloudBusy} onToggle={handleToggleCloud} onReconnect={startCloudLink} />}
          {(spotifyStartError || spotify.error) && (
            <SettingsBlock>
              <p className="text-sm text-danger">{spotifyStartError ?? spotify.error}</p>
            </SettingsBlock>
          )}
        </SettingsSection>
      )}

      <SettingsSection
        title="Plays"
        disabled={IS_DEMO}
        footnote={
          cloudActive
            ? "Counts a Locally track once it has played 30 seconds in Spotify or in Locally on this Mac, or in Spotify on any of your devices, even when this Mac is off."
            : otherDevicesOn
            ? "Counts a Locally track once it has played 30 seconds in Spotify or in Locally on this Mac, or in Spotify on any of your devices."
            : showOtherDevicesRow
              ? "Counts a Locally track once it has played 30 seconds in Spotify or in Locally on this Mac, or in Spotify on another device while Spotify is open here."
              : "Counts a Locally track once it has played 30 seconds in Spotify or in Locally on this Mac, and plays on your other devices while Spotify is open here."
        }
      >
        <SettingsRow
          icon={PlayIcon}
          title="Count my plays"
          titleId="track-plays-label"
          trailing={
            <KnobSwitch
              checked={trackPlays}
              onChange={handleToggleTrackPlays}
              disabled={loading || savingTrackPlays}
              labelledBy="track-plays-label"
            />
          }
        />
        {showOtherDevicesRow && (
          <SettingsRow
            icon={NowPlayingIcon}
            title="Count plays on my other devices"
            titleId="count-other-devices-label"
            note={
              <p className="text-xs text-text-muted">
                Counts what you play on your phone and other computers through your Spotify account, while
                Locally is running on this Mac and the Mac is awake. Plays while the Mac sleeps aren&apos;t counted.
              </p>
            }
            trailing={
              <KnobSwitch
                checked={countOtherDevices}
                onChange={handleToggleCountOtherDevices}
                disabled={loading || savingOtherDevices}
                labelledBy="count-other-devices-label"
              />
            }
          />
        )}
        {trackPlays && playsStatus === "spotify-not-running" && playsSource === "this-mac" && (
          <SettingsBlock>
            <p className="text-sm text-text-muted">Spotify isn&apos;t running.</p>
          </SettingsBlock>
        )}
        {trackPlays && playsFallingBack && (
          <SettingsBlock>
            <p className="text-sm text-text-muted">
              Can&apos;t reach your Spotify account right now, so only this Mac&apos;s plays count until it&apos;s back.
            </p>
          </SettingsBlock>
        )}
        {trackPlays && playsStatus === "permission-denied" && (
          <SettingsBlock>
            <p className="text-sm text-danger">
              Locally isn&apos;t allowed to see what Spotify is playing. Allow it in System Settings ▸ Privacy &amp; Security ▸ Automation.
            </p>
          </SettingsBlock>
        )}
      </SettingsSection>

      <SettingsSection title="About">
        <SettingsBlock className="flex flex-col gap-2 text-sm text-text-muted">
          <p>
            Spotify caches local-file metadata. After editing an existing track here,{" "}
            <strong className="text-text">restart Spotify</strong> to see the changes.
          </p>
          <p>
            Non-mp3 files are converted to 320&nbsp;kbps mp3 on import, because Spotify&apos;s
            Local Files only reads mp3 (and mp4/m4a) files.
          </p>
        </SettingsBlock>
      </SettingsSection>
      </div>
    </div>
  );
}
