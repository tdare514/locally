# 4. Users must own the audio they sync

## Status

Accepted.

## Context

Once sign-ups open beyond the owner, the sync API stores other people's audio and
email on Vercel Blob and libSQL. Account deletion already exists (#34): a signed-in
device can remove the cloud account, and the music on the Mac and the iPhone stays.
Issue #36 still asks for a privacy policy, terms, a takedown contact, and a retention
statement before anyone else can sign up.

This record locks one clause of those terms. The follow-up for showing it is
`docs/plans/36-own-the-audio.md`.

## Decision

Before anyone else can sign up, the terms must say the user may upload only audio
they have the rights to: they must own the audio, or otherwise have the right to
upload it.

That is the clause. It is product language for the sign-up terms.

These #36 questions stay open:

- the privacy-policy URL and the full privacy text (what is stored, where, and how
  deletion works)
- a takedown contact
- whether the existing 30-day unused-blob cleanup is the retention policy
- whether first sign-ups are invite-only

## Consequences

- Sign-ups stay closed to anyone besides the owner until that clause is in the terms
  a new user sees. The plan shows the sentence at sign-up on web and iOS and asks for
  an acknowledgement there.
- The sync API keeps storing the files a signed-in user uploads. Agreeing to the
  clause is part of sign-up; the upload routes stay as they are.
- A privacy-policy link can sit beside the clause once a URL exists.
- Account deletion (#34) is unchanged. Retention, a takedown contact, and an invite
  list remain separate owner decisions.
