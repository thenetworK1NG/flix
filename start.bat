@echo off
title Stremio Web
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo.
echo Stremio Web is starting at http://localhost:8000
echo Keep this window open. Press Ctrl+C to stop.
echo.
node server.js
pause
