param(
    [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$InstallDir = "",
    [string]$ControlPlaneUrl = "https://starlabagent.pp.ua",
    [switch]$StartNow
)

$ErrorActionPreference = "Stop"

if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA "StarlabOpenClawAgent"
}

$ConfigDir = Join-Path $InstallDir "config"
$LogDir = Join-Path $InstallDir "logs"
$SrcDir = Join-Path $InstallDir "src"
$NodeDir = Join-Path $InstallDir "node"
$TaskName = "StarlabOpenClawLocalAgent"

New-Item -ItemType Directory -Force -Path $ConfigDir, $LogDir, $SrcDir | Out-Null
Copy-Item -LiteralPath (Join-Path $SourceRoot "src\device-agent.js") -Destination (Join-Path $SrcDir "device-agent.js") -Force
Copy-Item -LiteralPath (Join-Path $SourceRoot "package.json") -Destination (Join-Path $InstallDir "package.json") -Force

$NodeBin = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $NodeBin) {
    $nodeVersion = "v22.22.3"
    $nodeZip = "node-$nodeVersion-win-x64.zip"
    $nodeUrl = "https://nodejs.org/dist/$nodeVersion/$nodeZip"
    $tmpZip = Join-Path $env:TEMP $nodeZip
    $tmpExtract = Join-Path $env:TEMP "starlab-openclaw-node"
    Remove-Item -LiteralPath $tmpExtract -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $NodeDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Downloading portable Node.js $nodeVersion"
    Invoke-WebRequest -Uri $nodeUrl -OutFile $tmpZip
    Expand-Archive -LiteralPath $tmpZip -DestinationPath $tmpExtract -Force
    $expanded = Get-ChildItem -LiteralPath $tmpExtract -Directory | Select-Object -First 1
    if (-not $expanded) {
        throw "Node.js archive did not contain an extracted directory."
    }
    Move-Item -LiteralPath $expanded.FullName -Destination $NodeDir
    $NodeBin = Join-Path $NodeDir "node.exe"
}

$EnvFile = Join-Path $ConfigDir "device-agent.env"
if (-not (Test-Path $EnvFile)) {
@"
CONTROL_PLANE_URL=$ControlPlaneUrl
DEVICE_AGENT_INTERVAL_SECONDS=60
DEVICE_AGENT_CAPABILITIES=heartbeat,local-app
"@ | Set-Content -Encoding UTF8 -Path $EnvFile
}

$AgentScript = Join-Path $SrcDir "device-agent.js"
$Stdout = Join-Path $LogDir "device-agent.out.log"
$Stderr = Join-Path $LogDir "device-agent.err.log"
$Runner = Join-Path $InstallDir "run-openclaw-agent.ps1"
@"
`$ErrorActionPreference = "Stop"
& "$NodeBin" "$AgentScript" --app --env-file "$EnvFile" >> "$Stdout" 2>> "$Stderr"
"@ | Set-Content -Encoding UTF8 -Path $Runner

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`"" `
    -WorkingDirectory $InstallDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 365) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Starlab OpenClaw local employee agent" `
    -Force | Out-Null

$ShortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "Starlab OpenClaw Agent.lnk"
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`""
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.Save()

if ($StartNow) {
    Start-ScheduledTask -TaskName $TaskName
    Start-Process -WindowStyle Hidden -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`""
}

Write-Host "Installed Starlab OpenClaw Agent:"
Write-Host "  Task: $TaskName"
Write-Host "  App:  http://127.0.0.1:4157"
Write-Host "  Env:  $EnvFile"
Write-Host "  Logs: $Stdout"
