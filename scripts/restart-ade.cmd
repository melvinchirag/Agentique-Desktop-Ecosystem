@echo off
rem Give the previous ADE process time to release its single-instance lock.
timeout /t 2 /nobreak >nul
call "%~dp0start-ade.cmd"
