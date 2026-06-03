param(
    [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path,
    [string]$OutputDir = (Join-Path (Resolve-Path "$PSScriptRoot\..").Path "dist"),
    [string]$InstallerName = "CompanyControlPlaneInstaller.exe"
)

$ErrorActionPreference = "Stop"

function Copy-ProjectPayload {
    param(
        [string]$From,
        [string]$To
    )

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

function Copy-NodeRuntime {
    param([string]$PayloadRoot)

    $node = Get-Command node.exe -ErrorAction Stop
    $runtimeDir = Join-Path $PayloadRoot "runtime"
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    Copy-Item -Force -LiteralPath $node.Source -Destination (Join-Path $runtimeDir "node.exe")
    return $node.Source
}

function Write-Bootstrap {
    param([string]$BootstrapPath)

    @'
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$payloadZip = Join-Path $here "payload.zip"
$extractRoot = Join-Path $env:TEMP ("CompanyControlPlaneInstaller-" + [guid]::NewGuid().ToString("N"))

New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
Expand-Archive -Force -Path $payloadZip -DestinationPath $extractRoot

$installer = Join-Path $extractRoot "scripts\install-windows.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -SourceRoot $extractRoot -InstallTelegramBot -OpenSetupWizard

Write-Host ""
Write-Host "Installed. Setup wizard should open automatically."
Write-Host "Manual setup URL: http://127.0.0.1:3099/setup"
Write-Host "Press Enter to close."
[void][Console]::ReadLine()
'@ | Set-Content -Encoding UTF8 -Path $BootstrapPath
}

function Write-IExpressSed {
    param(
        [string]$SedPath,
        [string]$PackageDir,
        [string]$TargetExe
    )

    @"
[Version]
Class=IEXPRESS
SEDVersion=3

[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles

[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$TargetExe
FriendlyName=Company Control Plane Installer
AppLaunched=powershell.exe -NoProfile -ExecutionPolicy Bypass -File install-from-payload.ps1
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
FILE0=payload.zip
FILE1=install-from-payload.ps1

[SourceFiles]
SourceFiles0=$PackageDir

[SourceFiles0]
%FILE0%=
%FILE1%=
"@ | Set-Content -Encoding ASCII -Path $SedPath
}

function Wait-InstallerFile {
    param(
        [string]$TargetExe,
        [int]$TimeoutSeconds = 120,
        [int64]$MinBytes = 1048576
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastLength = -1
    $stableReads = 0
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $TargetExe) {
            $item = Get-Item $TargetExe
            if ($item.Length -ge $MinBytes -and $item.Length -eq $lastLength) {
                $stableReads += 1
            } else {
                $stableReads = 0
            }
            $lastLength = $item.Length
            if ($stableReads -ge 3) {
                return $true
            }
        }
        Start-Sleep -Seconds 1
    }
    return $false
}

$resolvedProjectRoot = (Resolve-Path $ProjectRoot).Path
$resolvedOutputDir = New-Item -ItemType Directory -Force -Path $OutputDir
$stagingRoot = Join-Path $resolvedOutputDir.FullName "windows-installer-staging"
$payloadRoot = Join-Path $stagingRoot "payload"
$packageDir = Join-Path $stagingRoot "package"
$payloadZip = Join-Path $packageDir "payload.zip"
$bootstrapPath = Join-Path $packageDir "install-from-payload.ps1"
$sedPath = Join-Path $packageDir "installer.sed"
$targetExe = Join-Path $resolvedOutputDir.FullName $InstallerName

if (Test-Path $stagingRoot) {
    Remove-Item -Recurse -Force -LiteralPath $stagingRoot
}
New-Item -ItemType Directory -Force -Path $payloadRoot, $packageDir | Out-Null

Copy-ProjectPayload -From $resolvedProjectRoot -To $payloadRoot
$nodePath = Copy-NodeRuntime -PayloadRoot $payloadRoot

if (Test-Path $payloadZip) {
    Remove-Item -Force -LiteralPath $payloadZip
}
Compress-Archive -Force -Path (Join-Path $payloadRoot "*") -DestinationPath $payloadZip
Write-Bootstrap -BootstrapPath $bootstrapPath
Write-IExpressSed -SedPath $sedPath -PackageDir $packageDir -TargetExe $targetExe

$iexpress = Get-Command iexpress.exe -ErrorAction Stop
& $iexpress.Source /N /Q $sedPath

if (-not (Wait-InstallerFile -TargetExe $targetExe)) {
    throw "IExpress did not create installer: $targetExe"
}

Write-Host "Built installer: $targetExe"
Write-Host "Bundled Node: $nodePath"
