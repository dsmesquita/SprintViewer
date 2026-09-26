@echo off
rem Double-click this to build and launch Sprint Viewer from source.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1"
if errorlevel 1 pause
