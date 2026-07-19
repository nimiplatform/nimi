param(
  [ValidateSet('Install', 'Status')]
  [string] $Mode = 'Install',

  [string] $BinaryPath = '',

  [switch] $DevKernelCheckpoint,

  [string] $DevelopmentDataRoot = '',

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
$DesktopPipeName = 'nimi-runtime-protected-v1'
$LocalAppPipeName = 'nimi-runtime-local-app-v1'
$ExpectedRegistrySha256 = '__BUILD_REGISTRY_SHA256__'
$ExpectedReleaseDescriptorsSha256 = '__BUILD_RELEASE_DESCRIPTORS_SHA256__'
$ExpectedDevKernelFixtureSha256 = '__BUILD_DEV_KERNEL_FIXTURE_SHA256__'
$ExpectedRuntimeSha256 = '__BUILD_RUNTIME_SHA256__'
$ExpectedRuntimeBuildRecordSha256 = '__BUILD_RUNTIME_RECORD_SHA256__'
$CandidateVersionId = "$ExpectedRuntimeSha256-$ExpectedRuntimeBuildRecordSha256"
$InstalledVersionRoot = Join-Path $InstallRoot "versions\$CandidateVersionId"
$InstalledBinary = Join-Path $InstalledVersionRoot 'nimi.exe'
$ResourcesRoot = Join-Path $InstalledVersionRoot 'resources'
$InstalledRegistry = Join-Path $ResourcesRoot 'nimi-app-registry.yaml'
$InstalledReleaseDescriptors = Join-Path $ResourcesRoot 'nimi-app-release-descriptors.yaml'
$InstalledDevKernelFixture = Join-Path $ResourcesRoot 'dev-kernel-checkpoint-acceptance.json'
$InstalledRuntimeBuildRecord = Join-Path $ResourcesRoot 'runtime-build-record.json'
$AcceptanceProfilePath = Join-Path $StateRoot 'runtime\non-release-acceptance-profile.json'
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
  42249 = 'fixture-custody'
  42250 = 'configuration'
  42251 = 'daemon'
  42480 = 'shutdown-timeout'
}

if (-not $DevKernelCheckpoint -and -not [string]::IsNullOrWhiteSpace($DevelopmentDataRoot)) {
  throw 'DevelopmentDataRoot is admitted only with DevKernelCheckpoint.'
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
  $sourceRegistry = Join-Path $payloadRoot 'nimi-app-registry.yaml'
  $sourceDescriptors = Join-Path $payloadRoot 'nimi-app-release-descriptors.yaml'
  $sourceDevKernelFixture = Join-Path $payloadRoot 'dev-kernel-checkpoint-acceptance.json'
  $sourceRuntimeBuildRecord = Join-Path $payloadRoot 'runtime-build-record.json'
  Assert-FileSha256 -Path $sourceRegistry -Expected $ExpectedRegistrySha256
  Assert-FileSha256 -Path $sourceDescriptors -Expected $ExpectedReleaseDescriptorsSha256
  Assert-FileSha256 -Path $sourceDevKernelFixture -Expected $ExpectedDevKernelFixtureSha256
  Assert-FileSha256 -Path $sourceRuntimeBuildRecord -Expected $ExpectedRuntimeBuildRecordSha256
  $destinationResources = Join-Path $DestinationRoot 'resources'
  New-Item -ItemType Directory -Path $destinationResources -Force | Out-Null
  $destinationRegistry = Join-Path $destinationResources 'nimi-app-registry.yaml'
  $destinationDescriptors = Join-Path $destinationResources 'nimi-app-release-descriptors.yaml'
  $destinationFixture = Join-Path $destinationResources 'dev-kernel-checkpoint-acceptance.json'
  $destinationBuildRecord = Join-Path $destinationResources 'runtime-build-record.json'
  Copy-Item -LiteralPath $sourceRegistry -Destination $destinationRegistry
  Copy-Item -LiteralPath $sourceDescriptors -Destination $destinationDescriptors
  Copy-Item -LiteralPath $sourceDevKernelFixture -Destination $destinationFixture
  Copy-Item -LiteralPath $sourceRuntimeBuildRecord -Destination $destinationBuildRecord
  Assert-FileSha256 -Path $destinationRegistry -Expected $ExpectedRegistrySha256
  Assert-FileSha256 -Path $destinationDescriptors -Expected $ExpectedReleaseDescriptorsSha256
  Assert-FileSha256 -Path $destinationFixture -Expected $ExpectedDevKernelFixtureSha256
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
  if (($topLevelKeys -join ',') -ne 'artifactKind,candidateId,checkpoint,generatedAt,nonRelease,runtime,schemaVersion,source' -or
      ($sourceKeys -join ',') -ne 'branch,dirty,dirtyDescriptorSha256,headCommit,repositoryId,sourceTreeSha256,trackedDiffSha256,untrackedFiles' -or
      ($runtimeKeys -join ',') -ne 'binarySha256,signerCertificateSha256' -or
      $record.schemaVersion -ne 1 -or
      $record.artifactKind -ne 'nimi.windows-runtime-service-binary' -or
      $record.checkpoint -ne 'dev_kernel_checkpoint' -or
      $record.nonRelease -ne $true -or
      $record.candidateId -notmatch '^dev-kernel-runtime-[0-9a-f]{32}$' -or
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
  Assert-FileSha256 -Path $InstalledRegistry -Expected $ExpectedRegistrySha256
  Assert-FileSha256 -Path $InstalledReleaseDescriptors -Expected $ExpectedReleaseDescriptorsSha256
  Assert-FileSha256 -Path $InstalledDevKernelFixture -Expected $ExpectedDevKernelFixtureSha256
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

function Read-DevKernelCheckpointFixture {
  Assert-FileSha256 -Path $InstalledDevKernelFixture -Expected $ExpectedDevKernelFixtureSha256
  $fixture = Get-Content -LiteralPath $InstalledDevKernelFixture -Raw -Encoding UTF8 | ConvertFrom-Json
  $agent = $fixture.agent
  if ($fixture.schemaVersion -ne 2 -or
      $fixture.authorityClass -ne 'non_authoritative_acceptance_fixture' -or
      $fixture.checkpoint -ne 'dev_kernel_checkpoint' -or
      $fixture.nonRelease -ne $true -or
      $fixture.trialId -notmatch '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$' -or
      $fixture.accountRealmBaseUrl -ne 'http://localhost:3002' -or
      $fixture.accountWebBaseUrl -ne 'http://localhost:3000' -or
      $fixture.fixtureBaseUrl -ne 'http://127.0.0.1:19443' -or
      $fixture.providerBaseUrl -ne ($fixture.fixtureBaseUrl + '/v1') -or
      [string]::IsNullOrWhiteSpace($fixture.primaryAccountId) -or
      [string]::IsNullOrWhiteSpace($fixture.secondaryAccountId) -or
      $fixture.primaryAccountId -eq $fixture.secondaryAccountId -or
      $agent.localAgentRef -notmatch '^local-agent:runtime-[0-9a-f]{32}$' -or
      [string]::IsNullOrWhiteSpace($agent.runtimeSourceRef) -or
      [string]::IsNullOrWhiteSpace($agent.displayName)) {
    throw 'Signed dev-kernel checkpoint fixture is invalid.'
  }
  return $fixture
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

function Grant-InstallerStateAccess {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
  $ownershipChanged = $false
  try {
    $takeOwnership = Invoke-NativeCommand -FilePath 'takeown.exe' -Arguments @('/F', $StateRoot, '/A')
    if ($takeOwnership.ExitCode -ne 0) {
      throw "Unable to take temporary installer ownership of the Runtime state root.`n$($takeOwnership.StdOut)`n$($takeOwnership.StdErr)"
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

function New-DevKernelAcceptanceRoundId {
  [byte[]] $bytes = New-Object byte[] 16
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  $hex = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  return "dev-kernel-round-$hex"
}

function Resolve-ValidatedDevelopmentDataRoot {
  param([Parameter(Mandatory = $true)] [AllowEmptyString()] [string] $Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
  if ($Value -ne $Value.Trim()) {
    throw 'DevelopmentDataRoot must be an absolute non-volume-root directory.'
  }
  $inputRoot = [IO.Path]::GetPathRoot($Value)
  if ([string]::IsNullOrWhiteSpace($inputRoot) -or
      $inputRoot -eq '\' -or
      $inputRoot -match '^[A-Za-z]:$') {
    throw 'DevelopmentDataRoot must be an absolute non-volume-root directory.'
  }
  $item = Get-Item -LiteralPath $Value -Force -ErrorAction Stop
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'DevelopmentDataRoot must be an existing non-reparse directory.'
  }
  $resolved = $item.FullName.TrimEnd('\')
  if ([string]::IsNullOrWhiteSpace($resolved) -or $resolved -eq [IO.Path]::GetPathRoot($resolved)) {
    throw 'DevelopmentDataRoot must be an absolute non-volume-root directory.'
  }
  $volumeRoot = [IO.Path]::GetPathRoot($resolved)
  $current = $volumeRoot
  foreach ($segment in $resolved.Substring($volumeRoot.Length).Split(@('\'), [StringSplitOptions]::RemoveEmptyEntries)) {
    $current = Join-Path -Path $current -ChildPath $segment
    $component = Get-Item -LiteralPath $current -Force -ErrorAction Stop
    if (-not $component.PSIsContainer -or ($component.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'DevelopmentDataRoot path components must be existing non-reparse directories.'
    }
  }
  return $resolved
}

function Read-ExistingDevKernelCheckpointProfile {
  if (-not (Test-Path -LiteralPath $AcceptanceProfilePath -PathType Leaf)) {
    return $null
  }
  try {
    $previous = Get-Content -LiteralPath $AcceptanceProfilePath -Raw | ConvertFrom-Json
  } catch {
    throw "Existing protected acceptance profile cannot be decoded: $($_.Exception.Message)"
  }
  $schemaVersion = [int] $previous.schemaVersion
  if (($schemaVersion -ne 4 -and $schemaVersion -ne 5) -or $previous.checkpoint -ne 'dev_kernel_checkpoint' -or $previous.nonRelease -ne $true) {
    throw 'Existing protected acceptance profile identity is invalid.'
  }
  return $previous
}

function Assert-DevKernelStateLineageIdentifier {
  param(
    [Parameter(Mandatory = $true)] [string] $Value,
    [Parameter(Mandatory = $true)] [string] $Prefix,
    [Parameter(Mandatory = $true)] [string] $Label
  )
  if ($Value -notmatch ('^' + [regex]::Escape($Prefix) + '[0-9a-f]{32}$')) {
    throw "Existing protected acceptance profile $Label is invalid."
  }
}

function Resolve-DevKernelCheckpointStateLineage {
  param(
    [AllowNull()] [object] $PreviousProfile,
    [Parameter(Mandatory = $true)] [string] $CurrentCandidateId,
    [Parameter(Mandatory = $true)] [string] $TrialId
  )
  if ($null -eq $PreviousProfile) {
    return [ordered]@{
      developmentStateCandidateId = $CurrentCandidateId
      acceptanceRoundId = New-DevKernelAcceptanceRoundId
      authority = 'signed_installer_new_development_state_lineage'
    }
  }
  if ([string] $PreviousProfile.trialId -ne $TrialId) {
    throw 'Existing protected acceptance profile trial identity changed.'
  }
  $stateCandidateId = if ([int] $PreviousProfile.schemaVersion -eq 5) {
    [string] $PreviousProfile.developmentStateCandidateId
  } else {
    [string] $PreviousProfile.runtimeCandidateId
  }
  $acceptanceRoundId = [string] $PreviousProfile.acceptanceRoundId
  Assert-DevKernelStateLineageIdentifier -Value $stateCandidateId -Prefix 'dev-kernel-runtime-' -Label 'developmentStateCandidateId'
  Assert-DevKernelStateLineageIdentifier -Value $acceptanceRoundId -Prefix 'dev-kernel-round-' -Label 'acceptanceRoundId'
  return [ordered]@{
    developmentStateCandidateId = $stateCandidateId
    acceptanceRoundId = $acceptanceRoundId
    authority = 'signed_installer_preserved_development_state_lineage'
  }
}

function Resolve-DevKernelCheckpointDataRootBinding {
  param([AllowNull()] [object] $PreviousProfile)
  if (-not [string]::IsNullOrWhiteSpace($DevelopmentDataRoot)) {
    return [ordered]@{
      path = Resolve-ValidatedDevelopmentDataRoot -Value $DevelopmentDataRoot
      authority = 'signed_installer_explicit_operator_selection'
    }
  }
  if ($null -eq $PreviousProfile) {
    throw 'An explicit validated development data-root selection is required for the first dev-kernel service installation.'
  }
  $preserved = Resolve-ValidatedDevelopmentDataRoot -Value ([string] $PreviousProfile.developmentDataRootRef)
  if ([string]::IsNullOrWhiteSpace($preserved)) {
    throw 'Existing protected acceptance profile has no validated development data-root selection.'
  }
  return [ordered]@{
    path = $preserved
    authority = 'signed_installer_preserved_operator_selection'
  }
}

function Write-DevKernelCheckpointProfile {
  param([Parameter(Mandatory = $true)] [string] $SignerCertificateSha256)
  if (-not $DevKernelCheckpoint) {
    if (Test-Path -LiteralPath $AcceptanceProfilePath -PathType Leaf) {
      Remove-Item -LiteralPath $AcceptanceProfilePath -Force
    }
    return $null
  }
  $fixture = Read-DevKernelCheckpointFixture
  $buildRecord = Read-RuntimeBuildRecord
  $previousProfile = Read-ExistingDevKernelCheckpointProfile
  $stateLineage = Resolve-DevKernelCheckpointStateLineage -PreviousProfile $previousProfile -CurrentCandidateId $buildRecord.candidateId -TrialId $fixture.trialId
  $developmentDataRootBinding = Resolve-DevKernelCheckpointDataRootBinding -PreviousProfile $previousProfile
  $resolvedDevelopmentDataRoot = [string] $developmentDataRootBinding.path
  $runtimeRoot = Split-Path $AcceptanceProfilePath -Parent
  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  $profile = [ordered]@{
    schemaVersion = 5
    checkpoint = 'dev_kernel_checkpoint'
    nonRelease = $true
    trialId = $fixture.trialId
    runtimeCandidateId = $buildRecord.candidateId
    developmentStateCandidateId = [string] $stateLineage.developmentStateCandidateId
    acceptanceRoundId = [string] $stateLineage.acceptanceRoundId
    developmentDataRootRef = $resolvedDevelopmentDataRoot
    accountRealmBaseUrl = $fixture.accountRealmBaseUrl
    fixtureBaseUrl = $fixture.fixtureBaseUrl
    providerBaseUrl = $fixture.providerBaseUrl
    primaryAccountId = $fixture.primaryAccountId
    secondaryAccountId = $fixture.secondaryAccountId
    localAgentRef = $fixture.agent.localAgentRef
    runtimeSourceRef = $fixture.agent.runtimeSourceRef
    agentDisplayName = $fixture.agent.displayName
    expiresAt = (Get-Date).ToUniversalTime().AddHours(24).ToString('yyyy-MM-ddTHH:mm:ssZ')
    signerCertificateSha256 = $SignerCertificateSha256
    runtimeBinarySha256 = $ExpectedRuntimeSha256
    runtimeBuildRecordSha256 = $ExpectedRuntimeBuildRecordSha256
    sourceDirtyDescriptorSha256 = $buildRecord.source.dirtyDescriptorSha256
    sourceTreeSha256 = $buildRecord.source.sourceTreeSha256
  }
  $temporary = "$AcceptanceProfilePath.tmp"
  [IO.File]::WriteAllText($temporary, (($profile | ConvertTo-Json -Depth 4) + "`n"), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $AcceptanceProfilePath -Force
  $developmentDataRootBinding['developmentStateCandidateId'] = [string] $stateLineage.developmentStateCandidateId
  $developmentDataRootBinding['acceptanceRoundId'] = [string] $stateLineage.acceptanceRoundId
  $developmentDataRootBinding['stateLineageAuthority'] = [string] $stateLineage.authority
  $developmentDataRootBinding['trialId'] = [string] $fixture.trialId
  return $developmentDataRootBinding
}

function Get-DevKernelServiceConfigPath {
  param([Parameter(Mandatory = $true)] [Collections.IDictionary] $DevelopmentBinding)
  return Join-Path $StateRoot (Join-Path 'acceptance-runs' (Join-Path ([string] $DevelopmentBinding.trialId) (Join-Path ([string] $DevelopmentBinding.developmentStateCandidateId) (Join-Path ([string] $DevelopmentBinding.acceptanceRoundId) 'runtime\config.json'))))
}

function Sync-DevKernelServiceDataRootConfig {
  param(
    [Parameter(Mandatory = $true)] [string] $ConfigPath,
    [Parameter(Mandatory = $true)] [string] $DevelopmentDataRoot
  )
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { return $false }
  $configItem = Get-Item -LiteralPath $ConfigPath -Force -ErrorAction Stop
  if (($configItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $configItem.PSIsContainer) {
    throw 'Existing service-owned Runtime config must be a direct regular file.'
  }
  try {
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  } catch {
    throw "Existing service-owned Runtime config cannot be decoded: $($_.Exception.Message)"
  }
  if ($null -eq $config -or $config -is [Array] -or [int] $config.schemaVersion -ne 1) {
    throw 'Existing service-owned Runtime config identity is invalid.'
  }
  $managedRoots = [ordered]@{
    models = Join-Path $DevelopmentDataRoot 'models'
    dependencies = Join-Path $DevelopmentDataRoot 'dependencies'
    environments = Join-Path $DevelopmentDataRoot 'environments'
    logs = Join-Path $DevelopmentDataRoot 'logs'
    audit = Join-Path $DevelopmentDataRoot 'audit'
  }
  $unchanged = [string] $config.dataRootRef -eq $DevelopmentDataRoot -and
    $null -ne $config.managedRoots -and
    [string] $config.managedRoots.models -eq $managedRoots.models -and
    [string] $config.managedRoots.dependencies -eq $managedRoots.dependencies -and
    [string] $config.managedRoots.environments -eq $managedRoots.environments -and
    [string] $config.managedRoots.logs -eq $managedRoots.logs -and
    [string] $config.managedRoots.audit -eq $managedRoots.audit
  if ($unchanged) { return $false }
  $config | Add-Member -NotePropertyName dataRootRef -NotePropertyValue $DevelopmentDataRoot -Force
  $config | Add-Member -NotePropertyName managedRoots -NotePropertyValue ([pscustomobject] $managedRoots) -Force
  $temporary = "$ConfigPath.installer-$PID.tmp"
  [IO.File]::WriteAllText($temporary, (($config | ConvertTo-Json -Depth 20) + "`n"), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $ConfigPath -Force
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
  $checkpointCandidateVerified = $null -ne $runtimeBuildRecord -and
    $runtimeBuildRecord.nonRelease -eq $true -and
    $runtimeBuildRecord.checkpoint -eq 'dev_kernel_checkpoint' -and
    $runtimeBuildRecord.runtime.binarySha256 -eq $runtimeSha256
  $acceptanceProfile = try {
    if (Test-Path -LiteralPath $AcceptanceProfilePath -PathType Leaf) {
      Get-Content -LiteralPath $AcceptanceProfilePath -Raw | ConvertFrom-Json
    } else { $null }
  } catch { $null }
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
    runtimeBuildRecordMatchesCandidate = $runtimeBuildRecordSha256 -eq $ExpectedRuntimeBuildRecordSha256
    runtimeCandidateId = if ($null -eq $runtimeBuildRecord) { $null } else { $runtimeBuildRecord.candidateId }
    sourceDirtyDescriptorSha256 = if ($null -eq $runtimeBuildRecord) { $null } else { $runtimeBuildRecord.source.dirtyDescriptorSha256 }
    sourceTreeSha256 = if ($null -eq $runtimeBuildRecord) { $null } else { $runtimeBuildRecord.source.sourceTreeSha256 }
    nonProductCandidate = $true
    checkpointCandidatePostureVerified = $checkpointCandidateVerified
    checkpointReleasePosture = if ($checkpointCandidateVerified) { 'non_release' } else { 'unverified' }
    checkpointProductClosePromotion = if ($checkpointCandidateVerified) { 'non_promotable_to_product_close' } else { 'unverified' }
    developmentDataRootRef = if ($null -eq $acceptanceProfile) { $null } else { [string] $acceptanceProfile.developmentDataRootRef }
    developmentStateCandidateId = if ($null -eq $acceptanceProfile) {
      $null
    } elseif ([int] $acceptanceProfile.schemaVersion -eq 5) {
      [string] $acceptanceProfile.developmentStateCandidateId
    } elseif ([int] $acceptanceProfile.schemaVersion -eq 4) {
      [string] $acceptanceProfile.runtimeCandidateId
    } else {
      $null
    }
    acceptanceRoundId = if ($null -eq $acceptanceProfile) { $null } else { [string] $acceptanceProfile.acceptanceRoundId }
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
  $previousProfilePresent = $false
  [byte[]] $previousProfileBytes = $null
  $developmentConfigPath = $null
  $previousDevelopmentConfigPresent = $false
  [byte[]] $previousDevelopmentConfigBytes = $null
  $developmentConfigMutated = $false

  try {
    if ($previousWasRunning) {
      Stop-Service -Name $ServiceName -ErrorAction Stop
      Wait-ServiceState -Expected 'Stopped'
    }

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
    Grant-InstallerStateAccess
    $installerStateAccess = $true
    if (Test-Path -LiteralPath $AcceptanceProfilePath -PathType Leaf) {
      $previousProfileBytes = [IO.File]::ReadAllBytes($AcceptanceProfilePath)
      $previousProfilePresent = $true
    }
    $developmentDataRootBinding = Write-DevKernelCheckpointProfile -SignerCertificateSha256 $installerSigner
    if ($DevKernelCheckpoint) {
      $developmentConfigPath = Get-DevKernelServiceConfigPath -DevelopmentBinding $developmentDataRootBinding
      if (Test-Path -LiteralPath $developmentConfigPath -PathType Leaf) {
        $previousDevelopmentConfigBytes = [IO.File]::ReadAllBytes($developmentConfigPath)
        $previousDevelopmentConfigPresent = $true
      }
      $developmentConfigMutated = Sync-DevKernelServiceDataRootConfig -ConfigPath $developmentConfigPath -DevelopmentDataRoot ([string] $developmentDataRootBinding.path)
    }
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
        -not $status.checkpointCandidatePostureVerified -or
        $status.signatureStatus -ne 'Valid' -or $status.state -ne 'running' -or
        ($DevKernelCheckpoint -and $status.checkpointReleasePosture -ne 'non_release')) {
      throw 'NimiRuntime failed post-install fixed-service validation.'
    }
    $status['installerSignerCertificateSha256'] = $installerSigner
    $status['stateAclConfiguredBySignedInstaller'] = $true
    $status['atomicVersionRoot'] = $InstalledVersionRoot
    $status['checkpointProfileRuntimeValidated'] = [bool] $DevKernelCheckpoint
    if ($DevKernelCheckpoint) {
      $boundDevelopmentDataRoot = [string] $developmentDataRootBinding.path
      $status['developmentDataRootRef'] = if ([string]::IsNullOrWhiteSpace($boundDevelopmentDataRoot)) { $null } else { $boundDevelopmentDataRoot }
      $status['developmentDataRootAuthority'] = [string] $developmentDataRootBinding.authority
      $status['developmentDataRootDisposition'] = 'runtime_validated_development_payload_root'
      $status['developmentStateCandidateId'] = [string] $developmentDataRootBinding.developmentStateCandidateId
      $status['acceptanceRoundId'] = [string] $developmentDataRootBinding.acceptanceRoundId
      $status['developmentStateLineageAuthority'] = [string] $developmentDataRootBinding.stateLineageAuthority
      $status['developmentServiceConfigSynchronized'] = [bool] $developmentConfigMutated
    }
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
      try {
        Grant-InstallerStateAccess
        if ($previousProfilePresent) {
          $restoreTemporary = "$AcceptanceProfilePath.rollback"
          [IO.File]::WriteAllBytes($restoreTemporary, $previousProfileBytes)
          Move-Item -LiteralPath $restoreTemporary -Destination $AcceptanceProfilePath -Force
        } elseif (Test-Path -LiteralPath $AcceptanceProfilePath -PathType Leaf) {
          Remove-Item -LiteralPath $AcceptanceProfilePath -Force
        }
        if (-not [string]::IsNullOrWhiteSpace($developmentConfigPath)) {
          if ($previousDevelopmentConfigPresent) {
            $configRestoreTemporary = "$developmentConfigPath.rollback"
            [IO.File]::WriteAllBytes($configRestoreTemporary, $previousDevelopmentConfigBytes)
            Move-Item -LiteralPath $configRestoreTemporary -Destination $developmentConfigPath -Force
          } elseif ($developmentConfigMutated -and (Test-Path -LiteralPath $developmentConfigPath -PathType Leaf)) {
            Remove-Item -LiteralPath $developmentConfigPath -Force
          }
        }
        Set-StateRootAcl
      } catch {
        $rollbackFailures.Add("restore protected acceptance profile: $($_.Exception.Message)")
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
