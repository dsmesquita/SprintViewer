@echo off
rem Double-click this to zip the project to your Desktop for sending elsewhere.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0package-source.ps1"
pause
