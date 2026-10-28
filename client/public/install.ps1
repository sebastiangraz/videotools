# Installs the videotools engine into ~\.videotools, starts it, and starts it
# with Windows from then on. Run again to update.
#
#   irm https://videotools-client.vercel.app/install.ps1 | iex
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$dir = Join-Path $HOME ".videotools"
$exe = Join-Path $dir "videotools-engine.exe"
New-Item -ItemType Directory -Force $dir | Out-Null

Get-Process videotools-engine -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "Downloading the videotools engine..."
Invoke-WebRequest "https://github.com/sebastiangraz/videotools/releases/download/engine/videotools-engine-win32-x64.exe" -OutFile $exe

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Startup")) "videotools engine.lnk"))
$link.TargetPath = $exe
$link.WorkingDirectory = $dir
$link.WindowStyle = 7 # minimized
$link.Save()

Start-Process $exe -WorkingDirectory $dir -WindowStyle Minimized
Write-Host "The videotools engine is running (minimized) and starts with Windows. Back to the browser!"
