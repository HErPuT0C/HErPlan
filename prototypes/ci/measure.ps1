# Installs a prototype silently, measures it, runs the canvas autobench and uninstalls it.
# Usage: measure.ps1 -Name tauri -Installer path\to\setup.exe -DisplayName "HErPlan Proto Tauri" -OutDir results
param(
  [Parameter(Mandatory)] [string] $Name,
  [Parameter(Mandatory)] [string] $Installer,
  [Parameter(Mandatory)] [string] $DisplayName,
  [Parameter(Mandatory)] [string] $OutDir
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$result = [ordered]@{ name = $Name; installerMB = [math]::Round((Get-Item $Installer).Length / 1MB, 1) }

function Find-UninstallEntry {
  Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.DisplayName -like "$DisplayName*" } |
    Select-Object -First 1
}

function Get-ProcessTree([int] $RootId) {
  $all = Get-CimInstance Win32_Process
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void] $ids.Add($RootId)
  do {
    $added = $false
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { [void] $ids.Add([int]$p.ProcessId); $added = $true }
    }
  } while ($added)
  $ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
}

# 1. Silent per-user install.
$sw = [Diagnostics.Stopwatch]::StartNew()
Start-Process -FilePath $Installer -ArgumentList '/S' -Wait
$result.installSeconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
$entry = Find-UninstallEntry
if (-not $entry) { throw "Uninstall entry for '$DisplayName' not found after install" }
# UninstallString is either "C:\path with spaces\uninstall.exe" [/args] or an unquoted path.
$us = $entry.UninstallString
if ($us -match '^"([^"]+)"') { $uninstaller = $Matches[1] } else { $uninstaller = ($us -split ' /')[0] }
$installDir = if ($entry.InstallLocation) { $entry.InstallLocation.Trim('"') } else { Split-Path $uninstaller -Parent }
$exe = Get-ChildItem -Path $installDir -Filter *.exe | Where-Object { $_.Name -notmatch '^(un|Uninstall)' } | Select-Object -First 1
$result.installDir = $installDir
$result.installedMB = [math]::Round(((Get-ChildItem $installDir -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)

# 2. Startup time until the main window exists, then idle memory of the whole process tree.
$sw.Restart()
$proc = Start-Process -FilePath $exe.FullName -PassThru
while ($sw.Elapsed.TotalSeconds -lt 60) {
  $proc.Refresh()
  if ($proc.MainWindowHandle -ne 0) { break }
  Start-Sleep -Milliseconds 50
}
$result.windowMs = [int] $sw.Elapsed.TotalMilliseconds
Start-Sleep -Seconds 10
$tree = Get-ProcessTree $proc.Id
$result.processes = @($tree).Count
$result.idleWorkingSetMB = [math]::Round((($tree | Measure-Object WorkingSet64 -Sum).Sum) / 1MB, 1)
$result.idlePrivateMB = [math]::Round((($tree | Measure-Object PrivateMemorySize64 -Sum).Sum) / 1MB, 1)
$tree | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 3. Canvas autobench (software rendering on CI runners: compare shells, not absolute numbers).
$reportPath = Join-Path (Resolve-Path $OutDir) "$Name-autobench.json"
$env:HERPLAN_REPORT_PATH = $reportPath
$bench = Start-Process -FilePath $exe.FullName -ArgumentList '--autobench' -PassThru
if (-not $bench.WaitForExit(300000)) { Get-ProcessTree $bench.Id | Stop-Process -Force; $result.autobench = 'timeout' }
elseif (Test-Path $reportPath) {
  $report = Get-Content $reportPath -Raw | ConvertFrom-Json
  $result.autobench = @($report.results | ForEach-Object { [ordered]@{ renderer = $_.renderer; avgFps = $_.overall.avgFps; p95FrameMs = $_.overall.p95FrameMs } })
} else { $result.autobench = 'no report' }
Remove-Item Env:HERPLAN_REPORT_PATH
Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($installDir) } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 4. Silent uninstall; the install directory must be gone.
Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait
Start-Sleep -Seconds 5
$result.uninstallRemovedExe = -not (Test-Path $exe.FullName)
$result.uninstallEntryRemoved = -not (Find-UninstallEntry)

$result | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $OutDir "$Name.json")
$result | ConvertTo-Json -Depth 5
