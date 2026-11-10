ReadAloud for Windows
=====================

Listen to documents with natural voices and flag mistakes while you listen.
Reads .txt, .md, .docx, .pdf and .epub files, and text you paste.

Check the download first
------------------------
For this private Windows 0.8.1 candidate, the accompanying SHA256SUMS.txt shows the
SHA-256 of this zip. It has not been published as a GitHub release. Open PowerShell in
the folder that holds the zip and type (with this zip's name):

    Get-FileHash .\ReadAloud-windows-<version>.zip -Algorithm SHA256

If the two values are not exactly the same, do not open the zip: delete it.

Before using this update, export positions/flags/notes with Export JSON and
retain your original documents and audio. This UI update does not change the
0.7.3 database schema or regenerate prepared narration. Keep the same Edge
profile and localhost address to retain the library. Do not clear site data.

Start
-----
1. Unzip this folder anywhere you like, for example Documents\ReadAloud.
2. Double-click ReadAloud.cmd. A small window opens, then ReadAloud opens in
   Microsoft Edge.
3. Keep the small window open while you use ReadAloud. Close it to stop.

If Windows warns you or blocks ReadAloud
----------------------------------------
ReadAloud.cmd is not code-signed, so Windows may ask whether you want to run
it. Run it only if the SHA-256 matched.

If Windows says it has protected your PC, or your organisation blocks the file
or PowerShell, stop. Do not change any security setting. Use the web version
instead (https://rock0ne.github.io/readaloud/), or ask your IT team.

ReadAloud.cmd starts Windows PowerShell with "-ExecutionPolicy Bypass" so that
it can run serve.ps1, which came in this zip. That setting applies only to
that one PowerShell window. It changes nothing else on your PC, and it does
not override rules your organisation sets.

Install it as an app (optional)
-------------------------------
In Edge, select "App available - Install ReadAloud" in the address bar (or
Settings and more > Apps > Install this site as an app). ReadAloud then opens
from its own icon. The local server window must still be running to serve it.

What stays on this PC
---------------------
- ReadAloud runs on this PC at http://127.0.0.1:4173/. Only this PC can open
  that address. Keep using that same address: another address, such as the
  web version, has its own separate library.
- Your documents, flags, notes and settings stay in Edge on this PC.
  ReadAloud has no account and collects no usage data.

The new reader (0.8.1 Windows candidate)
----------------------------------------
Play/pause, previous/next sentence and replay now sit in the top centre.
Reading layout (top right, also in Aa Appearance) offers Scroll, One page or
Two-page spread. Spread shows consecutive pages, even over chapter boundaries,
so you can read ahead while listening. Narrow screens fall back to one page;
widen the window, close the tools panel or reduce text size to show both.
Aa Appearance chooses System/Paper/Sepia/Night, font, size and spacing.
Existing page-end pause settings remain unchanged: check Appearance if you
want continuous narration in page view. Long pages can still scroll.

Focus hides the tools, not playback or the voice's local/online status.
Use its cross or Escape to leave. Full screen is a separate browser option.
Contents, Audiobook, Flags, Notes and AI open panels only when wanted; use their
cross to close. Audiobook retains all preparation/export/chapter controls.
The thin progress line is reading position, not elapsed audio time.
USER-GUIDE.md includes the complete guide, keyboard keys and older-audio help.

This is a local candidate, not a new public release. The accompanying results
record any visual/Claude-review checks still pending. No files are uploaded.

Whole-book narration and offline travel
--------------------------------------
The library and Audiobook studio headings must show 0.8.1 for this candidate.
Downloading the zip does not replace an older server/app that is still open.
Close the old server window, run this folder's ReadAloud.cmd, then reopen/refresh
the same localhost app without clearing its library/site data.

Reader Play reads immediately. It does not require book preparation and can
reuse saved audio. Audiobook playback is separate: it only uses prepared audio
and never silently generates a missing passage. Resume saved audiobook resumes
that session; Reader Play returns to live reading. There is no global prepared-
only switch. Old saved values cannot disable live reading. Your library, notes,
audio and existing exports need no reset or new preparation.

Prepare whole audiobook and Prepare selected chapter are separate controls.
Choose the chapter in the Chapter selector for chapter-only preparation/export.
Both resume existing clips. A ready chapter can be saved before the rest of the
book is prepared; whole-book WAV stays disabled until the whole book is ready.

Open a document, choose Audiobook, select a narrator, and Prepare whole
audiobook. This may take hours for a long book. Use this Windows edition for
the heavy work, keeping the app open. Cancellation keeps completed passages.
Listen to prepared book uses saved audio across chapters, without generating
speech. Missing audio produces an error rather than another synthesis wait.

Five narrator choices are shown: Emma, Isabella, George, Heart and Michael.
They share the model included in app\voice-pack; no separate internet voice
download is needed. Existing reader voices remain available. Keep the server
window open during the first model load and narration preparation.

Save chapter WAV creates one normal-speed 24 kHz mono PCM WAV per chapter
(up to 256 MB). It does not master, add credits or publish.
Check distributor requirements and listen/QC before publication.

Export format in this private full-export candidate: WAV, MP3, M4A or M4B.
The save buttons follow your
selection for both whole book and selected chapter. MP3 and AAC encoders are
included for offline use, with no codec/voice download at export time. M4A/M4B
use AAC. Choose a 96 or 128 kb/s compressed-audio target. Encoding reuses the
prepared PCM; it does not generate speech again. MP3/M4A/M4B sound is lossy;
retain WAV when you want an uncompressed editing master.

Whole-book M4B includes Nero-style chapter markers (up to 255). Compatible
players can display them; player support varies. A selected-chapter M4B has
one marker. This is not a guarantee of Apple Books/Spotify/distributor acceptance.
Compressed output is capped below 4 GiB. Desktop saves stream with bounded
buffers; Android stages output on private temporary disk before its save dialog.
Keep the app open and use Windows for long/heavy exports.

Save whole book WAV (0.5.2) creates one continuous file from every prepared
chapter, without generating speech again. Use Windows Edge/Chrome's save dialog.
It streams to disk rather than assembling the entire book in memory. Classic WAV
must stay below 4 GiB; use chapter exports for a larger book. At 24 kHz the file
is about 165 MB per hour. Keep the app open until export finishes. The single
WAV includes ReadAloud chapter-navigation metadata; chapter WAVs remain
available. New whole-book WAV/MP3/M4A/M4B exports all include chapters.
Older audio may need a matching chapter-time JSON map, not new narration.

Save whole book transfer ZIP or Save chapter transfer ZIP creates a .readaloud.zip.
Version 0.6.1 removes the old 160 MB export/import cap and reads individual
passages rather than loading a complete transfer into one ArrayBuffer. Use
0.6.1 on both devices for large transfers. ZIP32 files remain below 4 GiB,
individual passages below 64 MiB and document manifests below 8 MiB.
Copy the ZIP to Android and choose Import prepared audio in the library.
Imported chapters merge into one book without speech generation. Text and audio
travel; notes, flags and API keys do not. Free device storage still applies.

Pronunciation (0.5.1)
---------------------
Settings > Pronunciation adds English context hints and a personal list:
    OT = O. T.
    Tunde = TOON-day
Use one literal word/phrase = spoken spelling per line. Entries are case-sensitive;
longest phrases win. This changes speech only, never the book's displayed text.
Save, then Listen to saved pronunciation to hear a short test in your chosen voice.
Rules are heuristic, not full language understanding; ambiguous words can still
need a phrase override. Disable built-ins and clear the list for original behaviour.
Changing hints stops playback and changes which clips are needed. Prepare again
and re-export affected chapters; old files are not rewritten or silently reused.
Transfers include the pronunciation list/settings, so use 0.5.1 on the phone too.
0.5.1 also accepts old 0.5.0 transfers with rules disabled to match their old audio.

Prepared narration survives normal cache pruning, but uninstalling, clearing
browser data or device failure can erase it. Keep exported copies separately.

What goes online (optional features only)
----------------------------------------
- Online voices, only if you choose one. Voices marked "online" in the voice
  list need the internet: Edge sends the text being read to Microsoft, which
  makes the speech.
- The AI assistant, only if you add a key. It is off until you add your own
  key for Claude (Anthropic), ChatGPT (OpenAI) or Gemini (Google). When you
  ask it something, ReadAloud sends that part of your document and your
  question, with your key, straight to that company. Your key stays in Edge on
  this PC for as long as you chose when you added it.

What it needs
-------------
Version 0.7.0 adds playback chapter navigation (not chapter preparation):
- Prepared book: choose Chapter, then Play entire book, Play selected chapter
  only (stop at its end), or Continue from selected chapter. Reuses saved clips.
- Imported whole audio: ReadAloud M4B exports expose their embedded Nero chapter
  markers, including already imported M4Bs (detected when selected). Choose the
  playback chapter and play only it or continue through the rest of the file.
  Bare MP3/WAV files without markers cannot supply trustworthy chapter times;
  use a marked M4B or Import chapter-time map. Boundaries are never guessed.
  Imported-file chapter stops use media-event/timer precision, not sample editing.
The standalone Android player no longer requests native audio focus after its
WebView starts; that could steal its own focus and pause playback. Its displayed
speed now tracks the actual playback rate. Phone testing is recorded separately.

Version 0.7.1 completes chapter-aware whole-book export for ALL four export
formats: WAV (ReadAloud RIFF chunk), MP3 (ReadAloud ID3 text field), M4A and
M4B (Nero chapter markers). Import the one audio file in ReadAloud 0.7.1+:
no separate map, ZIP or new narration. Other players may not display chapters.
Older unmarked downloads remain usable. Use chapters from matching audio,
or Save chapter timings for older audio from the existing prepared book and
import that small JSON into the older file's player. Book, narrator, edit and
pause settings must match; duration checks alone are not identity proof.
No replacement WAV or new speech is needed. Keep original audio as a backup.

Version 0.6.2 added Import audio files in the library. Choose WAV, MP3, M4A,
M4B, MP4 audio, AAC, Ogg, Opus or FLAC directly: no ZIP or new narration.
The device must support the file's codec; the import checks media metadata
before saving an offline Blob copy. Use its player to seek/change speed;
position is saved while listening and on pause. Audio-only imports do not
include book text, highlighting or M4B chapter navigation. Keep original files.
Background/locked-phone playback requires physical-device acceptance.
Import book transfer ZIP is a separate option for text-linked ReadAloud
transfers, not ordinary files zipped by a file manager. ZIP export date fields
are corrected in 0.6.2. Error details stay visible instead of only a toast.

Windows 10 or 11 and Microsoft Edge. Nothing to install: it uses Windows
PowerShell, which Windows already has.

Licences and source
-------------------
ReadAloud is licensed under the GNU General Public License, version 3 or later
(LICENSE.txt). Each other part keeps its own licence: see
THIRD-PARTY-NOTICES.txt and the app\licences folder, or open Settings, About,
Licences in the app. The accompanying source-candidate.tar.gz contains this
private candidate's source. The upstream project is https://github.com/rock0ne/readaloud
