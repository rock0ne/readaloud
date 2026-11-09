# ReadAloud

Read, listen, proofread and prepare audiobooks on Windows and Android. Import documents, use local natural voices, keep notes and correction flags, or prepare narration once and listen without waiting for speech generation between passages.

## Version and availability

This branch contains the **0.7.1 source candidate**, not a new GitHub Release or an update to the hosted website. Existing public downloads/site may be older and lack the controls below.

The candidate passed 272 automated tests and bounded developer playback checks, including a Samsung S21+ / Android 15. On 9 November 2026, the owner separately confirmed chapter playback on their **Samsung S26 after importing matching timing JSON files**. This is owner feedback, not independent certification of all S26 scenarios.

**Public binary distribution remains held** for the encoder corresponding-source/build-provenance issues in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). This source branch excludes downloaded codec bundles, model/voice archives, APKs, personal books/audio, credentials and signing keys. A source push does not clear a binary release.

## Install or update

### Windows

1. Obtain a trusted Windows ZIP for your intended version and verify its supplied SHA256 with `Get-FileHash <zip> -Algorithm SHA256`. The 0.7.1 candidate is not yet a public release.
2. Extract to a new folder. Close the older ReadAloud server window before starting this copy.
3. Double-click **ReadAloud.cmd**. It serves the app locally in Edge at `http://127.0.0.1:4173/`. Keep its server window open.
4. Use the same browser/profile/address to retain the library. Do not clear browser data to update. InPrivate uses separate temporary storage.

The built Windows package needs PowerShell and Edge, not Node.js. Its launcher uses a process-scoped execution-policy setting, not a permanent policy change, and cannot override organisation restrictions.

The [hosted web edition](https://rock0ne.github.io/readaloud/) is separate and may be older. Its library is separate from localhost. Offline packages include verified voice assets; the ordinary web/PWA edition can need a first-use download. Installing a PWA or caching the app is not a backup of your books/audio.

### Android

1. Use a trusted **signed** APK for a 64-bit ARM phone, Android 7 or later. Check its supplied checksum.
2. Install over the existing app with the **same signing key**. Do not uninstall first: that can erase books and saved narration.
3. An unsigned candidate needs signing locally before installation. The owner's release certificate SHA256 is `c5f96167fa4b6633523624bd275745a088d48ed875ff13e5104c6050475dbc0f`. A development-key test APK cannot update a release-key installation.
4. The offline candidate checks/unpacks its included voice archive locally. Allow unpacking space. Older/network editions may offer **Download natural voice** instead.
5. Allow playback notifications for media controls. If background playback stops, check Android battery restrictions; Unrestricted battery use may help.

For an already-signed update with USB debugging authorised:

```bash
adb install -r ReadAloud-<version>-signed.apk
```

Never share signing-key passwords or private keys. Only authorise trusted computers.

## Read a document

1. Choose **Add files** or **Paste text**. Supported documents: TXT, Markdown, DOCX, PDF and EPUB.
2. Open it, choose a voice/speed and press Play. Tap/click a sentence to start there. Your position is saved.
3. **Contents** navigates the book; **Aa** changes font, spacing and scroll/page layout. Search finds text or goes to a page.
4. Use continuous scrolling for uninterrupted reading, or page-by-page and page-end stops for study.

Ordinary reading generates speech as needed. For a long journey, explicitly prepare it first. Online/system voices are separate from local offline Kokoro narration.

## Prepare once, listen later

1. Open the book's **Audiobook** panel.
2. Set pronunciation and pause options before preparation, then choose Emma, Isabella, George, Heart or Michael. Existing reader voices remain available elsewhere.
3. Choose **Prepare whole audiobook**, or select a chapter and **Prepare selected chapter**.
4. Keep the app open with adequate storage/battery. Windows is recommended for the heavy work. Preparation can take hours on slower devices; included voices remove a setup download, not synthesis time.
5. You may cancel and resume: saved passages are retained, not regenerated unnecessarily.
6. Wait for readiness for the selected narrator. Changing voice, text, pronunciation or relevant reading settings can require different audio.

Prepared narration is separate from disposable speech cache. Ordinary cache pruning retains it; uninstalling, clearing app/browser storage, storage failure or **Remove saved narration** can erase it.

### Playback within the book

These are playback choices, not preparation/export operations:

- **Play entire book:** begin at the start and continue through the book.
- **Play selected chapter only:** stop at that chapter's end.
- **Continue from selected chapter:** start there and continue afterward.

**Prepared audio only** stops on a missing passage rather than silently generating it. Play after chapter-only completion repeats that chapter. Text-linked playback retains highlighting, notes, flags and position.

## Export audio

Choose **Export format**, then **Save whole book …** or **Save chapter …**. Exporting reuses saved speech. Compressed encoding takes time, but does not make the voice narrate again.

| Whole-book format | Use | Chapters in ReadAloud 0.7.1+ |
| --- | --- | --- |
| WAV | Large uncompressed editing master | Embedded ReadAloud RIFF metadata |
| MP3 | Widely playable compressed audio | Embedded ReadAloud ID3 text metadata |
| M4A | Compressed AAC | Embedded Nero markers |
| M4B | Compressed AAC audiobook | Embedded Nero markers |

**NEW whole-book exports in ALL FOUR formats carry their chapters: copy/import ONE audio file. No separate JSON or ZIP is needed.** Other players may play the audio without showing ReadAloud-specific WAV/MP3 chapters. Nero export supports up to 255 markers; arbitrary third-party metadata formats are not guaranteed.

Compressed output offers 96 or 128 kb/s. Listening speed does not alter the exported master. Edge/Chrome streams whole-book output to disk; Android uses temporary storage before its save dialog. Keep the app open until saving completes.

WAV is roughly 165 MiB/hour at 24 kHz mono; compressed speech roughly 41–55 MiB/hour. Whole-book output must remain below 4 GiB. Single-chapter WAV export has a 256 MiB limit. Free/temporary storage limits still apply.

Exports do not upload or publish. Audiobook distributors have separate rights, narration/AI-disclosure, format, credits, mastering and quality requirements. Human listening/QC and distributor acceptance remain your responsibility.

## Import and play audio directly

Use **Import audio files**, not the ZIP importer. Select the ordinary audio directly; do not ZIP it yourself. Android can also offer **Open with ReadAloud**.

Import accepts WAV, MP3, M4A, M4B, MP4 audio, AAC, Ogg, Opus and FLAC, subject to device codec support. These extra import types are not all export types. MP4 video export is not implemented. Audio-only imports have no synchronised book text, sentence highlighting or text-linked flags.

Choose **Saved audio** and use Play/Pause, seeking and listening speed. With chapters:

- **Play entire audio** starts at the beginning.
- Choose **Playback chapter**, then **Play selected audio chapter only** to stop at its end.
- **Continue audio from selected chapter** reads on through the rest.

The app saves position and speed. Chapter stops use media-event/timer precision, not sample-accurate editing. Screen-off, Bluetooth and car behaviour varies by device. Prepare/test while parked; do not operate the app while driving.

## Older downloads: keep the audio, add chapters without preparing again

**This section is ONLY for older unmarked downloads. New 0.7.1 whole-book exports do not need it. An update cannot invent chapter timings absent from an old file. You do not have to prepare the speech or download the whole WAV again.**

### Option A: use an existing matching chaptered audio copy

1. Select the old audio in **Saved audio**.
2. Choose **Use chapters from matching audio**.
3. Select the same narration's chaptered M4B (or supported chaptered WAV/MP3/M4A).
4. Confirm the **same book, narrator and edit**.

Only timings are copied into the selected library record. Neither original audio file is rewritten. Duration must match within one second; duration alone does not prove identity.

### Option B: save timings from narration already prepared in ReadAloud

1. On the device holding the prepared narration, usually Windows, open that exact book's **Audiobook** panel.
2. Keep its original narrator, pronunciation, pause and reading settings.
3. Choose **Save chapter timings for older audio**. It reads saved clip information and saves a small `…-chapter-timings.json`, not speech or another full audio file.
4. Copy that JSON to the phone along with, or after, the original audio.
5. Select the matching old audio, choose **Import chapter-time map**, select its JSON and confirm.
6. Chapter playback appears. The app retains the map internally; keep both original files as backups.

**Each book's JSON belongs with that same book's audio.** If you copy several JSON files, import each into its corresponding audio entry. JSON does not contain audio, install a voice, or transfer the book itself. An EPUB's chapter names alone do not supply audio start times.

If no prepared clips, chaptered reference or trustworthy timing map remains, the old audio still plays but boundaries cannot be recovered automatically. Changed narration/pause settings may not match an earlier export. Boundaries are never guessed.

## Transfer the book text and prepared audio together

Use this instead of audio-only import when you want text, highlighting and saved narration together:

1. In Audiobook choose **Save whole book transfer ZIP**, or **Save chapter transfer ZIP**.
2. Copy the app-created `.readaloud.zip` file(s) to the other device.
3. Choose **Import book transfer ZIP** there. Chapter transfers merge into a portable book entry; import every chapter before travelling.

Packages contain text, audio and reading settings with integrity checks, not notes, flags, API keys or the original source file. The portable entry does not overwrite an original-file import.

Both devices need 0.6.1+ for the larger-transfer path. **The old 160 MiB total cap is removed**, but ZIP32 stays below 4 GiB; individual passage/manifest and storage limits remain. A ZIP made by a file manager is not a ReadAloud transfer. Use **Import audio files** for ordinary audio.

## Pronunciation, proofreading and notes

Settings provides context-sensitive pronunciation plus a personal pronunciation list. Test a short sample first. Editing pronunciation does not change already-recorded audio: affected speech needs new clips. The displayed document is not rewritten.

Flag mistakes while listening; export corrections from **Flags** or the library. The export includes quoted sentences and chapter/paragraph context; fix the manuscript separately. Use **Notes** for sentence-linked text/drawings and Markdown export. Supported Windows pen input uses the normal input tools.

| Reader key | Action |
| --- | --- |
| Space | Play/pause |
| Left / Right | Previous/next sentence |
| R | Repeat |
| F | Flag |
| N | Flag and note |
| M | Note without a flag |
| [ / ] | Slower/faster |
| / | Search/go to page |
| Page Up / Page Down | Previous/next page |
| Esc | Close current panel/dialog |

Mobile has corresponding buttons. These shortcuts describe the document reader, not every native audio control.

## Optional AI assistant

The **AI** panel is separate from local narration. Configure your own supported Claude, ChatGPT or Gemini provider key in Settings. It can summarise/explain document scopes, answer questions and suggest corrections. Generated answers can be wrong; verify them.

Text is sent only when you explicitly request an action, directly to the selected provider under its terms. API charges may apply. Review scope/word count before a large request. Keys stay local for the selected retention period and are excluded from exports. Removing a key in the app does not revoke it at the provider.

**Copy for Claude** copies text/instructions for you to paste yourself; it does not sign in or send for you. A subscription sign-in is not an app API key. Do not send confidential material without permission.

## Storage, privacy and backups

Books, saved narration, imported audio, positions and settings live on the device (IndexedDB). There is no ReadAloud account or automatic cross-device sync. Windows serves localhost only. Explicit AI requests, model downloads in network editions and chosen online/system voices are exceptions to entirely offline use.

- Keep original documents, exported audio, timing JSON and app-created transfer ZIPs.
- Library **Export JSON** is not a replacement for backing up all prepared narration; use the purpose-built audio/transfer exports.
- Different browser profiles/addresses have separate libraries; InPrivate data may disappear when closed.
- Uninstalling, clearing storage, deleting a profile or removing saved narration can lose local data.
- **Remove selected audio copy** removes its imported copy/position, not the original file. **Remove saved narration** removes that document's retained speech, not its text/notes.
- Only narrate/transfer material you have rights to use. Never include private books, recordings or credentials in public bug reports.

## Troubleshooting and limits

| Problem | What to check |
| --- | --- |
| Pauses while speech is being generated | Prepare the whole audiobook, wait for ready, then use prepared playback. |
| Only a chapter is ready | Check narrator, scope and readiness counts; preparation/playback choices are separate. |
| Old audio has no chapter list | Use the older-audio timing recovery steps, not Prepare again. |
| Timing map rejected | Check same book/narrator/edit and original pauses; don't force a mismatched map. |
| Only ZIP files visible | Cancel and choose **Import audio files**. |
| Unsupported/damaged transfer ZIP | Use the app's unmodified transfer export, not a file-manager ZIP. Keep the original/error. |
| Android update fails | Check signing key/version; don't uninstall to force an update. |
| Screen-off playback stops | Check Android notification/battery restrictions; test safely before travel. |
| Library seems missing | Check exact browser/profile/address; don't clear storage. |
| Large export/import fails | Check free/temporary space, file/format limits and exact error; retain originals. |

Other limits: English Kokoro voices; scanned PDFs need OCR elsewhere; DRM EPUBs cannot be read. Document limits (ordinary files up to 50 MiB, EPUB up to 500 MiB) are not the standalone-audio limits. Codec support varies. Android system-bar overlap and duplicate Open-with imported copies are known issues, not claimed fixed in 0.7.1. Chapter metadata is not proof of narration quality or universal third-party compatibility.

## Build from source

Use Node.js 22, pinned pnpm 11 and the lockfile. Downloaded codec bundles are deliberately excluded from this source branch. Stage pinned dependencies locally:

```powershell
cd app
corepack enable
pnpm install --frozen-lockfile
powershell -ExecutionPolicy Bypass -File windows/stage-media.ps1
pnpm test
pnpm build
```

Inspect the staging script first. It requires build-host network access, verifies pinned npm SHA512 and records SHA256. Generated notices use those staged packages. A local dependency fetch does not resolve the public-binary hold.

- Web output: `app/dist`. A hosted subpath needs its matching Vite `--base`.
- Offline Windows: from `app`, run `node windows/stage-voices.mjs`, then `powershell -ExecutionPolicy Bypass -File windows/package.ps1`. Voice staging fetches/checks pinned assets; packaging includes notices.
- Android: Linux/WSL, JDK 21, Android SDK platform 36, staged media dependencies, and the pinned engine/voice archive required by `app/android/build-apk.sh`. Set `JAVA_HOME`, `ANDROID_HOME`, `SHERPA_ENGINE_APK` and `READALOUD_VOICE_ZIP`, then run `bash app/android/build-apk.sh release` from the root. Sign the unsigned result locally. Do not commit keys, APKs, model archives or generated vendor bundles.
- `app/android/make-voice-zip.py` and the third-party notices describe voice provenance. Don't silently substitute assets.
- Tests cover narration, chapter metadata/maps, export bridges, transfer integrity and reader behaviour; they do not certify every device, background scenario or publication quality.

Pushing to `main` triggers GitHub Pages. This update is a source branch only: no automatic site deployment or new binary release.

## Licence and design

ReadAloud is GPL-3.0-or-later: see [LICENSE](LICENSE). Dependencies retain their licences and unresolved notes in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). A licence list alone is not a binary-distribution clearance.

Preact/TypeScript and Vite provide the UI, IndexedDB the local library, Kokoro the speech (browser ONNX or Android sherpa-onnx), and Capacitor the Android shell. `docs/` holds design/decision history. Thanks to the upstream Kokoro, sherpa-onnx, eSpeak NG, Transformers.js, ONNX Runtime, PDF.js, Mediabunny and other maintainers.
