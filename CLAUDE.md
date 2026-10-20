# ReadAloudApp — instructions for the building model

Personal read-aloud and proofreading app for Rockson. Targets: Windows PC and a
Samsung phone. Natural neural voices (the built-in Windows and Android voices
sound robotic; Speechify is too expensive). Reads `.txt`, `.md`, `.docx`, `.pdf`,
`.epub`. While listening, one key flags the current sentence; the app exports a
corrections list. Primary use right now: proofreading Rockson's finished book.

The app has no backend: nothing in this project touches a server, a tenant or
an account other than the user's own Azure key.

## Read in this order, and only what the current step needs

1. `docs/00-HANDOFF.md` — context, locked decisions, gotchas, where to start.
2. `docs/02-BUILD-PLAN.md` — find the next step; it names the spec sections to read.
3. `docs/01-DESIGN-SPEC.md` — the contract. Copy the types in section 4 verbatim.
4. `docs/03-TEST-PLAN.md` and `docs/04-DECISIONS.md` when a step points to them.
5. `docs/PROGRESS.md` — what is done, what is open. Update it every step.

Do not re-read the whole spec each turn. The build plan tells you which sections
matter for the step you are on.

## Working rules

- One build-plan step per turn. A step is done only when its acceptance check
  passes. Then update `docs/PROGRESS.md` and commit.
- All code lives in `app/`. Do not create other top-level folders without a line
  in `docs/04-DECISIONS.md`.
- TypeScript `strict`. No `any` in `app/src/core/`. Core may use only the browser
  globals listed in spec section 3.3 (DOMParser, Intl, crypto.subtle, fetch,
  Blob/URL). No UI imports in core.
- Tests use vitest. Run `pnpm test` before claiming a step done. Voice features
  are checked manually in **Microsoft Edge**, not Chrome (spec 7.2 says why).
- Never commit secrets. The Azure key is typed into Settings and lives only in
  IndexedDB. `.env*` and `app/test/fixtures/private/` are git-ignored.
- Dependencies: only those in spec section 13. If you truly need another, add a
  decision entry with the reason before installing it.
- The data model (spec 4) and storage schema (spec 9) are contracts. Changing
  them means bumping the schema version and writing a migration.
- Do not build later phases early. No backend, no server, no accounts other than
  the user's own Azure key. Do not use `edge-tts` or any undocumented endpoint.
- Do not deploy or publish anywhere. The PWA is installed locally from `pnpm
  preview` or a local static server; the Android build goes to the phone by adb.
- When a step needs something only Rockson can supply (an Azure key, a sample
  chapter `.docx`, a voice preference), finish everything else in the step,
  write the ask in `docs/PROGRESS.md` under "Needs Rockson", and continue with
  the next step that does not depend on it. Stop only when every remaining
  step depends on Rockson. The Azure key is not needed before Step 17.

## Commands

```bash
cd app && pnpm install
pnpm dev          # Vite dev server; open the URL in Microsoft Edge
pnpm test         # vitest, once
pnpm build        # production build to app/dist
pnpm preview      # serve app/dist locally; install the PWA from Edge here
```

Android (Phase 3b only) is built in **WSL Ubuntu**, never in Windows. See
`docs/00-HANDOFF.md` section "Toolchain".

## Phase gates

Each phase has a gate in `docs/02-BUILD-PLAN.md`. Do not start the next phase
until the gate's checklist is ticked in `docs/PROGRESS.md`.
