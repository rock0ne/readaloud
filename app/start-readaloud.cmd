@echo off
rem Serves the built ReadAloud app at http://127.0.0.1:4173 and opens it in Microsoft Edge.
rem Keep this window open while you use or install the app. Once installed from Edge,
rem the app opens from its own cache even when this window is closed.
rem Always use 127.0.0.1, not localhost: each address keeps its own library and flags.
setlocal
set "APP=%~dp0"
set "NODE=node"
node --version >nul 2>nul
if errorlevel 1 set "NODE=%LOCALAPPDATA%\Temp\claude\session\scratchpad\nodewin\node.exe"
if /i not "%NODE%"=="node" if not exist "%NODE%" (
  echo Node.js was not found. Install Node 22 LTS, or ask Claude to set up a portable copy.
  pause
  exit /b 1
)
if not exist "%APP%dist\index.html" (
  echo The app is not built yet. Ask Claude to run "pnpm build" in ReadAloudApp\app.
  pause
  exit /b 1
)
if not "%READALOUD_NO_OPEN%"=="1" start "" /b cmd /c "timeout /t 2 >nul & start "" msedge http://127.0.0.1:4173/"
echo ReadAloud is running at http://127.0.0.1:4173/  (close this window to stop it)
"%NODE%" "%APP%node_modules\vite\bin\vite.js" preview "%APP%." --port 4173 --strictPort --host 127.0.0.1
