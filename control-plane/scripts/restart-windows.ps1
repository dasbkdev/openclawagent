$ErrorActionPreference = "Stop"

foreach ($task in @("CompanyControlPlaneApi", "CompanyControlPlaneTelegramBot")) {
    $existing = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    if ($existing) {
        Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
        Start-ScheduledTask -TaskName $task
        Write-Host "Restarted $task"
    }
}
