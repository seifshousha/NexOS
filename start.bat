@echo off
title VirtOS — Starting...
color 0A

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║           VirtOS Web Desktop             ║
echo  ║      Virtual Operating System Sim        ║
echo  ╚══════════════════════════════════════════╝
echo.

:: Go to project root (same folder as this .bat)
cd /d "%~dp0"

:: Check Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python not found. Please install Python 3.10+
    pause
    exit /b 1
)

:: Check if port 8000 is already in use
netstat -an | find "0.0.0.0:8000" >nul 2>&1
if not errorlevel 1 (
    echo  [INFO] Server already running on port 8000 — opening browser...
    timeout /t 1 /nobreak >nul
    start "" "http://localhost:8000"
    exit /b 0
)

echo  [*] Starting VirtOS server...
echo  [*] Desktop will open automatically at: http://localhost:8000
echo  [*] Press Ctrl+C in this window to stop the server.
echo.

:: Open browser after short delay (server needs ~2s to start)
start /b cmd /c "timeout /t 3 /nobreak >nul && start "" http://localhost:8000"

:: Start server (foreground so logs are visible)
python run_server.py

pause
