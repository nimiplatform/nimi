$ErrorActionPreference = "Stop"

function Resolve-EdgeRuntimeVersion {
  $programFiles = [Environment]::GetEnvironmentVariable("ProgramFiles")
  $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $edgeWebViewRoots = @(
    (Join-Path $programFilesX86 "Microsoft\EdgeWebView\Application"),
    (Join-Path $programFiles "Microsoft\EdgeWebView\Application")
  ) | Where-Object { $_ -and (Test-Path $_) }
  $edgeWebViewCandidates = $edgeWebViewRoots | ForEach-Object {
    Get-ChildItem -Path $_ -Recurse -Filter "msedgewebview2.exe" -ErrorAction SilentlyContinue
  } | ForEach-Object { $_.FullName }
  $edgeCandidates = @(
    (Join-Path $programFilesX86 "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $programFiles "Microsoft\Edge\Application\msedge.exe")
  )
  $candidates = @()
  $candidates += @($edgeWebViewCandidates)
  $candidates += @($edgeCandidates)
  $candidates = $candidates | Where-Object { $_ -and (Test-Path $_) }

  foreach ($candidate in $candidates) {
    $version = (Get-Item $candidate).VersionInfo.ProductVersion
    if ($version -and $version.Trim()) {
      Write-Host "[install-matching-msedgedriver] edge_runtime=$candidate version=$version"
      return $version.Trim()
    }
  }

  throw "Unable to resolve installed Edge/WebView2 runtime version."
}

$edgeVersion = Resolve-EdgeRuntimeVersion
$runnerTemp = $env:RUNNER_TEMP
if (-not $runnerTemp) {
  $runnerTemp = [System.IO.Path]::GetTempPath()
}

$driverRoot = Join-Path $runnerTemp "nimi-msedgedriver-$edgeVersion"
$zipPath = Join-Path $driverRoot "edgedriver_win64.zip"
$downloadUrl = "https://msedgedriver.microsoft.com/$edgeVersion/edgedriver_win64.zip"

if (Test-Path $driverRoot) {
  Remove-Item -Recurse -Force $driverRoot
}
New-Item -ItemType Directory -Force -Path $driverRoot | Out-Null

Write-Host "[install-matching-msedgedriver] download=$downloadUrl"
Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath
Expand-Archive -Path $zipPath -DestinationPath $driverRoot -Force

$driver = Get-ChildItem -Path $driverRoot -Recurse -Filter "msedgedriver.exe" | Select-Object -First 1
if (-not $driver) {
  throw "msedgedriver.exe not found after extracting $zipPath"
}

$driverDir = $driver.Directory.FullName
$driverVersion = & $driver.FullName --version
Write-Host "[install-matching-msedgedriver] driver=$($driver.FullName)"
Write-Host "[install-matching-msedgedriver] $driverVersion"

if ($env:GITHUB_PATH) {
  Add-Content -Path $env:GITHUB_PATH -Value $driverDir
}
if ($env:GITHUB_OUTPUT) {
  Add-Content -Path $env:GITHUB_OUTPUT -Value "msedgedriver_path=$($driver.FullName)"
}
