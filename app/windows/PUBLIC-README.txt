ReadAloud public WAV edition
===========================

1. Check the ZIP's SHA256 against SHA256SUMS.txt on the release page:
       Get-FileHash .\ReadAloud-windows-<version>-public-wav.zip -Algorithm SHA256
2. Extract the whole ZIP to a new folder. Close any older ReadAloud server window.
3. Double-click ReadAloud.cmd and keep its window open. It opens Microsoft Edge
   at http://127.0.0.1:4173/ and serves only this PC. No Node.js installation needed.
4. Add a document or import audio. USER-GUIDE.md has the complete instructions.

This edition reads documents, prepares local narration, exports WAV with chapters,
plays existing WAV/MP3/M4A/M4B and other device-supported audio, imports chapter
timing JSON and supports text-linked book transfers, notes and proofreading.
It does NOT create MP3/M4A/M4B: their added software encoders are excluded while
redistribution requirements remain unresolved. They are not fetched at runtime.

NEW whole-book WAV exports contain chapters automatically: import one audio file.
OLDER unmarked audio: keep the existing WAV/MP3, open its already-prepared book,
choose Save chapter timings for older audio, copy the small JSON to the phone,
select the matching audio and Import chapter-time map. Each book needs its own
matching JSON. This does not generate speech or require a new WAV download.

Use the same browser/profile/address to retain your existing library. InPrivate
and the hosted website have separate storage. Do NOT clear browser data to update.
Keep source documents, audio, matching timing JSON and app-created transfers as
backups. Uninstalling/clearing storage can erase saved narration. Library Export
JSON alone is not a complete audio backup.

Included local voice assets are verified against their manifest. They remove a
first-use voice download, not the time needed to generate new speech. Prepare
before travelling, preferably on Windows; do not interact while driving.

Whole-book WAV must remain below 4 GiB. Device storage/codec limits still apply.
No publication upload or distributor acceptance is included. Only narrate and
share material you have rights to use. This is free software; see LICENSE.txt,
THIRD-PARTY-NOTICES.txt, and app/licences for notices and known provenance limits.
