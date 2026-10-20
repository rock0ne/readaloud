# ReadAloudApp — build approach (v0, 2026-10-20)

Personal read-aloud and proofreading app for Windows and Samsung (Android) phones.
Reads `.txt`, `.md`, `.pdf`, `.docx` and `.epub` with natural neural voices, and
lets you flag mistakes while listening and export them as a correction list.

This document is the overview (why and what). The builder-ready package is in
`docs/`: start with `CLAUDE.md`, then `docs/00-HANDOFF.md`. Nothing has been
built yet.

---

## 1. The real job

Two uses, one app:

1. **Read many files** (notes, reports, Markdown, PDFs, Word) on the PC or the phone,
   with voices that sound like Speechify rather than Windows Narrator.
2. **Proofread the finished book by ear.** Hearing text read back is one of the
   best proofreading techniques because the voice reads what is actually on the
   page, not what you expect to see. The app must make it trivial to *mark a
   mistake the moment you hear it* without stopping to find the spot in the file,
   then hand you a list to fix.

Point 2 is the feature no off-the-shelf reader does well. It is why building is
worth it.

---

## 2. Why Windows sounds robotic, and where the good voices come from

- The voices Windows exposes to ordinary apps (SAPI: David, Zira, Hazel, etc.) are
  old concatenative voices. Anything built on SAPI or the Web Speech API in Chrome
  on Windows inherits them.
- Speechify, Edge "Read Aloud", Word's Read Aloud and Azure all use **neural TTS**.
  The audible gap is the model, not the app.
- Windows 11 ships neural "natural" voices for Narrator only; third-party apps
  cannot use them directly (there is a community SAPI adapter, but it is a hack).
- **Microsoft Edge exposes its online neural voices to web pages** through the
  standard Web Speech API (voices named like "Microsoft Sonia Online (Natural) -
  English (United Kingdom)"). A web app running inside Edge gets Speechify-grade
  voices for free with zero backend. Chrome and Android WebView do not.

So the approach is: an **engine-agnostic reader** with several voice engines
behind one interface, choosing the best one available on each device.

---

## 3. Voice engine options

| Engine | Quality | Offline | Cost | Where it works | Risk |
|---|---|---|---|---|---|
| **Edge natural voices via Web Speech API** | Speechify-tier | No | Free | Edge on Windows only | Low (official browser feature) |
| **Azure AI Speech (neural)** | Same voices as Edge | No | Free tier 0.5M chars/month, then paid per char | Everywhere (REST or JS SDK) | Low (official, needs an Azure resource) |
| **Kokoro-82M (open model)** | Very good, close to neural cloud | **Yes** | Free | Browser (kokoro-js, WASM/WebGPU); Android via sherpa-onnx | Medium (model ~90–330 MB; phone speed roughly 1.5–3x realtime on a flagship, so pre-buffering is needed) |
| **Piper** | OK, clearly synthetic | Yes | Free | Everywhere | Low, but quality is below the bar you want |
| **edge-tts / edge-tts-universal** | Speechify-tier | No | Free | Python/Node, and browser **only inside Edge** | **High**: undocumented endpoint; Microsoft already removed SSML; could break any day |
| **System TTS (Samsung/Google)** | Mediocre | Yes | Free | Android | Low; last-resort fallback |
| ElevenLabs / OpenAI / Google Cloud TTS | Excellent | No | Paid per char, pricier than Azure | Everywhere | Low, but an ongoing bill |

**Sizing the book:** a typical 80k-word book is roughly 450–500k characters, so
one listen-through fits in the Azure free monthly neural allowance (HD voices are
excluded from the free tier). Check the Azure pricing calculator before relying on
it.

### Recommendation

Build one `VoiceEngine` interface and ship engines in this order:

1. **Edge natural voices (Web Speech)** — Windows, day one, no account, no cost.
2. **Azure Speech** — the phone, and the PC when not in Edge. Official API, same
   voices, free tier covers the book. Cache synthesized audio per sentence so
   re-listening and rewinding cost nothing.
3. **Kokoro offline** — later, for privacy and travel: kokoro-js on Windows,
   sherpa-onnx on Android.
4. **System TTS** — automatic fallback when offline and Kokoro is not installed.
5. `edge-tts` only as an optional experiment, never the default path.

---

## 4. Architecture

```
ReadAloudApp/
  core/                 pure TypeScript, no UI, fully unit-testable
    ingest/             loaders: txt, md, docx, pdf  -> Document model
    model/              Document = chapters -> paragraphs -> sentences (stable IDs + char offsets)
    normalize/          text-to-speech normalisation (strip Markdown remnants, URLs, headings as announcements)
    engines/            VoiceEngine interface + WebSpeechEngine, AzureEngine, KokoroEngine, SystemEngine
    player/             sentence queue, prefetch N ahead, gapless playback, speed, position
    flags/              flags + notes, export to corrections.md, optional apply-to-source
    store/              IndexedDB: library, positions, flags, audio cache; JSON export/import
  app/                  Vite + TypeScript + Preact (small) UI, PWA manifest
  android/              Capacitor project wrapping app/ (built in WSL, see section 7)
  docs/                 this file, decisions, test notes
```

Key interfaces:

```ts
interface VoiceEngine {
  id: string; name: string; offline: boolean;
  listVoices(): Promise<Voice[]>;
  synthesize(sentence: Sentence, opts: { voice: Voice; rate: number }): Promise<AudioChunk>; // or speak() for Web Speech
  supportsWordBoundaries: boolean;
}

interface Sentence { id: string; chapter: number; paragraph: number; index: number; text: string; start: number; end: number }

interface Flag { id: string; sentenceId: string; quote: string; note?: string; createdAt: string; fixedText?: string }
```

Sentence segmentation uses the built-in `Intl.Segmenter` (granularity `sentence`),
available in Edge, Chrome and Android WebView, so no NLP dependency.

---

## 5. Document ingestion

| Format | Library (browser-capable) | Notes |
|---|---|---|
| `.txt` | none | paragraphs split on blank lines |
| `.md` | `marked` or `remark` to AST | keep heading levels for the table of contents; read link text not URLs; skip images; code blocks optional |
| `.docx` | `mammoth` | gives HTML with headings/paragraphs; good structure for chapters |
| `.epub` | `jszip` + `DOMParser` | a zip of XHTML chapters: container.xml → OPF → spine order → each chapter is HTML already; TOC from nav.xhtml or toc.ncx; DRM files refused |
| `.pdf` | `pdfjs-dist` | weakest format: must rebuild lines, join hyphenated words, drop running headers/footers/page numbers; multi-column layouts read out of order |

Advice for the book: proofread from the **`.docx` or `.md` source**, not the PDF
export. The structure is cleaner and corrections can be mapped back exactly.

---

## 6. Proofreading workflow (the feature that matters)

While listening:

- The current sentence is highlighted; a chapter/paragraph breadcrumb is shown.
- **Space** pause/resume. **F** flag this sentence. **N** flag with a typed note.
  **Left/Right** previous/next sentence. **R** replay sentence. On the phone: one
  large FLAG button under the thumb, plus a note field.
- A flag stores the sentence ID, the quoted text and the exact character range in
  the source, so it can always be found again.
- Speed 0.8x to 3.0x. Neural voices stay intelligible to roughly 1.8x via the
  engine rate; above that use audio `playbackRate`.
- Position is remembered per file. Export/import of positions and flags as JSON
  lets you switch between PC and phone (drop the JSON in OneDrive).

After listening:

- **Flags panel**: list, edit the note, type the corrected sentence inline.
- **Export `corrections.md`**: one entry per flag with chapter, paragraph, the
  quoted sentence, and your note / corrected text. Work through it in Word.
- **Apply to source (Markdown only, later phase)**: write a corrected `.md` with
  the fixes applied and a diff alongside. Writing back into `.docx` while
  preserving formatting is deliberately out of scope until the rest is proven.

---

## 7. Platform packaging

**Windows: install as a PWA from Edge.** Edge gives the natural voices, the File
System Access API gives real file open/save, drag-and-drop works, IndexedDB
stores the library, keyboard shortcuts work. No installer, no code signing. A
Tauri/Electron shell can come later if a native window is wanted.

**Android (Samsung S21+): Capacitor wrapper around the same web app.** The WSL
Capacitor/Gradle toolchain already set up for the mobile SOC app is reused
(JDK 21 + Android SDK under `~/.local`, build in WSL not Windows). Inside the
Android WebView the Web Speech API only reaches the system engine, so the phone
uses the Azure engine (and Kokoro via a small sherpa-onnx Capacitor plugin in a
later phase). Audio prefetch of the next few sentences keeps playback gapless on
mobile data.

Rejected alternatives: .NET MAUI (cannot reach the Windows natural voices either);
Flutter (viable, and sherpa-onnx has Flutter bindings, but it throws away the
existing Capacitor toolchain and the free Edge path).

---

## 8. Phased plan

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | This plan, decisions confirmed | You approve the engine order and the PWA-first choice |
| 1 | **Windows PWA**: load txt/md/docx/pdf/epub, TOC, reader UI, Web Speech engine with Edge natural voices, flags + `corrections.md` export, resume position | You can listen to a chapter of the book in Edge, flag mistakes with one key, and export the list |
| 2 | **Azure engine** + per-sentence audio cache + prefetch; voice picker | Same app works in Chrome and on any device with the Azure key; a full chapter plays gapless |
| 3 | **Android**: Capacitor wrap, thumb-friendly flag UI, install on the S21+ | Book plays on the phone with Azure voices; flags round-trip via JSON export |
| 4 | **Offline Kokoro**: kokoro-js on Windows, sherpa-onnx plugin on Android | Works in airplane mode with a voice you would still choose over the system one |
| 5 | Nice-to-have: apply corrections to `.md`, word-level highlight (Azure SDK word boundaries), OneDrive position sync | As used |

Phase 1 is a few focused sessions and immediately useful for the book.

---

## 9. What you can use today, before any code

- **Edge on Windows**: open the PDF (or a rendered Markdown page), then Read Aloud
  (Ctrl+Shift+U) and pick a "Natural" voice, e.g. Sonia or Ryan (UK). This is the
  same voice tier as Speechify, free.
- **Edge on the S21+** also has Read Aloud with natural voices for web pages and
  PDFs.
- **Word (Microsoft 365)**: Review tab, Read Aloud. Uses natural voices for `.docx`.

What these lack is the flag-while-listening workflow and the correction export,
which is exactly what Phase 1 adds.

---

## 10. Decisions needed

1. **Engine order**. Recommended: Edge Web Speech first, Azure second, Kokoro
   later (as above). Second-best: Kokoro offline first everywhere (more build
   effort up front, no account, slower first playback on the phone).
2. **Windows packaging**. Recommended: PWA in Edge. Second-best: Tauri shell
   with a local Kokoro sidecar (native window, offline, more work).
3. **Azure resource**. Recommended: create a free F0 Speech resource in the
   production tenant subscription (never the lab tenant). Second-best: skip
   Azure and go straight to Kokoro for the phone (accept slower synthesis).
4. **Source for the book**. Recommended: proofread from the `.docx`/`.md`
   manuscript. Second-best: the PDF, accepting reading-order glitches.

---

## 11. Sources checked (2026-10-20)

- edge-tts on PyPI (unofficial, SSML removed after Microsoft blocked it): https://pypi.org/project/edge-tts/6.1.19
- edge-tts-universal (TypeScript; browser use works only inside Edge): https://jsr.io/@edge-tts/universal
- kokoro-js (Kokoro-82M in the browser via Transformers.js, q8/WASM or fp32/WebGPU): https://www.npmjs.com/package/kokoro-js
- Kokoro on Android via sherpa-onnx (VoxSherpa; Android 11+, ARM64, ~500 MB storage): https://github.com/CodeBySonu95/VoxSherpa-TTS
- Kokoro Android guide (ONNX files ~330 MB, 24 kHz, 50 voices): https://soniqo.audio/guides/kokoro/android
- Azure AI Speech pricing (Free F0: 0.5M neural characters/month; HD voices excluded): https://azure.microsoft.com/en-gb/pricing/details/cognitive-services/speech-services/
