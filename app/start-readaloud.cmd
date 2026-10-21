@echo off
rem Serves the built app (app\dist) at http://127.0.0.1:4173 and opens it in Microsoft Edge.
rem Runs with Windows' own PowerShell, so Node is needed only to build the app (ADR-29).
rem Keep this window open while you use or install the app. Once installed from Edge,
rem the app opens from its own icon even when this window is closed.
rem Always use 127.0.0.1, not localhost: each address keeps its own library and flags.
setlocal
title ReadAloud
if not exist "%~dp0dist\index.html" (
  echo The app is not built yet. Run "pnpm build" in this folder first.
  pause
  exit /b 1
)
set "OPEN=-Open"
if "%READALOUD_NO_OPEN%"=="1" set "OPEN="
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\serve.ps1" -Root "%~dp0dist" %OPEN%
if errorlevel 1 pause
