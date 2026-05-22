@echo off
setlocal
set "PORTUS_TERMINAL_HOST_DIR=%~dp0"
node "%PORTUS_TERMINAL_HOST_DIR%..\dist\bin.js"
