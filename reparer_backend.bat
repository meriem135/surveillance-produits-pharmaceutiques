@echo off
cd /d "%~dp0backend"
set "PY=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
if not exist "%PY%" (echo Python 3.11 introuvable & pause & exit /b 1)
if exist ".venv" ren ".venv" ".venv_ancien"
echo Creation du nouvel environnement Python...
"%PY%" -m venv .venv
echo Installation des dependances (quelques minutes)...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
echo.
echo Termine. Vous pouvez maintenant lancer start_backend.bat
pause
