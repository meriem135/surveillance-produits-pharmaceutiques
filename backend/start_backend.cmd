@echo off
cd /d C:\peaksoft-security-platform-main\backend
set PY=C:\peaksoft-security-platform-main\backend\.venv\Scripts\python.exe
echo %date% %time% launching uvicorn from start_backend.cmd >> C:\peaksoft-security-platform-main\backend\uvi_task.log
"%PY%" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 >> C:\peaksoft-security-platform-main\backend\uvi_task.log 2>> C:\peaksoft-security-platform-main\backend\uvi_task.err
