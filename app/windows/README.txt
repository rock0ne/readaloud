ReadAloud for Windows
=====================

Listen to documents with natural voices and flag mistakes while you listen.
Reads .txt, .md, .docx, .pdf and .epub files, and text you paste.

Start
-----
1. Unzip this folder anywhere you like, for example Documents\ReadAloud.
2. Double-click ReadAloud.cmd. A small window opens, then ReadAloud opens in
   Microsoft Edge. If Windows asks whether to run the file, choose Run (or
   "More info", then "Run anyway").
3. Keep the small window open while you use ReadAloud. Close it to stop.

Install it as an app (optional)
-------------------------------
In Edge, select "App available - Install ReadAloud" in the address bar (or
Settings and more > Apps > Install this site as an app). ReadAloud then opens
from its own icon, even when the small window is closed.

The Kokoro voice
----------------
The first time you read with the Kokoro voice, Edge downloads its model (about
330 MB) from Hugging Face, once. After that it works offline.

What it needs and does
----------------------
- Windows 10 or 11 and Microsoft Edge. Nothing to install: it uses Windows
  PowerShell, which Windows already has.
- It serves the app on this PC only, at http://127.0.0.1:4173/, and sends
  nothing anywhere. Your documents, flags and settings stay in Edge on this PC.
- Keep using that same address. Another address, such as the web version, has
  its own separate library.

If your organisation blocks PowerShell scripts, use the web version instead:
https://rock0ne.github.io/readaloud/

Licence: GNU GPL version 3 or later (LICENSE.txt). Other parts and their
licences: THIRD-PARTY-NOTICES.txt. Source code and help:
https://github.com/rock0ne/readaloud
