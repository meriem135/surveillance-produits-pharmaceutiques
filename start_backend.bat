@echo off
cd /d "%~dp0backend"
echo Starting backend on port 8000...
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
) else (
    python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
)
pause
