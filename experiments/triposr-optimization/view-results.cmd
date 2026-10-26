@echo off
cd /d "%~dp0"
"..\triposr-local\.venv\Scripts\python.exe" viewer.py
if errorlevel 1 pause
