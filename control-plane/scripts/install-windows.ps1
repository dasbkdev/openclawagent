param(
    [string]$SourceRoot = (Resolve-Path "$PSScriptRoot\..").Path,
    [string]$InstallDir = "$env:ProgramFiles\CompanyControlPlane",
    [string]$DataDir = "$env:ProgramData\CompanyControlPlane",
    [string]$NodeVersion = "24.14.0",
    [bool]$DownloadNodeIfMissing = $true,
    [switch]$InstallTelegramBot,
    [switch]$StartNow,
    [switch]$OpenSetupWizard
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run this installer from an elevated Administrator PowerShell session."
    }
}

function Copy-AppFiles {
    param(
        [string]$From,
        [string]$To
    )

    New-Item -ItemType Directory -Force -Path $To | Out-Null

    $excluded = @("\.git\", "\data\", "\dist\", "\node_modules\", "\test\")
    Get-ChildItem -Path $From -Recurse -File | ForEach-Object {
        $fullName = $_.FullName
        $skip = $false
        foreach ($pattern in $excluded) {
            if ($fullName -like "*$pattern*") {
                $skip = $true
                break
            }
        }
        if (-not $skip) {
            $relative = Get-RelativePath -BasePath $From -TargetPath $fullName
            $target = Join-Path $To $relative
            New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
            Copy-Item -Force -LiteralPath $fullName -Destination $target
        }
    }
}

function Get-RelativePath {
    param(
        [string]$BasePath,
        [string]$TargetPath
    )

    $baseFullPath = (Resolve-Path $BasePath).Path.TrimEnd("\") + "\"
    $targetFullPath = (Resolve-Path $TargetPath).Path
    $baseUri = [Uri]$baseFullPath
    $targetUri = [Uri]$targetFullPath
    return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString()).Replace("/", "\")
}

function Resolve-NodePath {
    param(
        [string]$AppDir,
        [string]$RequestedNodeVersion,
        [bool]$AllowDownload
    )

    $bundled = Join-Path $AppDir "runtime\node.exe"
    if (Test-Path $bundled) {
        return $bundled
    }

    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($node) {
        return $node.Source
    }

    if ($AllowDownload) {
        Install-PortableNode -AppDir $AppDir -RequestedNodeVersion $RequestedNodeVersion
        if (Test-Path $bundled) {
            return $bundled
        }
    }

    throw "node.exe was not found. Build the installer with scripts\build-windows-installer.ps1 so Node is bundled, or install Node.js 22+."
}

function Install-PortableNode {
    param(
        [string]$AppDir,
        [string]$RequestedNodeVersion
    )

    $runtimeDir = Join-Path $AppDir "runtime"
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

    $zipUrl = "https://nodejs.org/dist/v$RequestedNodeVersion/node-v$RequestedNodeVersion-win-x64.zip"
    $tempZip = Join-Path $env:TEMP "node-v$RequestedNodeVersion-win-x64.zip"
    $extractDir = Join-Path $env:TEMP ("node-runtime-" + [guid]::NewGuid().ToString("N"))

    Write-Host "node.exe not found. Downloading portable Node.js $RequestedNodeVersion..."
    Invoke-WebRequest -Uri $zipUrl -OutFile $tempZip
    Expand-Archive -Force -Path $tempZip -DestinationPath $extractDir

    $nodeExe = Get-ChildItem -Path $extractDir -Recurse -Filter node.exe | Select-Object -First 1
    if (-not $nodeExe) {
        throw "Downloaded Node archive did not contain node.exe"
    }

    Copy-Item -Force -LiteralPath $nodeExe.FullName -Destination (Join-Path $runtimeDir "node.exe")
}

function Ensure-EnvFile {
    param(
        [string]$AppDir,
        [string]$TargetDataDir
    )

    New-Item -ItemType Directory -Force -Path $TargetDataDir | Out-Null
    $envFile = Join-Path $TargetDataDir ".env"
    if (Test-Path $envFile) {
        return $envFile
    }

    $template = Join-Path $AppDir "config\control-plane.env.example"
    if (Test-Path $template) {
        Copy-Item -LiteralPath $template -Destination $envFile
    } else {
        @"
HOST=127.0.0.1
PORT=3099
BOOTSTRAP_OWNER_TELEGRAM_ID=dev-nikolay
KICKIDLER_BASE_URL=
CONTROL_PLANE_DATA_FILE=$TargetDataDir\control-plane.json
CONTROL_PLANE_CONFIG_DIR=$TargetDataDir
"@ | Set-Content -Encoding UTF8 -Path $envFile
    }

    return $envFile
}

function Wait-HttpEndpoint {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 45
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    return $false
}

function Register-ControlPlaneTask {
    param(
        [string]$TaskName,
        [string]$NodePath,
        [string]$ScriptPath,
        [string]$WorkingDirectory
    )

    $action = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$ScriptPath`"" -WorkingDirectory $WorkingDirectory
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Force | Out-Null
}

Assert-Admin

$resolvedSource = (Resolve-Path $SourceRoot).Path
Write-Host "Installing Company Control Plane"
Write-Host "Source: $resolvedSource"
Write-Host "InstallDir: $InstallDir"
Write-Host "DataDir: $DataDir"

Copy-AppFiles -From $resolvedSource -To $InstallDir
$envFile = Ensure-EnvFile -AppDir $InstallDir -TargetDataDir $DataDir
$nodePath = Resolve-NodePath `
    -AppDir $InstallDir `
    -RequestedNodeVersion $NodeVersion `
    -AllowDownload $DownloadNodeIfMissing

Register-ControlPlaneTask `
    -TaskName "CompanyControlPlaneApi" `
    -NodePath $nodePath `
    -ScriptPath (Join-Path $InstallDir "src\server.js") `
    -WorkingDirectory $InstallDir

if ($InstallTelegramBot) {
    Register-ControlPlaneTask `
        -TaskName "CompanyControlPlaneTelegramBot" `
        -NodePath $nodePath `
        -ScriptPath (Join-Path $InstallDir "src\telegram-bot.js") `
        -WorkingDirectory $InstallDir
}

if ($StartNow) {
    Start-ScheduledTask -TaskName "CompanyControlPlaneApi"
    if ($InstallTelegramBot) {
        Start-ScheduledTask -TaskName "CompanyControlPlaneTelegramBot"
    }
}

if ($OpenSetupWizard) {
    Start-ScheduledTask -TaskName "CompanyControlPlaneApi"
    $setupUrl = "http://127.0.0.1:3099/setup"
    if (Wait-HttpEndpoint -Url "http://127.0.0.1:3099/health") {
        Start-Process $setupUrl
    } else {
        Write-Warning "The setup wizard did not respond yet. Open it manually: $setupUrl"
    }
}

Write-Host ""
Write-Host "Install complete."
Write-Host "Config file: $envFile"
Write-Host "API task: CompanyControlPlaneApi"
if ($InstallTelegramBot) {
    Write-Host "Telegram task: CompanyControlPlaneTelegramBot"
} else {
    Write-Host "Telegram task was not installed. Re-run with -InstallTelegramBot after setting TELEGRAM_BOT_TOKEN."
}
Write-Host "Setup wizard: http://127.0.0.1:3099/setup"
Write-Host "Secrets are stored encrypted under $DataDir."
