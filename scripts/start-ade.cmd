@echo off
rem Starts ADE from this repo (the current build). The desktop "ADE" icon runs this.
rem The window stays minimized and closes by itself when you quit ADE (Hub X, tray Quit ADE, or Ctrl+Shift+Q).
cd /d "%~dp0.."
call npm.cmd run dev
