<#
.SYNOPSIS
  Deploys control-plane src/ and test/ to the production server, with a
  pre-deploy local test run, a server-side runtime backup, and post-deploy
  health verification.

.DESCRIPTION
  Steps:
    1. Run `npm test` locally. Abort on failure.
    2. Create a server-side backup of the runtime data
       (.deploy-backups/<timestamp> plus a copy of the runtime JSON state).
    3. Copy `src` and `test` to the server with pscp.
    4. chown the uploaded files to the company-control-plane service user.
    5. Run `npm test` on the server. Abort (without restarting services) on failure.
    6. Restart both systemd services (API + Telegram bot).
    7. Verify both services are active and `curl /health` returns ok.
    8. Print a summary.

  Any failure stops the script with a clear message. Requires plink/pscp
  (PuTTY tools) on PATH. No passwords are stored in this script or the repo;
  authenticate either with a PuTTY private key (-KeyFile) or interactively
  via plink's password prompt (omit -KeyFile).

.PARAMETER ServerHost
  Target server hostname or IP. Default: 195.238.122.228

.PARAMETER HostKey
  Expected SSH host key fingerprint (SHA256:...) passed to plink/pscp -hostkey.

.PARAMETER KeyFile
  Optional path to a PuTTY .ppk private key file. If omitted, plink/pscp will
  prompt interactively for a password (never pass -pw on the command line).

.PARAMETER RemoteUser
  SSH user for the deploy. Default: root

.PARAMETER InstallDir
  Remote install directory. Default: /opt/company-control-plane

.PARAMETER DataDir
  Remote runtime data directory. Default: /var/lib/company-control-plane

.PARAMETER ServiceUser
  Remote service user/group to chown uploaded files to. Default: company-control-plane

.EXAMPLE
  ./deploy-to-server.ps1 -KeyFile C:\keys\deploy.ppk

.EXAMPLE
  ./deploy-to-server.ps1
  # prompts interactively for the SSH password via plink
#>

[CmdletBinding()]
param(
    [string]$ServerHost = "195.238.122.228",
    [string]$HostKey = "SHA256:yb/AtQRMBCn+sOxGG4iX4oLI3o1AHIlo+xAhsIbygyU",
    [string]$KeyFile = "",
    [string]$RemoteUser = "root",
    [string]$InstallDir = "/opt/company-control-plane",
    [string]$DataDir = "/var/lib/company-control-plane",
    [string]$ServiceUser = "company-control-plane"
)

$ErrorActionPreference = "Stop"

function Fail($message) {
    Write-Host ""
    Write-Host "DEPLOY FAILED: $message" -ForegroundColor Red
    exit 1
}

function Step($message) {
    Write-Host ""
    Write-Host "==> $message" -ForegroundColor Cyan
}

# Resolve repo paths.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ControlPlaneDir = Resolve-Path (Join-Path $ScriptDir "..")

# Build common plink/pscp argument arrays.
$sshTarget = "$RemoteUser@$ServerHost"
$commonArgs = @()
if ($HostKey) {
    $commonArgs += @("-hostkey", $HostKey)
}
if ($KeyFile) {
    if (-not (Test-Path $KeyFile)) {
        Fail "KeyFile not found: $KeyFile"
    }
    $commonArgs += @("-i", $KeyFile)
}
$commonArgs += @("-batch")
if (-not $KeyFile) {
    # Allow interactive password prompt (no -batch when no key is supplied,
    # so plink/pscp can prompt for a password). Remove -batch in that case.
    $commonArgs = $commonArgs | Where-Object { $_ -ne "-batch" }
}

function Invoke-Plink {
    param([Parameter(Mandatory)][string]$RemoteCommand)
    & plink @commonArgs $sshTarget $RemoteCommand
    if ($LASTEXITCODE -ne 0) {
        Fail "Remote command failed (exit $LASTEXITCODE): $RemoteCommand"
    }
}

function Invoke-Pscp {
    param(
        [Parameter(Mandatory)][string]$LocalPath,
        [Parameter(Mandatory)][string]$RemotePath
    )
    & pscp @commonArgs -r $LocalPath "${sshTarget}:${RemotePath}"
    if ($LASTEXITCODE -ne 0) {
        Fail "File copy failed: $LocalPath -> $RemotePath"
    }
}

# Verify plink/pscp are available.
foreach ($tool in @("plink", "pscp")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Fail "$tool not found on PATH. Install PuTTY tools (plink.exe, pscp.exe)."
    }
}

# 1. Local tests.
Step "Running local npm test"
Push-Location $ControlPlaneDir
try {
    & npm test
    if ($LASTEXITCODE -ne 0) {
        Fail "Local npm test failed. Fix tests before deploying."
    }
} finally {
    Pop-Location
}
Write-Host "Local tests passed." -ForegroundColor Green

# 2. Server-side backup.
Step "Creating server-side runtime backup"
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$backupDir = "$InstallDir/.deploy-backups/$timestamp"
$backupCmd = @(
    "set -euo pipefail;",
    "mkdir -p '$backupDir';",
    "if [ -d '$DataDir' ]; then",
    "  tar -czf '$backupDir/runtime-data.tar.gz' -C `"\$(dirname '$DataDir')`" `"\$(basename '$DataDir')`";",
    "fi;",
    "if [ -f '$DataDir/control-plane.json' ]; then",
    "  cp '$DataDir/control-plane.json' '$backupDir/control-plane.json';",
    "fi;",
    "echo BACKUP_DIR=$backupDir"
) -join " "
Invoke-Plink -RemoteCommand $backupCmd
Write-Host "Backup created at $backupDir on $ServerHost" -ForegroundColor Green

# 3. Copy src and test.
Step "Copying src/ and test/ to server"
$tmpUploadDir = "$InstallDir/.deploy-upload-$timestamp"
Invoke-Plink -RemoteCommand "mkdir -p '$tmpUploadDir'"
Invoke-Pscp -LocalPath (Join-Path $ControlPlaneDir "src") -RemotePath $tmpUploadDir
Invoke-Pscp -LocalPath (Join-Path $ControlPlaneDir "test") -RemotePath $tmpUploadDir
$swapCmd = @(
    "set -euo pipefail;",
    "rm -rf '$InstallDir/src.prev' '$InstallDir/test.prev';",
    "if [ -d '$InstallDir/src' ]; then mv '$InstallDir/src' '$InstallDir/src.prev'; fi;",
    "if [ -d '$InstallDir/test' ]; then mv '$InstallDir/test' '$InstallDir/test.prev'; fi;",
    "mv '$tmpUploadDir/src' '$InstallDir/src';",
    "mv '$tmpUploadDir/test' '$InstallDir/test';",
    "rmdir '$tmpUploadDir'"
) -join " "
Invoke-Plink -RemoteCommand $swapCmd
Write-Host "Uploaded src/ and test/." -ForegroundColor Green

# 4. chown to service user.
Step "Setting ownership to $ServiceUser"
Invoke-Plink -RemoteCommand "chown -R ${ServiceUser}:${ServiceUser} '$InstallDir/src' '$InstallDir/test'"

# 5. Server-side tests. Roll back src/test on failure, do not restart services.
Step "Running npm test on server"
$serverTestCmd = "cd '$InstallDir' && npm test"
& plink @commonArgs $sshTarget $serverTestCmd
if ($LASTEXITCODE -ne 0) {
    Write-Host "Server npm test failed. Rolling back src/ and test/." -ForegroundColor Yellow
    $rollbackCmd = @(
        "set -euo pipefail;",
        "rm -rf '$InstallDir/src' '$InstallDir/test';",
        "if [ -d '$InstallDir/src.prev' ]; then mv '$InstallDir/src.prev' '$InstallDir/src'; fi;",
        "if [ -d '$InstallDir/test.prev' ]; then mv '$InstallDir/test.prev' '$InstallDir/test'; fi"
    ) -join " "
    Invoke-Plink -RemoteCommand $rollbackCmd
    Fail "Server npm test failed. Rolled back to previous src/test. Services were not restarted."
}
Write-Host "Server tests passed." -ForegroundColor Green

# 6. Restart services.
Step "Restarting systemd services"
Invoke-Plink -RemoteCommand "systemctl daemon-reload && systemctl restart company-control-plane-api.service && systemctl restart company-control-plane-telegram-bot.service"

# 7. Verify health.
Step "Verifying service status and /health"
$verifyCmd = @(
    "set -euo pipefail;",
    "sleep 2;",
    "systemctl is-active company-control-plane-api.service;",
    "systemctl is-active company-control-plane-telegram-bot.service;",
    "curl -sf http://127.0.0.1:3099/health"
) -join " "
& plink @commonArgs $sshTarget $verifyCmd
if ($LASTEXITCODE -ne 0) {
    Fail "Post-deploy verification failed (service status or /health check). Investigate on the server before retrying."
}

# 8. Cleanup prev copies (best-effort).
Invoke-Plink -RemoteCommand "rm -rf '$InstallDir/src.prev' '$InstallDir/test.prev'"

Write-Host ""
Write-Host "DEPLOY SUCCESSFUL" -ForegroundColor Green
Write-Host "Server: $ServerHost"
Write-Host "Backup: $backupDir"
Write-Host "Both systemd services are active and /health responded OK."
