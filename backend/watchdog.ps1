# Watchdog backend Peaksoft
# Surveille le port 8000 et relance automatiquement uvicorn si le socket disparait.
# IMPORTANT : ne JAMAIS tuer de processus tant qu'un listener existe sur 8000.
# Sur Windows, .venv\python.exe est un "redirector" qui relance le vrai python
# (ex: C:\Program Files\Python313\python.exe) avec la meme ligne de commande :
# c'est UN SEUL serveur vu sous deux PIDs. On ne touche donc qu'en cas de port mort.
$ErrorActionPreference = "SilentlyContinue"

# Mutex : un seul watchdog a la fois (sinon deux instances peuvent se gêner
# au moment du redemarrage du backend).
$mutex = New-Object System.Threading.Mutex($false, "PeaksoftWatchdogMutex")
if (-not $mutex.WaitOne(0, $false)) { exit 0 }

$backendDir = $PSScriptRoot
$python = Join-Path $backendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) { $python = "python" }
$watchLog = Join-Path $backendDir "watchdog.log"
$outLog = Join-Path $backendDir "uvicorn_watch.log"
$errLog = Join-Path $backendDir "uvicorn_watch.err.log"

function Get-UvicornProcs {
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
        Where-Object { $_.CommandLine -match 'uvicorn\s+app\.main:app' }
}

function Start-Backend {
    Write-Output ("[{0}] Backend relance (port 8000 absent)" -f (Get-Date -Format "HH:mm:ss")) | Out-File -Append -FilePath $watchLog
    Start-Process -FilePath $python `
        -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000" `
        -WorkingDirectory $backendDir `
        -RedirectStandardOutput $outLog `
        -RedirectStandardError $errLog `
        -WindowStyle Hidden
}

while ($true) {
    $listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue

    if ($listener) {
        # Backend operationnel : on ne touche a RIEN.
        Start-Sleep -Seconds 20
        continue
    }

    # Pas de listener sur 8000. Distinguer "demarrage en cours" d'un vrai probleme.
    $procs = @(Get-UvicornProcs)
    $old = @($procs | Where-Object { (Get-Date) - $_.CreationDate -gt (New-TimeSpan -Seconds 120) })

    if ($procs.Count -gt 0 -and $old.Count -eq 0) {
        # Processus jeune (probablement en demarrage) : attendre avant d'agir.
        Start-Sleep -Seconds 20
        continue
    }

    # Port mort + processus vieux ou absents : nettoyer tout et relancer.
    foreach ($p in $procs) {
        Write-Output ("[{0}] Processus uvicorn moribond PID {1} tue" -f (Get-Date -Format "HH:mm:ss"), $p.ProcessId) | Out-File -Append -FilePath $watchLog
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    Start-Backend
    Start-Sleep -Seconds 20
}