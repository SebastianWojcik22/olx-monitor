@echo off
title OLX Monitor
cd /d "%~dp0"

echo [OLX Monitor] Uruchamianie serwera...

REM Uruchom serwer w tle (nowe okno minimalizowane)
start "OLX Monitor - Server" /min cmd /k "cd /d "%~dp0" && npm start"

REM Poczekaj az serwer wstanie
timeout /t 4 /nobreak >/dev/null

REM Otworz dashboard w domyslnej przegladarce
echo [OLX Monitor] Otwieranie dashboardu...
start "" "http://localhost:3001"

exit
