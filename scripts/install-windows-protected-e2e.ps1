param(
  [ValidateSet('Install', 'Uninstall', 'Status')]
  [string] $Mode = 'Install',

  [string] $BinaryPath = '',

  [switch] $RemoveState,

  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ServiceName = 'NimiRuntimeE2E'
$ServiceAccount = 'NT SERVICE\NimiRuntimeE2E'
$ExpectedServiceSid = 'S-1-5-80-2508001767-432113807-2225235661-2974466524-556849280'
$ExpectedSignerSubject = 'CN=Nimi Local Development Code Signing'
$InstallRoot = Join-Path $env:ProgramFiles 'Nimi E2E\Runtime'
$InstalledBinary = Join-Path $InstallRoot 'nimi-runtime-e2e.exe'
$StateRoot = Join-Path $env:ProgramData 'Nimi\Runtime\E2E'

function Write-Result {
  param([Parameter(Mandatory = $true)] [object] $Value)
  if ($Json) {
    $Value | ConvertTo-Json -Depth 8
  } else {
    $Value | Format-List
  }
}

function Assert-Elevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Installing or removing NimiRuntimeE2E requires an elevated Administrator PowerShell.'
  }
}

function Get-CertificateSha256 {
  param([Parameter(Mandatory = $true)] $Certificate)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha256.ComputeHash($Certificate.RawData))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Get-ServiceRecord {
  return Get-CimInstance Win32_Service -Filter "Name = '$ServiceName'" -ErrorAction SilentlyContinue
}

function Invoke-ServiceControl {
  param(
    [Parameter(Mandatory = $true)]
    [string[]] $Arguments,

    [Parameter(Mandatory = $true)]
    [string] $FailureMessage
  )
  $output = (& sc.exe @Arguments 2>&1 | Out-String).Trim()
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    $detail = if ([string]::IsNullOrWhiteSpace($output)) { '' } else { "`n$output" }
    throw "$FailureMessage (sc.exe exit $exitCode)$detail"
  }
}

function Resolve-ServiceSid {
  if ($null -eq (Get-ServiceRecord)) { return $null }
  $showSid = (& sc.exe showsid $ServiceName | Out-String)
  if ($LASTEXITCODE -ne 0) {
    throw "SCM failed to resolve the service SID for $ServiceName."
  }
  $sidMatch = [regex]::Match($showSid, 'S-1-5-80-(?:\d+-){4}\d+')
  if (-not $sidMatch.Success) { return $null }
  return $sidMatch.Value
}

function Wait-ServiceAbsent {
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    if ($null -eq (Get-ServiceRecord)) { return }
    Start-Sleep -Milliseconds 200
  }
  throw "$ServiceName was not removed by SCM within the timeout."
}

function Wait-ServiceState {
  param([Parameter(Mandatory = $true)] [string] $Expected)
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($null -ne $service -and [string] $service.Status -eq $Expected) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "$ServiceName did not reach $Expected within the timeout."
}

function Import-FixtureSignerForService {
  param([Parameter(Mandatory = $true)] $Certificate)
  $temp = Join-Path ([IO.Path]::GetTempPath()) "nimi-e2e-signer-$($Certificate.Thumbprint).cer"
  try {
    Export-Certificate -Cert $Certificate -FilePath $temp -Force | Out-Null
    foreach ($store in @('Cert:\LocalMachine\Root', 'Cert:\LocalMachine\TrustedPublisher')) {
      $present = Get-ChildItem -Path $store -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $Certificate.Thumbprint } |
        Select-Object -First 1
      if ($null -eq $present) {
        Import-Certificate -FilePath $temp -CertStoreLocation $store | Out-Null
      }
    }
  } finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}

function Set-StateRootAcl {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
  $account = [Security.Principal.NTAccount]::new($ServiceAccount)
  $security = [Security.AccessControl.DirectorySecurity]::new()
  $security.SetAccessRuleProtection($true, $false)
  $security.SetOwner($account)
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $account,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  )
  [void] $security.AddAccessRule($rule)
  Set-Acl -LiteralPath $StateRoot -AclObject $security
}

function Resolve-SourceBinary {
  $candidate = $BinaryPath
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    $candidate = Join-Path (Split-Path $PSScriptRoot -Parent) 'dist\windows-e2e\runtime\nimi-runtime-e2e.exe'
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "Windows E2E Runtime binary is missing: $candidate. Run pnpm build:windows-protected-e2e."
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Assert-FixtureSignature {
  param([Parameter(Mandatory = $true)] [string] $Path)
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
    throw "Windows E2E Runtime signature is not valid: $($signature.StatusMessage)"
  }
  if ($signature.SignerCertificate.Subject -ne $ExpectedSignerSubject) {
    throw "Windows E2E Runtime uses an unexpected signer: $($signature.SignerCertificate.Subject)"
  }
  return $signature.SignerCertificate
}

function Install-Fixture {
  Assert-Elevated
  $source = Resolve-SourceBinary
  $certificate = Assert-FixtureSignature -Path $source
  Import-FixtureSignerForService -Certificate $certificate
  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null

  $existing = Get-ServiceRecord
  if ($null -ne $existing) {
    $service = Get-Service -Name $ServiceName
    if ($service.Status -ne 'Stopped') {
      Invoke-ServiceControl -Arguments @('stop', $ServiceName) -FailureMessage "SCM failed to stop $ServiceName."
      Wait-ServiceState -Expected 'Stopped'
    }
  }
  Copy-Item -LiteralPath $source -Destination $InstalledBinary -Force
  [void] (Assert-FixtureSignature -Path $InstalledBinary)

  $binPath = "`"$InstalledBinary`" serve"
  if ($null -eq $existing) {
    Invoke-ServiceControl -Arguments @(
      'create', $ServiceName,
      'binPath=', $binPath,
      'start=', 'demand',
      'obj=', 'LocalSystem',
      'DisplayName=', 'Nimi Runtime E2E (Non-Product)'
    ) -FailureMessage "SCM creation failed for $ServiceName."
  } else {
    Invoke-ServiceControl -Arguments @(
      'config', $ServiceName,
      'binPath=', $binPath,
      'start=', 'demand',
      'obj=', 'LocalSystem',
      'DisplayName=', 'Nimi Runtime E2E (Non-Product)'
    ) -FailureMessage "SCM configuration failed for $ServiceName."
  }
  Invoke-ServiceControl -Arguments @('sidtype', $ServiceName, 'restricted') -FailureMessage "SCM restricted SID configuration failed for $ServiceName."
  Invoke-ServiceControl -Arguments @('failure', $ServiceName, 'reset=', '86400', 'actions=', 'restart/2000/restart/5000/none/0') -FailureMessage "SCM recovery configuration failed for $ServiceName."

  $resolvedSid = Resolve-ServiceSid
  if ($resolvedSid -ne $ExpectedServiceSid) {
    throw "SCM resolved unexpected service SID for $ServiceName`: $resolvedSid"
  }
  Set-StateRootAcl
  Invoke-ServiceControl -Arguments @('start', $ServiceName) -FailureMessage "SCM failed to start $ServiceName."
  Wait-ServiceState -Expected 'Running'
  $status = Get-FixtureStatus
  if ($status.serviceSid -ne $ExpectedServiceSid -or
      -not $status.restrictedSid -or
      -not $status.binaryPathMatches -or
      $status.signatureStatus -ne 'Valid' -or
      $status.state -ne 'running') {
    throw "$ServiceName failed protected fixture post-install validation."
  }
  return $status
}

function Uninstall-Fixture {
  Assert-Elevated
  $resolvedInstallRoot = [IO.Path]::GetFullPath($InstallRoot)
  $resolvedProgramFiles = [IO.Path]::GetFullPath($env:ProgramFiles).TrimEnd('\') + '\'
  $resolvedStateRoot = [IO.Path]::GetFullPath($StateRoot)
  $resolvedProgramData = [IO.Path]::GetFullPath($env:ProgramData).TrimEnd('\') + '\'
  if (-not $resolvedInstallRoot.StartsWith($resolvedProgramFiles, [StringComparison]::OrdinalIgnoreCase) -or
      -not $resolvedStateRoot.StartsWith($resolvedProgramData, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove Windows E2E paths outside Program Files or ProgramData.'
  }
  $existing = Get-ServiceRecord
  if ($null -ne $existing) {
    $service = Get-Service -Name $ServiceName
    if ($service.Status -ne 'Stopped') {
      Invoke-ServiceControl -Arguments @('stop', $ServiceName) -FailureMessage "SCM failed to stop $ServiceName."
      Wait-ServiceState -Expected 'Stopped'
    }
    Invoke-ServiceControl -Arguments @('delete', $ServiceName) -FailureMessage "SCM failed to delete $ServiceName."
    Wait-ServiceAbsent
  }
  if (Test-Path -LiteralPath $InstallRoot) {
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
  }
  if ($RemoveState -and (Test-Path -LiteralPath $StateRoot)) {
    & takeown.exe /f $StateRoot /a /r /d y | Out-Null
    & icacls.exe $StateRoot /grant '*S-1-5-32-544:(OI)(CI)F' /t /c | Out-Null
    Remove-Item -LiteralPath $StateRoot -Recurse -Force
  }
  return [ordered]@{ serviceName = $ServiceName; state = 'absent'; stateRemoved = [bool] $RemoveState }
}

function Get-FixtureStatus {
  $record = Get-ServiceRecord
  $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  $signature = if (Test-Path -LiteralPath $InstalledBinary -PathType Leaf) {
    Get-AuthenticodeSignature -LiteralPath $InstalledBinary
  } else { $null }
  $sidType = if ($null -ne $record) { (& sc.exe qsidtype $ServiceName | Out-String).Trim() } else { '' }
  $resolvedSid = if ($null -ne $record) { Resolve-ServiceSid } else { $null }
  $expectedBinaryPath = "`"$InstalledBinary`" serve"
  return [ordered]@{
    serviceName = $ServiceName
    state = if ($null -eq $service) { 'absent' } else { ([string] $service.Status).ToLowerInvariant() }
    startMode = if ($null -eq $record) { $null } else { $record.StartMode }
    binaryPath = if ($null -eq $record) { $null } else { $record.PathName }
    binaryPathMatches = $null -ne $record -and $record.PathName -eq $expectedBinaryPath
    serviceSid = $resolvedSid
    expectedServiceSid = $ExpectedServiceSid
    serviceSidMatches = $null -ne $resolvedSid -and $resolvedSid -eq $ExpectedServiceSid
    restrictedSid = $sidType -match 'RESTRICTED'
    stateRoot = $StateRoot
    stateRootExists = Test-Path -LiteralPath $StateRoot -PathType Container
    signatureStatus = if ($null -eq $signature) { 'Missing' } else { [string] $signature.Status }
    signerCertificateSha256 = if ($null -eq $signature -or $null -eq $signature.SignerCertificate) { $null } else { Get-CertificateSha256 -Certificate $signature.SignerCertificate }
    nonProduct = $true
  }
}

try {
  $result = switch ($Mode) {
    'Install' { Install-Fixture }
    'Uninstall' { Uninstall-Fixture }
    'Status' { Get-FixtureStatus }
  }
  Write-Result -Value $result
} catch {
  if ($Json) {
    [Console]::Error.WriteLine(([ordered]@{ status = 'failed'; mode = $Mode; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  } else {
    [Console]::Error.WriteLine($_.Exception.Message)
  }
  exit 1
}
