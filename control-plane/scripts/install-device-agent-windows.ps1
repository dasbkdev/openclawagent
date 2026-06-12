param(
    [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$InstallDir = "",
    [string]$ControlPlaneUrl = "https://starlabagent.pp.ua",
    [Parameter(Mandatory = $true)]
    [string]$UserId,
    [string]$DeviceId = "",
    [string]$DisplayName = "",
    [string]$Token = "",
    [int]$IntervalSeconds = 60,
    [string]$Labels = "{}",
    [string]$Capabilities = "heartbeat",
    [switch]$RunAsSystem,
    [switch]$StartNow
)

$ErrorActionPreference = "Stop"

if (-not $InstallDir) {
    $InstallDir = if ($RunAsSystem) {
        Join-Path $env:ProgramData "CompanyControlPlaneAgent"
    } else {
        Join-Path $env:LOCALAPPDATA "CompanyControlPlaneAgent"
    }
}

if (-not $DeviceId) {
    $safeHost = ($env:COMPUTERNAME.ToLowerInvariant() -replace "[^a-z0-9._-]+", "-")
    $DeviceId = "$UserId-$safeHost"
}
if (-not $DisplayName) {
    $DisplayName = "$UserId on $env:COMPUTERNAME"
}

$ConfigDir = Join-Path $InstallDir "config"
$LogDir = Join-Path $InstallDir "logs"
$SrcDir = Join-Path $InstallDir "src"
$NodeDir = Join-Path $InstallDir "node"
$TaskName = "CompanyControlPlaneDeviceAgent"

New-Item -ItemType Directory -Force -Path $ConfigDir, $LogDir, $SrcDir | Out-Null
Copy-Item -LiteralPath (Join-Path $SourceRoot "src\device-agent.js") -Destination (Join-Path $SrcDir "device-agent.js") -Force
Copy-Item -LiteralPath (Join-Path $SourceRoot "package.json") -Destination (Join-Path $InstallDir "package.json") -Force

$NodeBin = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $NodeBin) {
    $nodeVersion = "v22.22.3"
    $nodeZip = "node-$nodeVersion-win-x64.zip"
    $nodeUrl = "https://nodejs.org/dist/$nodeVersion/$nodeZip"
    $tmpZip = Join-Path $env:TEMP $nodeZip
    $tmpExtract = Join-Path $env:TEMP "company-control-plane-node"
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
@"
CONTROL_PLANE_URL=$ControlPlaneUrl
DEVICE_AGENT_ID=$DeviceId
DEVICE_AGENT_USER_ID=$UserId
DEVICE_AGENT_DISPLAY_NAME=$DisplayName
DEVICE_AGENT_TOKEN=$Token
DEVICE_AGENT_INTERVAL_SECONDS=$IntervalSeconds
DEVICE_AGENT_LABELS=$Labels
DEVICE_AGENT_CAPABILITIES=$Capabilities
"@ | Set-Content -Encoding UTF8 -Path $EnvFile

$AgentScript = Join-Path $SrcDir "device-agent.js"
$Stdout = Join-Path $LogDir "device-agent.out.log"
$Stderr = Join-Path $LogDir "device-agent.err.log"
$Runner = Join-Path $InstallDir "run-device-agent.ps1"
@"
`$ErrorActionPreference = "Stop"
& "$NodeBin" "$AgentScript" --env-file "$EnvFile" >> "$Stdout" 2>> "$Stderr"
"@ | Set-Content -Encoding UTF8 -Path $Runner

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`"" `
    -WorkingDirectory $InstallDir
$Trigger = if ($RunAsSystem) {
    New-ScheduledTaskTrigger -AtStartup
} else {
    New-ScheduledTaskTrigger -AtLogOn
}
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 365) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)
$Principal = if ($RunAsSystem) {
    New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
} else {
    New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Company Control Plane lightweight device heartbeat agent" `
    -Force | Out-Null

if ($StartNow) {
    Start-ScheduledTask -TaskName $TaskName
}

Write-Host "Installed device agent:"
Write-Host "  $TaskName"
Write-Host "  $EnvFile"
Write-Host "Logs:"
Write-Host "  $Stdout"
Write-Host "  $Stderr"
