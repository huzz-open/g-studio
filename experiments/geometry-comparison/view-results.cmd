@echo off
cd /d "%~dp0..\dsh-geometry"
"..\triposr-local\.venv\Scripts\python.exe" viewer.py
if errorlevel 1 pause
