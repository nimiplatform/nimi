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
$ServiceHostAccount = 'LocalSystem'
$ServiceDisplayName = 'Nimi Runtime E2E (Non-Product)'
$ExpectedServiceSid = 'S-1-5-80-2508001767-432113807-2225235661-2974466524-556849280'
$ExpectedSignerSubject = 'CN=Nimi Local Development Code Signing'
$InstallRoot = Join-Path $env:ProgramFiles 'Nimi E2E\Runtime'
$InstalledBinary = Join-Path $InstallRoot 'nimi-runtime-e2e.exe'
$StateRoot = Join-Path $env:ProgramData 'Nimi\Runtime\E2E'
$RuntimeStartupStages = @{
  42240 = 'unclassified'
  42241 = 'principal'
  42242 = 'signer-policy'
  42243 = 'runtime-process-trust'
  42244 = 'program-data'
  42245 = 'state-root'
  42246 = 'security-state'
  42247 = 'desktop-listener'
  42248 = 'installed-listener'
  42249 = 'fixture-custody'
  42250 = 'configuration'
  42251 = 'daemon'
  42497 = 'principal-input'
  42498 = 'principal-scm-open'
  42499 = 'principal-service-name'
  42500 = 'principal-service-open'
  42501 = 'principal-service-config'
  42502 = 'principal-service-status'
  42503 = 'principal-process-binding'
  42504 = 'principal-sid-resolution'
  42505 = 'principal-token-open'
  42506 = 'principal-token-user-query'
  42507 = 'principal-token-groups-query'
  42508 = 'principal-restricted-sids-query'
  42509 = 'principal-token-session-query'
  42510 = 'principal-token-type-query'
  42511 = 'principal-token-restricted-query'
  42512 = 'principal-resolved-sid'
  42513 = 'principal-service-sid-type'
  42514 = 'principal-interactive-service'
  42515 = 'principal-primary-token'
  42516 = 'principal-session-zero'
  42517 = 'principal-restricted-token'
  42518 = 'principal-service-sid-group'
  42519 = 'principal-restricted-sid-list'
  42520 = 'principal-service-logon-group'
  42521 = 'principal-interactive-group'
  42522 = 'principal-token-user'
  42523 = 'principal-service-host-account'
  42753 = 'process-principal-revalidation'
  42754 = 'process-principal-binding'
  42755 = 'process-isolation-harden'
  42756 = 'process-open'
  42757 = 'process-isolation-validation'
  42758 = 'process-token-open'
  42759 = 'process-token-user-query'
  42760 = 'process-token-user-match'
  42761 = 'process-session-query'
  42762 = 'process-session-zero'
  42763 = 'process-logon-luid'
  42764 = 'process-creation-marker'
  42765 = 'process-executable-input'
  42766 = 'process-executable-path'
  42767 = 'process-executable-path-encoding'
  42768 = 'process-executable-lock'
  42769 = 'process-executable-handle'
  42770 = 'process-executable-file-type'
  42771 = 'process-executable-identity'
  42772 = 'process-executable-hash'
  42773 = 'process-executable-context'
  42774 = 'process-executable-trust-record'
  42775 = 'process-executable-trust-set'
  42776 = 'process-liveness-query'
  42777 = 'process-liveness-state'
  42778 = 'process-tuple'
  43009 = 'security-context'
  43010 = 'security-principal-capability'
  43011 = 'security-process-capability'
  43012 = 'security-process-binding'
  43013 = 'security-root-capability'
  43014 = 'security-secret-root'
  43015 = 'security-dpapi-protector'
  43016 = 'security-service-sid'
  43017 = 'security-ledger-path'
  43018 = 'security-secret-store'
  43019 = 'security-pipe-opener'
  43020 = 'security-anchor-store'
  43021 = 'security-record-mac-key'
  43022 = 'security-ledger-open'
  43023 = 'security-boot-epoch'
  43024 = 'security-desktop-sessions'
  43025 = 'security-lifecycle-intents'
  43026 = 'security-installed-launches'
  43027 = 'security-desktop-pipe-open'
  43028 = 'security-desktop-pipe-missing'
  43029 = 'security-desktop-identity'
  43265 = 'custody-secret-name'
  43266 = 'custody-store-capability'
  43267 = 'custody-state-root'
  43268 = 'custody-read-open'
  43269 = 'custody-read-identity'
  43270 = 'custody-read-acl'
  43271 = 'custody-read-wrapper'
  43272 = 'custody-read'
  43273 = 'custody-read-close'
  43274 = 'custody-decode'
  43275 = 'custody-descriptor-inspect'
  43276 = 'custody-unprotect'
  43277 = 'custody-plaintext'
  43278 = 'custody-protect-input'
  43279 = 'custody-descriptor-encode'
  43280 = 'custody-descriptor-create'
  43281 = 'custody-protect'
  43282 = 'custody-temporary-name'
  43283 = 'custody-temporary-create'
  43284 = 'custody-temporary-acl'
  43285 = 'custody-temporary-wrapper'
  43286 = 'custody-temporary-write'
  43287 = 'custody-temporary-flush'
  43288 = 'custody-temporary-close'
  43289 = 'custody-temporary-path'
  43290 = 'custody-destination-path'
  43291 = 'custody-atomic-replace'
  43292 = 'custody-stored-reopen'
  43293 = 'custody-stored-identity'
  43294 = 'custody-stored-acl'
  43295 = 'custody-delete-open'
  43296 = 'custody-delete-acl'
  43297 = 'custody-delete-close'
  43298 = 'custody-delete'
}

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

function New-FixtureService {
  param([Parameter(Mandatory = $true)] [string] $BinaryPathName)
  try {
    $service = New-Service `
      -Name $ServiceName `
      -BinaryPathName $BinaryPathName `
      -DisplayName $ServiceDisplayName `
      -StartupType Manual `
      -Description 'Isolated non-product Nimi protected Runtime fixture.'
    if ($null -eq $service) {
      throw 'New-Service returned no service record.'
    }
  } catch {
    throw "SCM creation failed for $ServiceName`: $($_.Exception.Message)"
  }
}

function Update-FixtureService {
  param(
    [Parameter(Mandatory = $true)] $ServiceRecord,
    [Parameter(Mandatory = $true)] [string] $BinaryPathName
  )
  try {
    $result = Invoke-CimMethod -InputObject $ServiceRecord -MethodName Change -Arguments @{
      DesktopInteract = $false
      DisplayName = $ServiceDisplayName
      ErrorControl = [byte] 1
      PathName = $BinaryPathName
      ServiceType = [byte] 16
      StartMode = 'Manual'
      StartName = $ServiceHostAccount
    }
  } catch {
    throw "SCM configuration failed for $ServiceName`: $($_.Exception.Message)"
  }
  if ($null -eq $result -or [uint32] $result.ReturnValue -ne 0) {
    $returnValue = if ($null -eq $result) { 'missing' } else { [string] $result.ReturnValue }
    throw "SCM configuration failed for $ServiceName (Win32_Service.Change return $returnValue)."
  }
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
    if ($Expected -eq 'Running' -and $null -ne $service -and [string] $service.Status -eq 'Stopped') {
      throw "$ServiceName stopped before reaching Running.`n$(Get-ServiceFailureDetail)"
    }
    Start-Sleep -Milliseconds 250
  }
  throw "$ServiceName did not reach $Expected within the timeout.`n$(Get-ServiceFailureDetail)"
}

function Get-ServiceFailureDetail {
  $query = (& sc.exe queryex $ServiceName 2>&1 | Out-String).Trim()
  $stageMatch = [regex]::Match($query, 'SERVICE_EXIT_CODE\s*:\s*(\d+)')
  $stageCode = if ($stageMatch.Success) { [uint32] $stageMatch.Groups[1].Value } else { [uint32] 0 }
  $stageKey = [int] $stageCode
  $stage = if ($RuntimeStartupStages.ContainsKey($stageKey)) { $RuntimeStartupStages[$stageKey] } else { 'unknown' }
  return "runtimeStartupStage=$stage ($stageCode)`n$query"
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
    New-FixtureService -BinaryPathName $binPath
  } else {
    Update-FixtureService -ServiceRecord $existing -BinaryPathName $binPath
  }
  Invoke-ServiceControl -Arguments @('sidtype', $ServiceName, 'restricted') -FailureMessage "SCM restricted SID configuration failed for $ServiceName."
  Invoke-ServiceControl -Arguments @('failure', $ServiceName, 'reset=', '0', 'actions=', 'none/0') -FailureMessage "SCM failed to disable recovery during validation for $ServiceName."

  $resolvedSid = Resolve-ServiceSid
  if ($resolvedSid -ne $ExpectedServiceSid) {
    throw "SCM resolved unexpected service SID for $ServiceName`: $resolvedSid"
  }
  Set-StateRootAcl
  Invoke-ServiceControl -Arguments @('start', $ServiceName) -FailureMessage "SCM failed to start $ServiceName."
  Wait-ServiceState -Expected 'Running'
  Invoke-ServiceControl -Arguments @('failure', $ServiceName, 'reset=', '86400', 'actions=', 'restart/2000/restart/5000/none/0') -FailureMessage "SCM recovery configuration failed for $ServiceName."
  $status = Get-FixtureStatus
  if ($status.serviceSid -ne $ExpectedServiceSid -or
      -not $status.restrictedSid -or
      -not $status.binaryPathMatches -or
      -not $status.serviceAccountMatches -or
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
  $pipeNames = @(Get-ChildItem -LiteralPath '\\.\pipe\' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
  return [ordered]@{
    serviceName = $ServiceName
    state = if ($null -eq $service) { 'absent' } else { ([string] $service.Status).ToLowerInvariant() }
    processId = if ($null -eq $record) { 0 } else { [uint32] $record.ProcessId }
    serviceExitCode = if ($null -eq $record) { 0 } else { [uint32] $record.ExitCode }
    startMode = if ($null -eq $record) { $null } else { $record.StartMode }
    binaryPath = if ($null -eq $record) { $null } else { $record.PathName }
    binaryPathMatches = $null -ne $record -and $record.PathName -eq $expectedBinaryPath
    serviceAccount = if ($null -eq $record) { $null } else { $record.StartName }
    serviceAccountMatches = $null -ne $record -and $record.StartName -eq $ServiceHostAccount
    serviceSid = $resolvedSid
    expectedServiceSid = $ExpectedServiceSid
    serviceSidMatches = $null -ne $resolvedSid -and $resolvedSid -eq $ExpectedServiceSid
    restrictedSid = $sidType -match 'RESTRICTED'
    desktopPipePresent = $pipeNames -contains 'nimi-runtime-e2e-protected-v1'
    installedPipePresent = $pipeNames -contains 'nimi-runtime-e2e-installed-v1'
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
