param(
  [ValidateSet('Install', 'Status')]
  [string] $Mode = 'Install',

  [string] $BinaryPath = '',

  [ValidateSet('production', 'local-development')]
  [string] $DeploymentProfile = 'production',

  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ServiceName = 'NimiRuntime'
$ServiceAccount = 'NT SERVICE\NimiRuntime'
$ExpectedServiceSid = 'S-1-5-80-152272774-1324336204-4147968316-71209937-3548791786'
$ExpectedSignerSubject = 'CN=Nimi Local Development Code Signing'
$InstallRoot = Join-Path $env:ProgramFiles 'Nimi\Runtime'
$StateRoot = Join-Path $env:ProgramData 'Nimi\Runtime\Protected'
$RuntimeInstallationState = Join-Path $StateRoot 'runtime\installation.json'
$DeploymentRealmOrigins = @{
  production = 'https://realm.nimi.ai'
  'local-development' = 'http://127.0.0.1:3002'
}
$DesktopPipeName = 'nimi-runtime-protected-v1'
$LocalAppPipeName = 'nimi-runtime-local-app-v1'
$ExpectedAppIdentityProjectionSha256 = '__BUILD_APP_IDENTITY_PROJECTION_SHA256__'
$ExpectedRuntimeSha256 = '__BUILD_RUNTIME_SHA256__'
$ExpectedRuntimeBuildRecordSha256 = '__BUILD_RUNTIME_RECORD_SHA256__'
$CandidateVersionId = "$ExpectedRuntimeSha256-$ExpectedRuntimeBuildRecordSha256"
$InstalledVersionRoot = Join-Path $InstallRoot "versions\$CandidateVersionId"
$InstalledBinary = Join-Path $InstalledVersionRoot 'nimi.exe'
$ResourcesRoot = Join-Path $InstalledVersionRoot 'resources'
$InstalledAppIdentityProjection = Join-Path $ResourcesRoot 'nimi-app-identity-surfaces.yaml'
$InstalledRuntimeBuildRecord = Join-Path $ResourcesRoot 'runtime-build-record.json'
$RuntimeStartupStages = @{
  42240 = 'unclassified'
  42241 = 'principal'
  42242 = 'signer-policy'
  42243 = 'runtime-process-trust'
  42244 = 'program-data'
  42245 = 'state-root'
  42246 = 'security-state'
  42247 = 'desktop-listener'
  42248 = 'local-app-listener'
  42249 = 'configuration'
  42250 = 'daemon'
  42480 = 'shutdown-timeout'
}

function Write-Result {
  param([Parameter(Mandatory = $true)] [object] $Value)
  if ($Json) { $Value | ConvertTo-Json -Depth 8 } else { $Value | Format-List }
}

function ConvertTo-NativeCommandLineArgument {
  param([Parameter(Mandatory = $true)] [AllowEmptyString()] [string] $Value)
  $quoted = '"'
  $backslashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ([int] $character -eq 92) {
      $backslashes++
      continue
    }
    if ([int] $character -eq 34) {
      if ($backslashes -gt 0) { $quoted += ('\' * ($backslashes * 2)) }
      $quoted += '\"'
      $backslashes = 0
      continue
    }
    if ($backslashes -gt 0) {
      $quoted += ('\' * $backslashes)
      $backslashes = 0
    }
    $quoted += $character
  }
  if ($backslashes -gt 0) { $quoted += ('\' * ($backslashes * 2)) }
  return $quoted + '"'
}

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory = $true)] [string] $FilePath,
    [Parameter(Mandatory = $true)] [string[]] $Arguments
  )
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeCommandLineArgument -Value $_ }) -join ' ')
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw "Unable to start native command: $FilePath" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      StdOut = $stdoutTask.GetAwaiter().GetResult().Trim()
      StdErr = $stderrTask.GetAwaiter().GetResult().Trim()
    }
  } finally {
    $process.Dispose()
  }
}

function Assert-Elevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Installing NimiRuntime requires an elevated Administrator process.'
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

function Assert-SignedFile {
  param([Parameter(Mandatory = $true)] [string] $Path)
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
    throw "Authenticode verification failed for $Path`: $($signature.StatusMessage)"
  }
  if ($signature.SignerCertificate.Subject -ne $ExpectedSignerSubject) {
    throw "Unexpected Nimi signer for $Path`: $($signature.SignerCertificate.Subject)"
  }
  return $signature.SignerCertificate
}

function Resolve-SourceBinary {
  $candidate = $BinaryPath
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    $candidate = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'dist\nimi.exe'
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "Signed production Runtime binary is missing: $candidate"
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Assert-FileSha256 {
  param(
    [Parameter(Mandatory = $true)] [string] $Path,
    [Parameter(Mandatory = $true)] [string] $Expected
  )
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Required signed-installer resource is missing: $Path"
  }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Expected) {
    throw "Signed-installer resource hash mismatch for $Path"
  }
}

function Copy-PlatformResources {
  param([Parameter(Mandatory = $true)] [string] $DestinationRoot)
  $payloadRoot = Join-Path $PSScriptRoot 'resources'
  $sourceAppIdentityProjection = Join-Path $payloadRoot 'nimi-app-identity-surfaces.yaml'
  $sourceRuntimeBuildRecord = Join-Path $payloadRoot 'runtime-build-record.json'
  Assert-FileSha256 -Path $sourceAppIdentityProjection -Expected $ExpectedAppIdentityProjectionSha256
  Assert-FileSha256 -Path $sourceRuntimeBuildRecord -Expected $ExpectedRuntimeBuildRecordSha256
  $destinationResources = Join-Path $DestinationRoot 'resources'
  New-Item -ItemType Directory -Path $destinationResources -Force | Out-Null
  $destinationAppIdentityProjection = Join-Path $destinationResources 'nimi-app-identity-surfaces.yaml'
  $destinationBuildRecord = Join-Path $destinationResources 'runtime-build-record.json'
  Copy-Item -LiteralPath $sourceAppIdentityProjection -Destination $destinationAppIdentityProjection
  Copy-Item -LiteralPath $sourceRuntimeBuildRecord -Destination $destinationBuildRecord
  Assert-FileSha256 -Path $destinationAppIdentityProjection -Expected $ExpectedAppIdentityProjectionSha256
  Assert-FileSha256 -Path $destinationBuildRecord -Expected $ExpectedRuntimeBuildRecordSha256
}

function Read-RuntimeBuildRecord {
  Assert-FileSha256 -Path $InstalledRuntimeBuildRecord -Expected $ExpectedRuntimeBuildRecordSha256
  $record = Get-Content -LiteralPath $InstalledRuntimeBuildRecord -Raw -Encoding UTF8 | ConvertFrom-Json
  $source = $record.source
  $runtime = $record.runtime
  $topLevelKeys = @($record.PSObject.Properties.Name | Sort-Object)
  $sourceKeys = @($source.PSObject.Properties.Name | Sort-Object)
  $runtimeKeys = @($runtime.PSObject.Properties.Name | Sort-Object)
  if (($topLevelKeys -join ',') -ne 'artifactKind,candidateId,generatedAt,runtime,schemaVersion,source' -or
      ($sourceKeys -join ',') -ne 'branch,dirty,dirtyDescriptorSha256,headCommit,repositoryId,sourceTreeSha256,trackedDiffSha256,untrackedFiles' -or
      ($runtimeKeys -join ',') -ne 'binarySha256,signerCertificateSha256' -or
      $record.schemaVersion -ne 1 -or
      $record.artifactKind -ne 'nimi.windows-runtime-service-binary' -or
      $record.candidateId -notmatch '^runtime-[0-9a-f]{32}$' -or
      $source.repositoryId -ne 'nimi' -or
      $source.headCommit -notmatch '^[0-9a-f]{40}$' -or
      $source.dirtyDescriptorSha256 -notmatch '^[0-9a-f]{64}$' -or
      $source.sourceTreeSha256 -notmatch '^[0-9a-f]{64}$' -or
      $runtime.binarySha256 -ne $ExpectedRuntimeSha256 -or
      $runtime.signerCertificateSha256 -notmatch '^[0-9a-f]{64}$') {
    throw 'Installed Runtime build provenance record is invalid.'
  }
  return $record
}

function Assert-InstalledCandidate {
  param([Parameter(Mandatory = $true)] [string] $ExpectedSignerCertificateSha256)
  Assert-FileSha256 -Path $InstalledBinary -Expected $ExpectedRuntimeSha256
  Assert-FileSha256 -Path $InstalledAppIdentityProjection -Expected $ExpectedAppIdentityProjectionSha256
  Assert-FileSha256 -Path $InstalledRuntimeBuildRecord -Expected $ExpectedRuntimeBuildRecordSha256
  $certificate = Assert-SignedFile -Path $InstalledBinary
  if ((Get-CertificateSha256 -Certificate $certificate) -ne $ExpectedSignerCertificateSha256) {
    throw 'Installed Runtime signer does not match the signed installer candidate.'
  }
  $record = Read-RuntimeBuildRecord
  if ($record.runtime.signerCertificateSha256 -ne $ExpectedSignerCertificateSha256) {
    throw 'Installed Runtime build record signer does not match the signed installer candidate.'
  }
}

function Stage-InstallCandidate {
  param(
    [Parameter(Mandatory = $true)] [string] $SourceBinary,
    [Parameter(Mandatory = $true)] [string] $ExpectedSignerCertificateSha256
  )
  if (Test-Path -LiteralPath $InstalledVersionRoot -PathType Container) {
    Assert-InstalledCandidate -ExpectedSignerCertificateSha256 $ExpectedSignerCertificateSha256
    return
  }
  New-Item -ItemType Directory -Path (Split-Path $InstalledVersionRoot -Parent) -Force | Out-Null
  $stagingRoot = Join-Path (Split-Path $InstalledVersionRoot -Parent) (".$CandidateVersionId.staging-" + [Guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Path $stagingRoot | Out-Null
    $stagedBinary = Join-Path $stagingRoot 'nimi.exe'
    Copy-Item -LiteralPath $SourceBinary -Destination $stagedBinary
    Assert-FileSha256 -Path $stagedBinary -Expected $ExpectedRuntimeSha256
    $stagedCertificate = Assert-SignedFile -Path $stagedBinary
    if ((Get-CertificateSha256 -Certificate $stagedCertificate) -ne $ExpectedSignerCertificateSha256) {
      throw 'Staged Runtime signer changed during candidate preparation.'
    }
    Copy-PlatformResources -DestinationRoot $stagingRoot
    Move-Item -LiteralPath $stagingRoot -Destination $InstalledVersionRoot
    Assert-InstalledCandidate -ExpectedSignerCertificateSha256 $ExpectedSignerCertificateSha256
  } finally {
    if (Test-Path -LiteralPath $stagingRoot -PathType Container) {
      $resolvedStaging = (Resolve-Path -LiteralPath $stagingRoot).Path
      $resolvedVersions = (Resolve-Path -LiteralPath (Split-Path $InstalledVersionRoot -Parent)).Path
      if (-not $resolvedStaging.StartsWith(($resolvedVersions.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean staging path outside Runtime versions root: $resolvedStaging"
      }
      Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
  }
}

function Import-SignerForLocalSystem {
  param([Parameter(Mandatory = $true)] $Certificate)
  $temp = Join-Path ([IO.Path]::GetTempPath()) "nimi-runtime-signer-$($Certificate.Thumbprint).cer"
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

function Invoke-ServiceControl {
  param(
    [Parameter(Mandatory = $true)] [string[]] $Arguments,
    [Parameter(Mandatory = $true)] [string] $FailureMessage
  )
  $result = Invoke-NativeCommand -FilePath 'sc.exe' -Arguments $Arguments
  if ($result.ExitCode -ne 0) {
    throw "$FailureMessage (sc.exe exit $($result.ExitCode))`n$($result.StdOut)`n$($result.StdErr)"
  }
}

function Resolve-ServiceSid {
  $result = Invoke-NativeCommand -FilePath 'sc.exe' -Arguments @('showsid', $ServiceName)
  if ($result.ExitCode -ne 0) { return $null }
  $match = [regex]::Match($result.StdOut, 'S-1-5-80-(?:\d+-){4}\d+')
  if ($match.Success) { return $match.Value }
  return $null
}

function Get-ServiceFailureDetail {
  $query = Invoke-NativeCommand -FilePath 'sc.exe' -Arguments @('queryex', $ServiceName)
  $stageMatch = [regex]::Match($query.StdOut, 'SERVICE_EXIT_CODE\s*:\s*(\d+)')
  $stageCode = if ($stageMatch.Success) { [uint32] $stageMatch.Groups[1].Value } else { [uint32] 0 }
  $stageKey = [int] $stageCode
  $stage = if ($RuntimeStartupStages.ContainsKey($stageKey)) { $RuntimeStartupStages[$stageKey] } else { 'unknown' }
  return "runtimeStartupStage=$stage ($stageCode)`n$($query.StdOut)`n$($query.StdErr)"
}

function Wait-ServiceState {
  param([Parameter(Mandatory = $true)] [string] $Expected)
  $deadline = (Get-Date).AddSeconds(35)
  while ((Get-Date) -lt $deadline) {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($null -ne $service -and [string] $service.Status -eq $Expected) { return }
    if ($Expected -eq 'Running' -and $null -ne $service -and [string] $service.Status -eq 'Stopped') {
      throw "$ServiceName stopped during startup.`n$(Get-ServiceFailureDetail)"
    }
    Start-Sleep -Milliseconds 200
  }
  throw "$ServiceName did not reach $Expected within 35 seconds."
}

function Wait-ProtectedPipes {
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    $names = @(Get-ChildItem -LiteralPath '\\.\pipe\' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    if ($names -contains $DesktopPipeName -and $names -contains $LocalAppPipeName) { return }
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($null -eq $service -or [string] $service.Status -eq 'Stopped') {
      throw "$ServiceName stopped before protected pipes became ready.`n$(Get-ServiceFailureDetail)"
    }
    Start-Sleep -Milliseconds 100
  }
  throw "$ServiceName protected pipes were not ready within 20 seconds."
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

function Set-RuntimeInstallationStateAcl {
  if (-not (Test-Path -LiteralPath $RuntimeInstallationState -PathType Leaf)) {
    return
  }
  $account = [Security.Principal.NTAccount]::new($ServiceAccount)
  $security = [Security.AccessControl.FileSecurity]::new()
  $security.SetAccessRuleProtection($true, $false)
  $security.SetOwner($account)
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $account,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow
  )
  [void] $security.AddAccessRule($rule)
  Set-Acl -LiteralPath $RuntimeInstallationState -AclObject $security
}

function Grant-InstallerStateAccess {
  $ownershipChanged = $false
  try {
    $takeOwnership = Invoke-NativeCommand -FilePath 'takeown.exe' -Arguments @('/F', $StateRoot, '/A')
    if ($takeOwnership.ExitCode -ne 0) {
      $initialTakeOwnership = $takeOwnership
      try {
        New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
      } catch {
        throw "Unable to locate or create the Runtime state root before temporary installer ownership.`ninitial takeown:`n$($initialTakeOwnership.StdOut)`n$($initialTakeOwnership.StdErr)`ncreate: $($_.Exception.Message)"
      }
      $takeOwnership = Invoke-NativeCommand -FilePath 'takeown.exe' -Arguments @('/F', $StateRoot, '/A')
      if ($takeOwnership.ExitCode -ne 0) {
        throw "Unable to take temporary installer ownership of the Runtime state root after creation.`n$($takeOwnership.StdOut)`n$($takeOwnership.StdErr)"
      }
    }
    $ownershipChanged = $true
    $grant = Invoke-NativeCommand -FilePath 'icacls.exe' -Arguments @($StateRoot, '/grant:r', '*S-1-5-32-544:(OI)(CI)F')
    if ($grant.ExitCode -ne 0) {
      throw "Unable to acquire temporary installer access to the Runtime state root.`n$($grant.StdOut)`n$($grant.StdErr)"
    }
  } catch {
    $failure = $_
    if ($ownershipChanged) {
      try { Set-StateRootAcl } catch { }
    }
    throw $failure
  }
}

function Grant-InstallerRuntimeInstallationStateAccess {
  if (-not (Test-Path -LiteralPath $RuntimeInstallationState -PathType Leaf)) {
    return $false
  }
  $takeOwnership = Invoke-NativeCommand -FilePath 'takeown.exe' -Arguments @('/F', $RuntimeInstallationState, '/A')
  if ($takeOwnership.ExitCode -ne 0) {
    throw "Unable to take temporary installer ownership of the Runtime installation state.`n$($takeOwnership.StdOut)`n$($takeOwnership.StdErr)"
  }
  $grant = Invoke-NativeCommand -FilePath 'icacls.exe' -Arguments @($RuntimeInstallationState, '/grant:r', '*S-1-5-32-544:F')
  if ($grant.ExitCode -ne 0) {
    throw "Unable to acquire temporary installer access to the Runtime installation state.`n$($grant.StdOut)`n$($grant.StdErr)"
  }
  return $true
}

function Write-RuntimeInstallationState {
  param([Parameter(Mandatory = $true)] [string] $Raw)
  $stream = [IO.FileStream]::new(
    $RuntimeInstallationState,
    [IO.FileMode]::Create,
    [IO.FileAccess]::Write,
    [IO.FileShare]::None
  )
  try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Raw)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally {
    $stream.Dispose()
  }
}

function Set-RuntimeDeploymentProfile {
  if (-not (Test-Path -LiteralPath $RuntimeInstallationState -PathType Leaf)) {
    if ($DeploymentProfile -eq 'production') {
      return $false
    }
    throw 'Installed Runtime state is missing; initialize the fixed production service before selecting local-development.'
  }

  $raw = Get-Content -LiteralPath $RuntimeInstallationState -Raw -Encoding UTF8
  $state = $raw | ConvertFrom-Json
  $keys = @($state.PSObject.Properties.Name | Sort-Object)
  $schemaVersion = [int] $state.schemaVersion
  if ($schemaVersion -eq 1) {
    if (($keys -join ',') -ne 'runtimeId,schemaVersion') {
      throw 'Windows Runtime installation state schema v1 contains unexpected fields.'
    }
  } elseif ($schemaVersion -eq 2) {
    if (($keys -join ',') -ne 'deploymentProfile,realmOrigin,runtimeId,schemaVersion') {
      throw 'Windows Runtime installation state schema v2 contains unexpected fields.'
    }
    $currentProfile = [string] $state.deploymentProfile
    if (-not $DeploymentRealmOrigins.ContainsKey($currentProfile) -or
        [string] $state.realmOrigin -ne $DeploymentRealmOrigins[$currentProfile]) {
      throw 'Windows Runtime installation state contains an invalid deployment profile and Realm origin binding.'
    }
  } else {
    throw 'Windows Runtime installation state schemaVersion must be 1 or 2.'
  }

  $runtimeId = [string] $state.runtimeId
  if ($runtimeId -cnotmatch '^[0-9A-HJKMNP-TV-Z]{26}$') {
    throw 'Windows Runtime installation state runtimeId is invalid.'
  }
  $realmOrigin = $DeploymentRealmOrigins[$DeploymentProfile]
  if ($schemaVersion -eq 2 -and
      [string] $state.deploymentProfile -eq $DeploymentProfile -and
      [string] $state.realmOrigin -eq $realmOrigin) {
    return $false
  }

  $updated = [ordered]@{
    schemaVersion = 2
    runtimeId = $runtimeId
    deploymentProfile = $DeploymentProfile
    realmOrigin = $realmOrigin
  }
  Write-RuntimeInstallationState -Raw (($updated | ConvertTo-Json -Compress) + [Environment]::NewLine)
  return $true
}

function Get-Status {
  $record = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  $sid = if ($null -eq $record) { $null } else { Resolve-ServiceSid }
  $sidTypeResult = if ($null -eq $record) { $null } else { Invoke-NativeCommand -FilePath 'sc.exe' -Arguments @('qsidtype', $ServiceName) }
  $sidType = if ($null -eq $sidTypeResult -or $sidTypeResult.ExitCode -ne 0) { '' } else { $sidTypeResult.StdOut }
  $pipeNames = @(Get-ChildItem -LiteralPath '\\.\pipe\' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
  $signature = if (Test-Path -LiteralPath $InstalledBinary -PathType Leaf) { Get-AuthenticodeSignature -LiteralPath $InstalledBinary } else { $null }
  $runtimeSha256 = if (Test-Path -LiteralPath $InstalledBinary -PathType Leaf) { (Get-FileHash -LiteralPath $InstalledBinary -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
  $runtimeBuildRecordSha256 = if (Test-Path -LiteralPath $InstalledRuntimeBuildRecord -PathType Leaf) { (Get-FileHash -LiteralPath $InstalledRuntimeBuildRecord -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
  $runtimeBuildRecord = if ($runtimeBuildRecordSha256 -eq $ExpectedRuntimeBuildRecordSha256) {
    try { Read-RuntimeBuildRecord } catch { $null }
  } else { $null }
  $expectedPath = "`"$InstalledBinary`" serve"
  return [ordered]@{
    status = if ($null -eq $record) { 'absent' } else { 'present' }
    serviceName = $ServiceName
    state = if ($null -eq $record) { 'absent' } else { ([string] $record.State).ToLowerInvariant() }
    processId = if ($null -eq $record) { 0 } else { [uint32] $record.ProcessId }
    startMode = if ($null -eq $record) { $null } else { [string] $record.StartMode }
    serviceAccount = if ($null -eq $record) { $null } else { [string] $record.StartName }
    serviceAccountMatches = $null -ne $record -and [string] $record.StartName -eq 'LocalSystem'
    binaryPath = if ($null -eq $record) { $null } else { [string] $record.PathName }
    binaryPathMatches = $null -ne $record -and [string] $record.PathName -eq $expectedPath
    serviceSid = $sid
    serviceSidMatches = $sid -eq $ExpectedServiceSid
    restrictedSid = $sidType -match 'RESTRICTED'
    desktopPipePresent = $pipeNames -contains $DesktopPipeName
    localAppPipePresent = $pipeNames -contains $LocalAppPipeName
    stateRoot = $StateRoot
    stateRootExists = Test-Path -LiteralPath $StateRoot -PathType Container
    signatureStatus = if ($null -eq $signature) { 'Missing' } else { [string] $signature.Status }
    signerCertificateSha256 = if ($null -eq $signature -or $null -eq $signature.SignerCertificate) { $null } else { Get-CertificateSha256 -Certificate $signature.SignerCertificate }
    runtimeBinarySha256 = $runtimeSha256
    expectedRuntimeBinarySha256 = $ExpectedRuntimeSha256
    runtimeBinaryMatchesCandidate = $null -ne $runtimeSha256 -and $runtimeSha256 -eq $ExpectedRuntimeSha256
    runtimeBuildRecordSha256 = $runtimeBuildRecordSha256
    expectedRuntimeBuildRecordSha256 = $ExpectedRuntimeBuildRecordSha256
    runtimeBuildRecordMatchesCandidate = $null -ne $runtimeBuildRecord
    runtimeCandidateId = if ($null -eq $runtimeBuildRecord) { $null } else { $runtimeBuildRecord.candidateId }
    sourceDirtyDescriptorSha256 = if ($null -eq $runtimeBuildRecord) { $null } else { $runtimeBuildRecord.source.dirtyDescriptorSha256 }
    sourceTreeSha256 = if ($null -eq $runtimeBuildRecord) { $null } else { $runtimeBuildRecord.source.sourceTreeSha256 }
  }
}

function Install-Service {
  Assert-Elevated
  $installerCertificate = Assert-SignedFile -Path $PSCommandPath
  $source = Resolve-SourceBinary
  Assert-FileSha256 -Path $source -Expected $ExpectedRuntimeSha256
  $runtimeCertificate = Assert-SignedFile -Path $source
  $installerSigner = Get-CertificateSha256 -Certificate $installerCertificate
  $runtimeSigner = Get-CertificateSha256 -Certificate $runtimeCertificate
  if ($installerSigner -ne $runtimeSigner) {
    throw 'Runtime binary and service installer do not share the exact signing identity.'
  }
  Import-SignerForLocalSystem -Certificate $runtimeCertificate
  Stage-InstallCandidate -SourceBinary $source -ExpectedSignerCertificateSha256 $installerSigner

  $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  $existingRecord = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  $previousBinaryPath = if ($null -eq $existingRecord) { $null } else { [string] $existingRecord.PathName }
  $previousStartMode = if ($null -eq $existingRecord) { $null } else { [string] $existingRecord.StartMode }
  $previousWasRunning = $null -ne $existing -and [string] $existing.Status -ne 'Stopped'
  $createdService = $false
  $mutatedService = $false
  $installerStateAccess = $false
  $installationStateAccess = $false
  $deploymentStateChanged = $false
  $previousInstallationState = $null

  try {
    Grant-InstallerStateAccess
    $installerStateAccess = $true

    if ($previousWasRunning) {
      Stop-Service -Name $ServiceName -ErrorAction Stop
      Wait-ServiceState -Expected 'Stopped'
    }
    $installationStateAccess = Grant-InstallerRuntimeInstallationStateAccess
    if (Test-Path -LiteralPath $RuntimeInstallationState -PathType Leaf) {
      $previousInstallationState = Get-Content -LiteralPath $RuntimeInstallationState -Raw -Encoding UTF8
    }
    $deploymentStateChanged = Set-RuntimeDeploymentProfile

    $binaryPathName = "`"$InstalledBinary`" serve"
    if ($null -eq $existing) {
      New-Service -Name $ServiceName -BinaryPathName $binaryPathName -DisplayName 'Nimi Runtime' -Description 'Nimi fixed protected local Runtime service.' -StartupType Automatic | Out-Null
      $createdService = $true
    } else {
      Invoke-ServiceControl -Arguments @('config', $ServiceName, 'binPath=', $binaryPathName, 'start=', 'auto', 'obj=', 'LocalSystem') -FailureMessage 'SCM failed to update the fixed NimiRuntime service definition.'
    }
    $mutatedService = $true
    Invoke-ServiceControl -Arguments @('sidtype', $ServiceName, 'restricted') -FailureMessage 'SCM failed to apply the restricted service SID.'
    Invoke-ServiceControl -Arguments @('failureflag', $ServiceName, '1') -FailureMessage 'SCM failed to enable non-crash recovery.'
    Invoke-ServiceControl -Arguments @('failure', $ServiceName, 'reset=', '86400', 'actions=', 'restart/1000/restart/3000/restart/10000') -FailureMessage 'SCM failed to configure Runtime recovery.'

    $resolvedSid = Resolve-ServiceSid
    if ($resolvedSid -ne $ExpectedServiceSid) {
      throw "SCM resolved unexpected service SID: $resolvedSid"
    }
    Set-RuntimeInstallationStateAcl
    Set-StateRootAcl
    try {
      Start-Service -Name $ServiceName -ErrorAction Stop
    } catch {
      throw "$($_.Exception.Message)`n$(Get-ServiceFailureDetail)"
    }
    Wait-ServiceState -Expected 'Running'
    Wait-ProtectedPipes

    $status = Get-Status
    if (-not $status.serviceAccountMatches -or -not $status.binaryPathMatches -or
        -not $status.serviceSidMatches -or -not $status.restrictedSid -or
        -not $status.desktopPipePresent -or -not $status.localAppPipePresent -or
        -not $status.runtimeBinaryMatchesCandidate -or
        -not $status.runtimeBuildRecordMatchesCandidate -or
        $status.signatureStatus -ne 'Valid' -or $status.state -ne 'running') {
      throw 'NimiRuntime failed post-install fixed-service validation.'
    }
    $status['installerSignerCertificateSha256'] = $installerSigner
    $status['stateAclConfiguredBySignedInstaller'] = $true
    $status['atomicVersionRoot'] = $InstalledVersionRoot
    $status['deploymentProfile'] = $DeploymentProfile
    $status['realmOrigin'] = $DeploymentRealmOrigins[$DeploymentProfile]
    return $status
  } catch {
    $installFailure = $_
    $rollbackFailures = [System.Collections.Generic.List[string]]::new()
    try {
      $current = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
      if ($null -ne $current -and [string] $current.Status -ne 'Stopped') {
        Stop-Service -Name $ServiceName -ErrorAction Stop
        Wait-ServiceState -Expected 'Stopped'
      }
    } catch {
      $rollbackFailures.Add("stop failed candidate service: $($_.Exception.Message)")
    }
    if ($createdService) {
      try {
        Invoke-ServiceControl -Arguments @('delete', $ServiceName) -FailureMessage 'SCM failed to remove the failed new NimiRuntime service.'
      } catch {
        $rollbackFailures.Add("remove failed new service: $($_.Exception.Message)")
      }
    } elseif ($mutatedService -and -not [string]::IsNullOrWhiteSpace($previousBinaryPath)) {
      try {
        $previousStart = switch ($previousStartMode) {
          'Auto' { 'auto' }
          'Manual' { 'demand' }
          'Disabled' { 'disabled' }
          default { 'demand' }
        }
        Invoke-ServiceControl -Arguments @('config', $ServiceName, 'binPath=', $previousBinaryPath, 'start=', $previousStart, 'obj=', 'LocalSystem') -FailureMessage 'SCM failed to restore the previous NimiRuntime service definition.'
      } catch {
        $rollbackFailures.Add("restore previous service definition: $($_.Exception.Message)")
      }
    }
    if ($installerStateAccess) {
      if ($installationStateAccess) {
        try {
          Grant-InstallerStateAccess
          Grant-InstallerRuntimeInstallationStateAccess
          if ($deploymentStateChanged -and $null -ne $previousInstallationState) {
            Write-RuntimeInstallationState -Raw $previousInstallationState
          }
          Set-RuntimeInstallationStateAcl
        } catch {
          $rollbackFailures.Add("restore Runtime installation state custody: $($_.Exception.Message)")
        }
      }
      try {
        Set-StateRootAcl
      } catch {
        $rollbackFailures.Add("restore protected state ownership: $($_.Exception.Message)")
      }
    }
    if (-not $createdService -and $previousWasRunning) {
      try {
        Start-Service -Name $ServiceName -ErrorAction Stop
        Wait-ServiceState -Expected 'Running'
      } catch {
        $rollbackFailures.Add("restart previous service: $($_.Exception.Message)")
      }
    }
    $rollbackDetail = if ($rollbackFailures.Count -eq 0) { 'rollback completed' } else { 'rollback failures: ' + ($rollbackFailures -join '; ') }
    throw "NimiRuntime install failed: $($installFailure.Exception.Message) ($rollbackDetail)"
  }
}

if ($MyInvocation.InvocationName -eq '.') {
  return
}

try {
  $result = switch ($Mode) {
    'Install' { Install-Service }
    'Status' { Get-Status }
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
