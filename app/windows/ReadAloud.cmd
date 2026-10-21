@echo off
rem Starts ReadAloud: serves the app on this PC only and opens it in Microsoft Edge.
rem Needs nothing installed on Windows 10 or 11. Keep this window open while you use it.
title ReadAloud
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Root "%~dp0app" -Open
if errorlevel 1 pause
