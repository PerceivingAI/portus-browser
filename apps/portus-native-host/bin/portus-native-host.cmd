@echo off
setlocal
set "PORTUS_NATIVE_HOST_DIR=%~dp0"
node "%PORTUS_NATIVE_HOST_DIR%..\dist\bin.js"
