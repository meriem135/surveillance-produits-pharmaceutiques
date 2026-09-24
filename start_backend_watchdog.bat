@echo off
cd /d "%~dp0backend"
echo ============================================================
echo  Peaksoft - Backend + Watchdog (port 8000)
echo  Le garde-fou relancera automatiquement le backend si le
echo  port 8000 disparait. Fermez cette fenetre pour tout arreter.
echo ============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0backend\watchdog.ps1"
pause