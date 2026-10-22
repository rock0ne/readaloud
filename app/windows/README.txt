ReadAloud for Windows
=====================

Listen to documents with natural voices and flag mistakes while you listen.
Reads .txt, .md, .docx, .pdf and .epub files, and text you paste.

Check the download first
------------------------
The release page on GitHub (https://github.com/rock0ne/readaloud/releases)
shows the SHA-256 of this zip. To see the zip's SHA-256, open PowerShell in
the folder that holds the zip and type (with this zip's name):

    Get-FileHash .\ReadAloud-windows-<version>.zip -Algorithm SHA256

If the two values are not exactly the same, do not open the zip: delete it.

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
from its own icon, even when the small window is closed.

What stays on this PC
---------------------
- ReadAloud runs on this PC at http://127.0.0.1:4173/. Only this PC can open
  that address. Keep using that same address: another address, such as the
  web version, has its own separate library.
- Your documents, flags, notes and settings stay in Edge on this PC.
  ReadAloud has no account and collects no usage data.

What goes online
----------------
- The Kokoro voice, once. The first time you read with it, Edge downloads its
  model (about 330 MB) from Hugging Face. After that it works offline, and
  the text you read is never sent anywhere: the speech is made on this PC.
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
Windows 10 or 11 and Microsoft Edge. Nothing to install: it uses Windows
PowerShell, which Windows already has.

Licences and source
-------------------
ReadAloud is licensed under the GNU General Public License, version 3 or later
(LICENSE.txt). Each other part keeps its own licence: see
THIRD-PARTY-NOTICES.txt and the app\licences folder, or open Settings, About,
Licences in the app. Source code and help: https://github.com/rock0ne/readaloud
