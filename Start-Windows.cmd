@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel% equ 0 (
  start "" "http://localhost:4173/"
  node tools\serve.mjs --host 127.0.0.1
  goto :eof
)
where py >nul 2>nul
if %errorlevel% equ 0 (
  start "" "http://localhost:4173/"
  py -m http.server 4173 --bind 127.0.0.1 --directory site
  goto :eof
)
echo Node.js or Python 3 is required for local preview.
echo GitHub Pages does not require either runtime.
pause
