@echo off
title AetherStream - UHD Video Downloader
echo ====================================================
echo             AETHERSTREAM DOWNLOADER ENGINE
echo ====================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in your system PATH!
    echo Please install Node.js (https://nodejs.org) and try again.
    echo.
    pause
    exit /b 1
)

echo [1/3] Node.js detected.
echo.

:: Install dependencies if node_modules doesn't exist
if not exist "node_modules\" (
    echo [2/3] Installing application dependencies...
    call npm install
) else (
    echo [2/3] Dependencies already installed. Skipping.
)
echo.

echo [3/3] Launching Downloader server...
echo.
echo Closing this window will stop the AetherStream server.
echo.
call npm start

pause
