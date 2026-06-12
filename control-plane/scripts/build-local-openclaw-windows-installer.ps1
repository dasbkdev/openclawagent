param(
    [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path,
    [string]$OutputDir = (Join-Path (Resolve-Path "$PSScriptRoot\..").Path "public\downloads"),
    [string]$InstallerName = "starlab-openclaw-agent-windows.exe",
    [string]$ControlPlaneUrl = "https://starlabagent.pp.ua"
)

$ErrorActionPreference = "Stop"

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

function Copy-AgentPayload {
    param(
        [string]$From,
        [string]$To
    )

    $include = @(
        "src\device-agent.js",
        "package.json",
        "scripts\install-local-openclaw-windows.ps1"
    )

    foreach ($relative in $include) {
        $source = Join-Path $From $relative
        $target = Join-Path $To $relative
        New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
        Copy-Item -Force -LiteralPath $source -Destination $target
    }
}

function Write-Bootstrap {
    param(
        [string]$BootstrapPath,
        [string]$Url
    )

@"
`$ErrorActionPreference = "Stop"

`$here = Split-Path -Parent `$MyInvocation.MyCommand.Path
`$payloadZip = Join-Path `$here "payload.zip"
`$extractRoot = Join-Path `$env:TEMP ("StarlabOpenClawInstaller-" + [guid]::NewGuid().ToString("N"))

New-Item -ItemType Directory -Force -Path `$extractRoot | Out-Null
Expand-Archive -Force -Path `$payloadZip -DestinationPath `$extractRoot

`$installer = Join-Path `$extractRoot "scripts\install-local-openclaw-windows.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `$installer -SourceRoot `$extractRoot -ControlPlaneUrl "$Url" -StartNow

Write-Host ""
Write-Host "Installed Starlab OpenClaw Agent."
Write-Host "Activation page: http://127.0.0.1:4157"
Write-Host "Press Enter to close."
[void][Console]::ReadLine()
"@ | Set-Content -Encoding UTF8 -Path $BootstrapPath
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
FriendlyName=Starlab OpenClaw Agent Installer
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

$resolvedProjectRoot = (Resolve-Path $ProjectRoot).Path
$resolvedOutputDir = New-Item -ItemType Directory -Force -Path $OutputDir
$stagingRoot = Join-Path $resolvedOutputDir.FullName "windows-local-agent-staging"
$payloadRoot = Join-Path $stagingRoot "payload"
$packageDir = Join-Path $stagingRoot "package"
$payloadZip = Join-Path $packageDir "payload.zip"
$bootstrapPath = Join-Path $packageDir "install-from-payload.ps1"
$sedPath = Join-Path $packageDir "installer.sed"
$targetExe = Join-Path $resolvedOutputDir.FullName $InstallerName

Remove-Item -Recurse -Force -LiteralPath $stagingRoot -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $payloadRoot, $packageDir | Out-Null

Copy-AgentPayload -From $resolvedProjectRoot -To $payloadRoot
Compress-Archive -Force -Path (Join-Path $payloadRoot "*") -DestinationPath $payloadZip
Write-Bootstrap -BootstrapPath $bootstrapPath -Url $ControlPlaneUrl
Write-IExpressSed -SedPath $sedPath -PackageDir $packageDir -TargetExe $targetExe

$iexpress = Get-Command iexpress.exe -ErrorAction Stop
& $iexpress.Source /N /Q $sedPath

for ($i = 0; $i -lt 60 -and -not (Test-Path $targetExe); $i++) {
    Start-Sleep -Seconds 1
}

if (-not (Test-Path $targetExe)) {
    throw "IExpress did not create installer: $targetExe"
}

Write-Host "Built installer: $targetExe"
