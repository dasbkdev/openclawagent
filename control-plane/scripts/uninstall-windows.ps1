param(
    [switch]$RemoveData,
    [string]$InstallDir = "$env:ProgramFiles\CompanyControlPlane",
    [string]$DataDir = "$env:ProgramData\CompanyControlPlane"
)

$ErrorActionPreference = "Stop"

$tasks = @("CompanyControlPlaneApi", "CompanyControlPlaneTelegramBot")
foreach ($task in $tasks) {
    $existing = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    if ($existing) {
        Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $task -Confirm:$false
    }
}

if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force -LiteralPath $InstallDir
}

if ($RemoveData -and (Test-Path $DataDir)) {
    Remove-Item -Recurse -Force -LiteralPath $DataDir
}

Write-Host "Company Control Plane uninstalled."
