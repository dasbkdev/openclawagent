param(
    [string]$InstallDir = "$env:ProgramFiles\CompanyControlPlane",
    [string]$DataDir = "$env:ProgramData\CompanyControlPlane",
    [int]$ApiPort = 3099,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

$checks = New-Object System.Collections.Generic.List[object]

function Add-Check {
    param(
        [string]$Name,
        [string]$Status,
        [string]$Details = ""
    )

    $checks.Add([pscustomobject]@{
        name = $Name
        status = $Status
        details = $Details
    })
}

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Format-GB {
    param([double]$Bytes)
    return "{0:N1} GB" -f ($Bytes / 1GB)
}

function Get-CommandVersion {
    param([string]$CommandName)

    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if (-not $command) {
        return $null
    }

    try {
        $versionOutput = & $command.Source --version 2>$null
        return (($versionOutput | Select-Object -First 1) -as [string])
    } catch {
        return $command.Source
    }
}

function Test-PortFree {
    param([int]$Port)

    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listeners) {
        return $false
    }
    return $true
}

try {
    if (Test-Admin) {
        Add-Check -Name "Administrator" -Status "PASS" -Details "Running elevated."
    } else {
        Add-Check -Name "Administrator" -Status "FAIL" -Details "Run PowerShell as Administrator before install."
    }

    $os = Get-CimInstance Win32_OperatingSystem
    Add-Check -Name "Windows" -Status "PASS" -Details "$($os.Caption), version $($os.Version)"

    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $cores = [int]$cpu.NumberOfLogicalProcessors
    if ($cores -ge 4) {
        Add-Check -Name "CPU" -Status "PASS" -Details "$cores logical processors. Recommended target met."
    } elseif ($cores -ge 2) {
        Add-Check -Name "CPU" -Status "WARN" -Details "$cores logical processors. Pilot minimum met; 4+ recommended."
    } else {
        Add-Check -Name "CPU" -Status "FAIL" -Details "$cores logical processors. Need at least 2."
    }

    $computer = Get-CimInstance Win32_ComputerSystem
    $ramBytes = [double]$computer.TotalPhysicalMemory
    $ramGb = $ramBytes / 1GB
    if ($ramGb -ge 8) {
        Add-Check -Name "RAM" -Status "PASS" -Details "$(Format-GB $ramBytes). Recommended target met."
    } elseif ($ramGb -ge 4) {
        Add-Check -Name "RAM" -Status "WARN" -Details "$(Format-GB $ramBytes). Pilot minimum met; 8+ GB recommended."
    } else {
        Add-Check -Name "RAM" -Status "FAIL" -Details "$(Format-GB $ramBytes). Need at least 4 GB."
    }

    $systemDrive = $env:SystemDrive
    $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$systemDrive'"
    $freeBytes = [double]$disk.FreeSpace
    $freeGb = $freeBytes / 1GB
    if ($freeGb -ge 100) {
        Add-Check -Name "Disk" -Status "PASS" -Details "$systemDrive has $(Format-GB $freeBytes) free. Recommended target met."
    } elseif ($freeGb -ge 30) {
        Add-Check -Name "Disk" -Status "WARN" -Details "$systemDrive has $(Format-GB $freeBytes) free. Pilot minimum met; 100+ GB recommended."
    } else {
        Add-Check -Name "Disk" -Status "FAIL" -Details "$systemDrive has $(Format-GB $freeBytes) free. Need at least 30 GB."
    }

    $gitVersion = Get-CommandVersion -CommandName "git.exe"
    if ($gitVersion) {
        Add-Check -Name "Git" -Status "PASS" -Details $gitVersion
    } else {
        Add-Check -Name "Git" -Status "WARN" -Details "Git is missing. Install Git before cloning/updating repo."
    }

    $nodeVersion = Get-CommandVersion -CommandName "node.exe"
    if ($nodeVersion) {
        $major = 0
        if ($nodeVersion -match "v?(\d+)") {
            $major = [int]$Matches[1]
        }
        if ($major -ge 22) {
            Add-Check -Name "Node.js" -Status "PASS" -Details $nodeVersion
        } else {
            Add-Check -Name "Node.js" -Status "WARN" -Details "$nodeVersion found. Installer can use bundled/portable Node 22+."
        }
    } else {
        Add-Check -Name "Node.js" -Status "WARN" -Details "Node is missing. Installer can download portable Node.js if internet works."
    }

    $tailscaleVersion = Get-CommandVersion -CommandName "tailscale.exe"
    if ($tailscaleVersion) {
        Add-Check -Name "Tailscale" -Status "PASS" -Details $tailscaleVersion
    } else {
        Add-Check -Name "Tailscale" -Status "WARN" -Details "Tailscale CLI not found. Install and join the company tailnet."
    }

    if (Test-PortFree -Port $ApiPort) {
        Add-Check -Name "API port $ApiPort" -Status "PASS" -Details "Port is free."
    } else {
        Add-Check -Name "API port $ApiPort" -Status "WARN" -Details "Something is already listening on this port."
    }

    foreach ($dir in @($InstallDir, $DataDir)) {
        if (Test-Path $dir) {
            Add-Check -Name "Directory $dir" -Status "PASS" -Details "Exists."
        } else {
            Add-Check -Name "Directory $dir" -Status "WARN" -Details "Will be created by installer."
        }
    }

    foreach ($taskName in @("CompanyControlPlaneApi", "CompanyControlPlaneTelegramBot")) {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($task) {
            Add-Check -Name "Scheduled task $taskName" -Status "PASS" -Details "Exists; state: $($task.State)."
        } else {
            Add-Check -Name "Scheduled task $taskName" -Status "WARN" -Details "Not installed yet."
        }
    }
} catch {
    Add-Check -Name "Preflight" -Status "FAIL" -Details $_.Exception.Message
}

if ($Json) {
    $checks | ConvertTo-Json -Depth 5
    exit
}

Write-Host ""
Write-Host "Company Control Plane Windows Server Preflight"
Write-Host "================================================"

foreach ($check in $checks) {
    $color = "Gray"
    if ($check.status -eq "PASS") {
        $color = "Green"
    } elseif ($check.status -eq "WARN") {
        $color = "Yellow"
    } elseif ($check.status -eq "FAIL") {
        $color = "Red"
    }

    Write-Host ("[{0}] {1}" -f $check.status, $check.name) -ForegroundColor $color
    if ($check.details) {
        Write-Host ("      {0}" -f $check.details)
    }
}

$failed = @($checks | Where-Object { $_.status -eq "FAIL" })
$warnings = @($checks | Where-Object { $_.status -eq "WARN" })

Write-Host ""
Write-Host ("Summary: {0} failed, {1} warnings, {2} total checks." -f $failed.Count, $warnings.Count, $checks.Count)

if ($failed.Count -gt 0) {
    exit 1
}

exit 0
