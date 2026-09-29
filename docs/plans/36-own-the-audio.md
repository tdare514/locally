# Users must own the audio they sync (#36)

## Summary

ADR 0004 locks one clause. Before anyone else can sign up, the terms must say the
user may upload only audio they have the rights to: they must own the audio, or
otherwise have the right to upload it.

A later implementation issue shows that sentence at sign-up on web and iOS and
requires an acknowledgement. Sign-ups stay closed until the owner opens them.
This document is the plan for that later issue.

## What the later issue builds

Show the ADR sentence, in that product wording, on the signed-out sync form,
before the app requests an email code. The person acknowledges it with a checkbox
or an equivalent control. "Send code" stays disabled until they do.

- Web: the signed-out block in `apps/web/src/components/SettingsView.tsx` (Email,
  then "Send code").
- iOS: the signed-out content of `SyncSettingsSection`, with the sentence and the
  control label in `Copy.Sync` (`apps/ios/Locally/Resources/Copy.swift`). The
  button is `Copy.Sync.sendCode`.

The acknowledgement is local UI state for that sign-in attempt. It is not a new
field on `POST /v1/auth/code` or `POST /v1/auth/verify`, and it is not stored on
the account. `spec/sync.md` stays as it is. A stored consent record would say
something new about what the service keeps, and the privacy text is still open.

Once a privacy-policy URL exists, both clients link it next to the clause. Until
that URL is decided, the form shows the rights sentence and the acknowledgement,
with no link and no placeholder address.

The same form is how an existing account adds a device. The clause is on that
form too, so every sign-in sees the same sentence.

## Still open

Leave these as owner decisions. The implementation issue does not pick an answer:

- the privacy-policy URL and the full privacy text (what is stored, where, deletion)
- a takedown contact
- whether the existing 30-day unused-blob cleanup is the retention policy
- whether first sign-ups are invite-only

## Out of scope

For this plan's implementation issue, and for the docs change that records the
decision:

- writing the legal pages (a terms page or a privacy policy)
- the App Store privacy policy URL
- an invite list, or any other server-side sign-up gate
- changing retention or the cleanup cron
- opening sign-ups (Resend domain, `MAIL_FROM`, or the sandbox sender limit)

## Contract, compatibility, security

No contract change. Old and new clients talk to the same auth routes. The
acknowledgement never leaves the device, so a build from before this issue can
still complete email-code sign-in. The gate is the copy on the new clients, and
the owner still decides when sign-ups open.

No new server check on upload contents. The API continues to store the audio a
signed-in user sends.

## Affected components

- `apps/web`: `SettingsView.tsx` signed-out sync section only. No new route.
- `apps/ios`: `SyncSettingsSection.swift` and `Copy.Sync`. No sync-engine or
  Keychain change.
- `apps/api` and `spec/sync.md`: unchanged.

## Tests

- Web: "Send code" stays disabled until the acknowledgement is on, then the
  existing send-code path runs. Temp dirs only; no live sync service.
- iOS: the same on the signed-out section, with the sentence asserted from
  `Copy.Sync`. Fakes only; no network.
