@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Install Python 3.11 or later from https://www.python.org/downloads/
  pause
  exit /b 1
)
python launch.py
pause
