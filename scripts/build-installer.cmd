@echo off
rem Double-click this to produce the Windows installer in release\.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-installer.ps1"
pause
