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
$ExpectedServiceSid = 'S-1-5-80-152272774-1324336204-4147968316-71209937-3548791786'
$ExpectedSignerSubject = 'CN=Nimi Local Development Code Signing'
$InstallRoot = Join-Path $env:ProgramFiles 'Nimi\Runtime'
$StateRoot = Join-Path $env:ProgramData 'Nimi\Runtime\Protected'
$RuntimeStateRoot = Join-Path $StateRoot 'runtime'
$RuntimeInstallationState = Join-Path $RuntimeStateRoot 'installation.json'
$RuntimeDatabase = Join-Path $RuntimeStateRoot 'memory.db'
$BundledLocalAgentChatRepairHelper = Join-Path $PSScriptRoot 'resources\repair-local-agent-chat.exe'
$DeploymentRealmOrigins = @{
  production = 'https://realm.nimi.ai'
  'local-development' = 'http://127.0.0.1:3002'
}
$DesktopPipeName = 'nimi-runtime-protected-v1'
$LocalAppPipeName = 'nimi-runtime-local-app-v1'
$ExpectedAppIdentityProjectionSha256 = '__BUILD_APP_IDENTITY_PROJECTION_SHA256__'
$ExpectedRuntimeSha256 = '__BUILD_RUNTIME_SHA256__'
$ExpectedRuntimeBuildRecordSha256 = '__BUILD_RUNTIME_RECORD_SHA256__'
$ExpectedLocalAgentChatRepairSha256 = '__BUILD_LOCAL_AGENT_CHAT_REPAIR_SHA256__'
$CandidateVersionId = '__BUILD_INSTALLER_CANDIDATE_VERSION_ID__'
$InstalledVersionRoot = Join-Path $InstallRoot "versions\$CandidateVersionId"
$InstalledBinary = Join-Path $InstalledVersionRoot 'nimi.exe'
$ResourcesRoot = Join-Path $InstalledVersionRoot 'resources'
$InstalledAppIdentityProjection = Join-Path $ResourcesRoot 'nimi-app-identity-surfaces.yaml'
$InstalledRuntimeBuildRecord = Join-Path $ResourcesRoot 'runtime-build-record.json'
$InstalledLocalAgentChatRepairHelper = Join-Path $ResourcesRoot 'repair-local-agent-chat.exe'
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
  param(
    [Parameter(Mandatory = $true)] [string] $DestinationRoot,
    [Parameter(Mandatory = $true)] [string] $ExpectedSignerCertificateSha256
  )
  $payloadRoot = Join-Path $PSScriptRoot 'resources'
  $sourceAppIdentityProjection = Join-Path $payloadRoot 'nimi-app-identity-surfaces.yaml'
  $sourceRuntimeBuildRecord = Join-Path $payloadRoot 'runtime-build-record.json'
  $sourceLocalAgentChatRepairHelper = Join-Path $payloadRoot 'repair-local-agent-chat.exe'
  Assert-FileSha256 -Path $sourceAppIdentityProjection -Expected $ExpectedAppIdentityProjectionSha256
  Assert-FileSha256 -Path $sourceRuntimeBuildRecord -Expected $ExpectedRuntimeBuildRecordSha256
  Assert-LocalAgentChatRepairHelper -Path $sourceLocalAgentChatRepairHelper -ExpectedSignerCertificateSha256 $ExpectedSignerCertificateSha256
  $destinationResources = Join-Path $DestinationRoot 'resources'
  New-Item -ItemType Directory -Path $destinationResources -Force | Out-Null
  $destinationAppIdentityProjection = Join-Path $destinationResources 'nimi-app-identity-surfaces.yaml'
  $destinationBuildRecord = Join-Path $destinationResources 'runtime-build-record.json'
  $destinationLocalAgentChatRepairHelper = Join-Path $destinationResources 'repair-local-agent-chat.exe'
  Copy-Item -LiteralPath $sourceAppIdentityProjection -Destination $destinationAppIdentityProjection
  Copy-Item -LiteralPath $sourceRuntimeBuildRecord -Destination $destinationBuildRecord
  Copy-Item -LiteralPath $sourceLocalAgentChatRepairHelper -Destination $destinationLocalAgentChatRepairHelper
  Assert-FileSha256 -Path $destinationAppIdentityProjection -Expected $ExpectedAppIdentityProjectionSha256
  Assert-FileSha256 -Path $destinationBuildRecord -Expected $ExpectedRuntimeBuildRecordSha256
  Assert-LocalAgentChatRepairHelper -Path $destinationLocalAgentChatRepairHelper -ExpectedSignerCertificateSha256 $ExpectedSignerCertificateSha256
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
  Assert-LocalAgentChatRepairHelper -Path $InstalledLocalAgentChatRepairHelper -ExpectedSignerCertificateSha256 $ExpectedSignerCertificateSha256
  $certificate = Assert-SignedFile -Path $InstalledBinary
  if ((Get-CertificateSha256 -Certificate $certificate) -ne $ExpectedSignerCertificateSha256) {
    throw 'Installed Runtime signer does not match the signed installer candidate.'
  }
  $record = Read-RuntimeBuildRecord
  if ($record.runtime.signerCertificateSha256 -ne $ExpectedSignerCertificateSha256) {
    throw 'Installed Runtime build record signer does not match the signed installer candidate.'
  }
}

function Assert-LocalAgentChatRepairHelper {
  param(
    [Parameter(Mandatory = $true)] [string] $Path,
    [Parameter(Mandatory = $true)] [string] $ExpectedSignerCertificateSha256
  )
  Assert-FileSha256 -Path $Path -Expected $ExpectedLocalAgentChatRepairSha256
  $certificate = Assert-SignedFile -Path $Path
  if ((Get-CertificateSha256 -Certificate $certificate) -ne $ExpectedSignerCertificateSha256) {
    throw 'LocalAgent chat repair helper signer does not match the signed installer.'
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
    Copy-PlatformResources -DestinationRoot $stagingRoot -ExpectedSignerCertificateSha256 $ExpectedSignerCertificateSha256
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

function Resolve-InstalledVersionRootFromServicePath {
  param([AllowNull()] [string] $ServiceBinaryPath)
  if ([string]::IsNullOrWhiteSpace($ServiceBinaryPath)) { return $null }
  $match = [regex]::Match($ServiceBinaryPath, '^\s*"([^"]+)"(?:\s|$)')
  if (-not $match.Success) { return $null }
  $binary = [IO.Path]::GetFullPath($match.Groups[1].Value)
  if ([IO.Path]::GetFileName($binary) -ne 'nimi.exe') { return $null }
  $candidateRoot = [IO.Path]::GetFullPath((Split-Path $binary -Parent)).TrimEnd('\')
  $versionsRoot = [IO.Path]::GetFullPath((Join-Path $InstallRoot 'versions')).TrimEnd('\')
  $candidateParent = [IO.Path]::GetFullPath((Split-Path $candidateRoot -Parent)).TrimEnd('\')
  if (-not [string]::Equals($candidateParent, $versionsRoot, [StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }
  return $candidateRoot
}

function Remove-StaleInstalledVersions {
  param([string[]] $KeepRoots = @())
  $versionsPath = Join-Path $InstallRoot 'versions'
  if (-not (Test-Path -LiteralPath $versionsPath -PathType Container)) { return @() }
  $resolvedVersions = (Resolve-Path -LiteralPath $versionsPath).Path.TrimEnd('\')
  $keep = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($root in $KeepRoots) {
    if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) {
      continue
    }
    $resolvedKeep = (Resolve-Path -LiteralPath $root).Path.TrimEnd('\')
    $keepParent = [IO.Path]::GetFullPath((Split-Path $resolvedKeep -Parent)).TrimEnd('\')
    if (-not [string]::Equals($keepParent, $resolvedVersions, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to retain Runtime version outside the versions root: $resolvedKeep"
    }
    [void] $keep.Add($resolvedKeep)
  }

  $removed = [System.Collections.Generic.List[string]]::new()
  foreach ($directory in Get-ChildItem -LiteralPath $resolvedVersions -Directory) {
    if (($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Refusing to remove Runtime version through a reparse point: $($directory.FullName)"
    }
    $resolvedCandidate = (Resolve-Path -LiteralPath $directory.FullName).Path.TrimEnd('\')
    $candidateParent = [IO.Path]::GetFullPath((Split-Path $resolvedCandidate -Parent)).TrimEnd('\')
    if (-not [string]::Equals($candidateParent, $resolvedVersions, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove Runtime version outside the versions root: $resolvedCandidate"
    }
    if ($keep.Contains($resolvedCandidate)) { continue }
    Remove-Item -LiteralPath $resolvedCandidate -Recurse -Force
    $removed.Add($directory.Name)
  }
  return $removed.ToArray()
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

function New-ServiceOnlyDirectorySecurity {
  $account = [Security.Principal.SecurityIdentifier]::new($ExpectedServiceSid)
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
  Assert-ServiceOnlySecurityDescriptor -Security $security -Directory
  return $security
}

function New-ServiceOnlyFileSecurity {
  $account = [Security.Principal.SecurityIdentifier]::new($ExpectedServiceSid)
  $security = [Security.AccessControl.FileSecurity]::new()
  $security.SetAccessRuleProtection($true, $false)
  $security.SetOwner($account)
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $account,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow
  )
  [void] $security.AddAccessRule($rule)
  Assert-ServiceOnlySecurityDescriptor -Security $security
  return $security
}

function Assert-ServiceOnlySecurityDescriptor {
  param(
    [Parameter(Mandatory = $true)] $Security,
    [switch] $Directory
  )
  if (-not $Security.AreAccessRulesProtected) {
    throw 'Constructed Runtime custody DACL must be protected.'
  }
  $owner = $Security.GetOwner([Security.Principal.SecurityIdentifier])
  if ($null -eq $owner -or $owner.Value -ne $ExpectedServiceSid) {
    throw 'Constructed Runtime custody owner must be the exact service SID.'
  }
  $rules = @($Security.GetAccessRules(
    $true,
    $true,
    [Security.Principal.SecurityIdentifier]
  ))
  if ($rules.Count -ne 1) {
    throw 'Constructed Runtime custody DACL must contain exactly one service ACE.'
  }
  $rule = $rules[0]
  $expectedInheritance = if ($Directory) {
    [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  } else {
    [Security.AccessControl.InheritanceFlags]::None
  }
  if ($rule.IdentityReference.Value -ne $ExpectedServiceSid -or
      $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
      $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
      $rule.InheritanceFlags -ne $expectedInheritance -or
      $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None -or
      $rule.IsInherited) {
    throw 'Constructed Runtime custody DACL must grant only exact service FullControl.'
  }
}

function Set-StateRootAcl {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
  $attributes = [IO.File]::GetAttributes($StateRoot)
  if (($attributes -band [IO.FileAttributes]::Directory) -eq 0 -or
      ($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Runtime state root must be a non-reparse directory: $StateRoot"
  }
  $security = New-ServiceOnlyDirectorySecurity
  Set-Acl -LiteralPath $StateRoot -AclObject $security
}

function Set-RuntimeStateRootAcl {
  if (-not (Test-Path -LiteralPath $RuntimeStateRoot -PathType Container)) {
    return $false
  }
  $attributes = [IO.File]::GetAttributes($RuntimeStateRoot)
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing to restore service custody through a reparse-point Runtime state root: $RuntimeStateRoot"
  }
  $security = New-ServiceOnlyDirectorySecurity
  Set-Acl -LiteralPath $RuntimeStateRoot -AclObject $security
  return $true
}

function Set-ServiceOnlyFileAcl {
  param([Parameter(Mandatory = $true)] [string] $Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $false
  }
  $attributes = [IO.File]::GetAttributes($Path)
  if (($attributes -band ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint)) -ne 0) {
    throw "Refusing to restore service custody to a non-regular file: $Path"
  }
  $security = New-ServiceOnlyFileSecurity
  Set-Acl -LiteralPath $Path -AclObject $security
  return $true
}

function Set-RuntimeInstallationStateAcl {
  [void] (Set-ServiceOnlyFileAcl -Path $RuntimeInstallationState)
}

function Set-RuntimeRepairStateAcl {
  param([string] $BackupPath = '')
  foreach ($path in @(
    $RuntimeDatabase,
    "$RuntimeDatabase-wal",
    "$RuntimeDatabase-shm",
    "$RuntimeDatabase-journal"
  )) {
    [void] (Set-ServiceOnlyFileAcl -Path $path)
  }
  if (-not [string]::IsNullOrWhiteSpace($BackupPath)) {
    [void] (Set-ServiceOnlyFileAcl -Path $BackupPath)
  }
  Set-RuntimeInstallationStateAcl
  [void] (Set-RuntimeStateRootAcl)
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

function Grant-InstallerFileAccess {
  param(
    [Parameter(Mandatory = $true)] [string] $Path,
    [Parameter(Mandatory = $true)] [string] $Label
  )
  $takeOwnership = Invoke-NativeCommand -FilePath 'takeown.exe' -Arguments @('/F', $Path, '/A')
  if ($takeOwnership.ExitCode -ne 0) {
    try {
      [void] [IO.File]::GetAttributes($Path)
    } catch [IO.FileNotFoundException] {
      return $false
    } catch [IO.DirectoryNotFoundException] {
      return $false
    } catch {
      throw "Unable to take temporary installer ownership of the $Label, and its absence could not be confirmed.`n$($takeOwnership.StdOut)`n$($takeOwnership.StdErr)`nprobe: $($_.Exception.Message)"
    }
    throw "Unable to take temporary installer ownership of the $Label.`n$($takeOwnership.StdOut)`n$($takeOwnership.StdErr)"
  }
  $attributes = [IO.File]::GetAttributes($Path)
  if (($attributes -band ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint)) -ne 0) {
    throw "Refusing temporary installer access to a non-regular $Label`: $Path"
  }
  $grant = Invoke-NativeCommand -FilePath 'icacls.exe' -Arguments @($Path, '/grant:r', '*S-1-5-32-544:F')
  if ($grant.ExitCode -ne 0) {
    throw "Unable to acquire temporary installer access to the $Label.`n$($grant.StdOut)`n$($grant.StdErr)"
  }
  return $true
}

function Grant-InstallerRuntimeStateAccess {
  $takeOwnership = Invoke-NativeCommand -FilePath 'takeown.exe' -Arguments @('/F', $RuntimeStateRoot, '/A')
  if ($takeOwnership.ExitCode -ne 0) {
    try {
      [void] [IO.File]::GetAttributes($RuntimeStateRoot)
    } catch [IO.FileNotFoundException] {
      return $false
    } catch [IO.DirectoryNotFoundException] {
      return $false
    } catch {
      throw "Unable to take temporary installer ownership of the Runtime state directory, and its absence could not be confirmed.`n$($takeOwnership.StdOut)`n$($takeOwnership.StdErr)`nprobe: $($_.Exception.Message)"
    }
    throw "Unable to take temporary installer ownership of the Runtime state directory.`n$($takeOwnership.StdOut)`n$($takeOwnership.StdErr)"
  }
  $attributes = [IO.File]::GetAttributes($RuntimeStateRoot)
  if (($attributes -band [IO.FileAttributes]::Directory) -eq 0 -or
      ($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Runtime state directory must be a non-reparse directory: $RuntimeStateRoot"
  }
  $grant = Invoke-NativeCommand -FilePath 'icacls.exe' -Arguments @($RuntimeStateRoot, '/grant:r', '*S-1-5-32-544:(OI)(CI)F')
  if ($grant.ExitCode -ne 0) {
    throw "Unable to acquire temporary installer access to the Runtime state directory.`n$($grant.StdOut)`n$($grant.StdErr)"
  }
  return $true
}

function Grant-InstallerRuntimeInstallationStateAccess {
  return (Grant-InstallerFileAccess -Path $RuntimeInstallationState -Label 'Runtime installation state')
}

function Grant-InstallerRuntimeDatabaseAccess {
  $databaseExists = Grant-InstallerFileAccess -Path $RuntimeDatabase -Label 'Runtime SQLite database'
  if (-not $databaseExists) {
    return $false
  }
  foreach ($path in @(
    "$RuntimeDatabase-wal",
    "$RuntimeDatabase-shm",
    "$RuntimeDatabase-journal"
  )) {
    [void] (Grant-InstallerFileAccess -Path $path -Label 'Runtime SQLite sidecar')
  }
  return $true
}

function Resolve-LocalAgentChatRepairBackupPath {
  param([Parameter(Mandatory = $true)] [string] $Path)
  $resolved = [IO.Path]::GetFullPath($Path)
  $expectedDirectory = [IO.Path]::GetFullPath($RuntimeStateRoot).TrimEnd('\')
  $actualDirectory = [IO.Path]::GetDirectoryName($resolved).TrimEnd('\')
  $name = [IO.Path]::GetFileName($resolved)
  if (-not $actualDirectory.Equals($expectedDirectory, [StringComparison]::OrdinalIgnoreCase) -or
      $name -cnotmatch '^memory\.db\.pre-local-agent-chat-repair-\d{8}T\d{6}\.\d{7}Z-[0-9a-f]{32}\.sqlite$') {
    throw "LocalAgent chat repair backup path is outside the fixed Runtime database namespace: $resolved"
  }
  return $resolved
}

function New-LocalAgentChatRepairBackupPath {
  $timestamp = [DateTime]::UtcNow.ToString(
    'yyyyMMddTHHmmss.fffffffZ',
    [Globalization.CultureInfo]::InvariantCulture
  )
  $candidate = "$RuntimeDatabase.pre-local-agent-chat-repair-$timestamp-$([Guid]::NewGuid().ToString('N')).sqlite"
  $resolved = Resolve-LocalAgentChatRepairBackupPath -Path $candidate
  try {
    [void] [IO.File]::GetAttributes($resolved)
  } catch [IO.FileNotFoundException] {
    return $resolved
  } catch [IO.DirectoryNotFoundException] {
    throw "Runtime state directory is missing while planning LocalAgent chat repair backup: $RuntimeStateRoot"
  } catch {
    throw "Unable to confirm the planned LocalAgent chat repair backup is absent: $($_.Exception.Message)"
  }
  throw "Planned LocalAgent chat repair backup already exists: $resolved"
}

function Invoke-LocalAgentChatOfflineRepair {
  param(
    [Parameter(Mandatory = $true)] [string] $ExpectedSignerCertificateSha256,
    [Parameter(Mandatory = $true)] [string] $BackupPath
  )
  $plannedBackupPath = Resolve-LocalAgentChatRepairBackupPath -Path $BackupPath
  Assert-LocalAgentChatRepairHelper -Path $InstalledLocalAgentChatRepairHelper -ExpectedSignerCertificateSha256 $ExpectedSignerCertificateSha256
  $result = Invoke-NativeCommand -FilePath $InstalledLocalAgentChatRepairHelper -Arguments @(
    '--db',
    $RuntimeDatabase,
    '--backup',
    $plannedBackupPath,
    '--confirm-runtime-stopped',
    '--apply',
    '--installer-preinstall',
    '--json'
  )
  if ($result.ExitCode -ne 0) {
    throw "LocalAgent chat offline repair failed before Runtime installation.`n$($result.StdOut)`n$($result.StdErr)"
  }
  try {
    $repair = $result.StdOut | ConvertFrom-Json
  } catch {
    throw "LocalAgent chat offline repair returned invalid JSON: $($_.Exception.Message)"
  }
  $keys = @($repair.PSObject.Properties.Name | Sort-Object)
  $requiredKeys = @(
    'duplicateGroups',
    'originalVersion',
    'reactivatedAnchors',
    'repairedVersion',
	'removedLegacyIdentityFields',
    'rewrittenAnchorRefs',
    'rewrittenAvatarRefs',
    'rewrittenFollowUpRefs',
    'rewrittenTargetRefs',
    'schemaVersion',
    'status'
  )
  foreach ($required in $requiredKeys) {
    if ($keys -notcontains $required) {
      throw "LocalAgent chat offline repair result is missing $required."
    }
  }
  if ([int] $repair.schemaVersion -ne 1) {
    throw 'LocalAgent chat offline repair result schemaVersion is invalid.'
  }
  $status = [string] $repair.status
  $duplicateGroups = [int] $repair.duplicateGroups
  $reactivatedAnchors = [int] $repair.reactivatedAnchors
  $rewrittenAnchorRefs = [int] $repair.rewrittenAnchorRefs
  $rewrittenTargetRefs = [int] $repair.rewrittenTargetRefs
	$removedLegacyIdentityFields = [int] $repair.removedLegacyIdentityFields
  $originalVersion = [uint64] $repair.originalVersion
  $repairedVersion = [uint64] $repair.repairedVersion
  if ($duplicateGroups -lt 0 -or $reactivatedAnchors -lt 0 -or $rewrittenAnchorRefs -lt 0 -or $rewrittenTargetRefs -lt 0 -or $removedLegacyIdentityFields -lt 0) {
    throw 'LocalAgent chat offline repair returned negative change counts.'
  }
  $changeCount = $duplicateGroups + $reactivatedAnchors + $rewrittenAnchorRefs + $rewrittenTargetRefs + $removedLegacyIdentityFields
  $backupProperty = $repair.PSObject.Properties['backupPath']
  $skipProperty = $repair.PSObject.Properties['skipReason']
  $backupPath = if ($null -eq $backupProperty -or $null -eq $backupProperty.Value) { '' } else { [string] $backupProperty.Value }
  $skipReason = if ($null -eq $skipProperty -or $null -eq $skipProperty.Value) { '' } else { [string] $skipProperty.Value }
  switch ($status) {
    'applied' {
      if ($changeCount -eq 0 -or
          $repairedVersion -ne ($originalVersion + 1) -or
          [string]::IsNullOrWhiteSpace($backupPath)) {
        throw 'LocalAgent chat offline repair reported an invalid applied result.'
      }
      if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
        throw "LocalAgent chat offline repair backup is missing: $backupPath"
      }
      $resolvedDatabase = (Resolve-Path -LiteralPath $RuntimeDatabase).Path
      $resolvedBackup = (Resolve-Path -LiteralPath $backupPath).Path
      $backupPrefix = $resolvedDatabase + '.pre-local-agent-chat-repair-'
      if (-not $backupPath.Equals($plannedBackupPath, [StringComparison]::OrdinalIgnoreCase) -or
          -not $resolvedBackup.Equals($plannedBackupPath, [StringComparison]::OrdinalIgnoreCase) -or
          -not $resolvedBackup.StartsWith($backupPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "LocalAgent chat offline repair created a backup outside the fixed Runtime database namespace: $resolvedBackup"
      }
    }
    'no-change' {
      if ($changeCount -ne 0 -or
          $originalVersion -ne $repairedVersion -or
          -not [string]::IsNullOrWhiteSpace($backupPath)) {
        throw 'LocalAgent chat offline repair reported an invalid no-change result.'
      }
      if (Test-Path -LiteralPath $plannedBackupPath) {
        throw "LocalAgent chat offline repair created an unexpected no-change backup: $plannedBackupPath"
      }
    }
    'not-applicable' {
      if ($skipReason -ne 'public_chat_state_uninitialized' -or
          $changeCount -ne 0 -or
          -not [string]::IsNullOrWhiteSpace($backupPath)) {
        throw 'LocalAgent chat offline repair reported an invalid not-applicable result.'
      }
      if (Test-Path -LiteralPath $plannedBackupPath) {
        throw "LocalAgent chat offline repair created an unexpected not-applicable backup: $plannedBackupPath"
      }
    }
    default {
      throw "LocalAgent chat offline repair returned unsupported status: $status"
    }
  }
  return [ordered]@{
    status = $status
    skipReason = if ([string]::IsNullOrWhiteSpace($skipReason)) { $null } else { $skipReason }
    duplicateGroups = $duplicateGroups
    reactivatedAnchors = $reactivatedAnchors
    rewrittenAnchorRefs = $rewrittenAnchorRefs
    rewrittenTargetRefs = $rewrittenTargetRefs
	removedLegacyIdentityFields = $removedLegacyIdentityFields
    originalVersion = $originalVersion
    repairedVersion = $repairedVersion
    backupPath = if ([string]::IsNullOrWhiteSpace($backupPath)) { $null } else { $backupPath }
  }
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
  $repairHelperSignature = if (Test-Path -LiteralPath $InstalledLocalAgentChatRepairHelper -PathType Leaf) { Get-AuthenticodeSignature -LiteralPath $InstalledLocalAgentChatRepairHelper } else { $null }
  $repairHelperSha256 = if (Test-Path -LiteralPath $InstalledLocalAgentChatRepairHelper -PathType Leaf) { (Get-FileHash -LiteralPath $InstalledLocalAgentChatRepairHelper -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
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
    localAgentChatRepairHelperSha256 = $repairHelperSha256
    expectedLocalAgentChatRepairHelperSha256 = $ExpectedLocalAgentChatRepairSha256
    localAgentChatRepairHelperMatchesCandidate = $null -ne $repairHelperSha256 -and $repairHelperSha256 -eq $ExpectedLocalAgentChatRepairSha256
    localAgentChatRepairHelperSignatureStatus = if ($null -eq $repairHelperSignature) { 'Missing' } else { [string] $repairHelperSignature.Status }
    localAgentChatRepairHelperSignerCertificateSha256 = if ($null -eq $repairHelperSignature -or $null -eq $repairHelperSignature.SignerCertificate) { $null } else { Get-CertificateSha256 -Certificate $repairHelperSignature.SignerCertificate }
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
  Assert-LocalAgentChatRepairHelper -Path $BundledLocalAgentChatRepairHelper -ExpectedSignerCertificateSha256 $installerSigner
  Import-SignerForLocalSystem -Certificate $runtimeCertificate
  Stage-InstallCandidate -SourceBinary $source -ExpectedSignerCertificateSha256 $installerSigner

  $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  $existingRecord = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  $previousBinaryPath = if ($null -eq $existingRecord) { $null } else { [string] $existingRecord.PathName }
  $previousStartMode = if ($null -eq $existingRecord) { $null } else { [string] $existingRecord.StartMode }
  $previousWasRunning = $null -ne $existing -and [string] $existing.Status -ne 'Stopped'
  $createdService = $false
  $mutatedService = $false
  $installerStateTouched = $false
  $runtimeStateTouched = $false
  $runtimeDatabaseTouched = $false
  $installationStateTouched = $false
  $runtimeStateAccess = $false
  $runtimeDatabaseAccess = $false
  $installationStateAccess = $false
  $deploymentStateChanged = $false
  $previousInstallationState = $null
  $stateCustodyRestored = $true
  $plannedRepairBackupPath = ''
  $offlineRepair = [ordered]@{
    status = 'not-applicable'
    skipReason = 'runtime_database_absent'
    duplicateGroups = 0
    reactivatedAnchors = 0
    rewrittenAnchorRefs = 0
    rewrittenTargetRefs = 0
    removedLegacyIdentityFields = 0
    originalVersion = 0
    repairedVersion = 0
    backupPath = $null
  }

  try {
    if ($previousWasRunning) {
      Stop-Service -Name $ServiceName -ErrorAction Stop
      Wait-ServiceState -Expected 'Stopped'
    }
    $stateCustodyRestored = $false
    $installerStateTouched = $true
    Grant-InstallerStateAccess
    $runtimeStateTouched = $true
    $runtimeStateAccess = Grant-InstallerRuntimeStateAccess
    $installationStateTouched = $true
    $installationStateAccess = Grant-InstallerRuntimeInstallationStateAccess
    if ($runtimeStateAccess) {
      $runtimeDatabaseTouched = $true
      $runtimeDatabaseAccess = Grant-InstallerRuntimeDatabaseAccess
    }
    if ($runtimeDatabaseAccess) {
      $plannedRepairBackupPath = New-LocalAgentChatRepairBackupPath
      $offlineRepair = Invoke-LocalAgentChatOfflineRepair `
        -ExpectedSignerCertificateSha256 $installerSigner `
        -BackupPath $plannedRepairBackupPath
    }
    if (Test-Path -LiteralPath $RuntimeInstallationState -PathType Leaf) {
      $previousInstallationState = Get-Content -LiteralPath $RuntimeInstallationState -Raw -Encoding UTF8
    }
    $deploymentStateChanged = Set-RuntimeDeploymentProfile
    Set-RuntimeRepairStateAcl -BackupPath $plannedRepairBackupPath
    Set-StateRootAcl
    $stateCustodyRestored = $true

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
    Invoke-ServiceControl -Arguments @('failure', $ServiceName, 'reset=', '300', 'actions=', 'restart/1000/restart/3000/restart/10000/none/0') -FailureMessage 'SCM failed to configure Runtime recovery.'

    $resolvedSid = Resolve-ServiceSid
    if ($resolvedSid -ne $ExpectedServiceSid) {
      throw "SCM resolved unexpected service SID: $resolvedSid"
    }
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
        -not $status.localAgentChatRepairHelperMatchesCandidate -or
        $status.localAgentChatRepairHelperSignatureStatus -ne 'Valid' -or
        $status.localAgentChatRepairHelperSignerCertificateSha256 -ne $installerSigner -or
        $status.signatureStatus -ne 'Valid' -or $status.state -ne 'running') {
      throw 'NimiRuntime failed post-install fixed-service validation.'
    }
    $status['installerSignerCertificateSha256'] = $installerSigner
    $status['stateAclConfiguredBySignedInstaller'] = $true
    $status['atomicVersionRoot'] = $InstalledVersionRoot
    $status['deploymentProfile'] = $DeploymentProfile
    $status['realmOrigin'] = $DeploymentRealmOrigins[$DeploymentProfile]
    $status['offlineRepair'] = $offlineRepair
    $previousVersionRoot = Resolve-InstalledVersionRootFromServicePath -ServiceBinaryPath $previousBinaryPath
    $keepVersionRoots = @($InstalledVersionRoot)
    if (-not [string]::IsNullOrWhiteSpace($previousVersionRoot)) {
      $keepVersionRoots += $previousVersionRoot
    }
    $versionRetention = [ordered]@{
      kept = @($keepVersionRoots | ForEach-Object { Split-Path $_ -Leaf } | Select-Object -Unique)
      removed = @()
      error = $null
    }
    try {
      $versionRetention.removed = @(Remove-StaleInstalledVersions -KeepRoots $keepVersionRoots)
    } catch {
      $versionRetention.error = $_.Exception.Message
    }
    $status['versionRetention'] = $versionRetention
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
    if ($installerStateTouched -and (-not $stateCustodyRestored -or $deploymentStateChanged)) {
      try {
        $stateCustodyRestored = $false
        Grant-InstallerStateAccess
        if ($runtimeStateTouched) {
          [void] (Grant-InstallerRuntimeStateAccess)
        }
        if ($runtimeDatabaseTouched) {
          [void] (Grant-InstallerRuntimeDatabaseAccess)
        }
        if ($installationStateTouched) {
          [void] (Grant-InstallerRuntimeInstallationStateAccess)
          if ($installationStateAccess -and $deploymentStateChanged -and $null -ne $previousInstallationState) {
            Write-RuntimeInstallationState -Raw $previousInstallationState
          }
        }
        Set-RuntimeRepairStateAcl -BackupPath $plannedRepairBackupPath
        Set-StateRootAcl
        $stateCustodyRestored = $true
      } catch {
        $rollbackFailures.Add("restore protected Runtime state custody: $($_.Exception.Message)")
      }
    }
    if (-not $createdService -and $previousWasRunning) {
      if (-not $stateCustodyRestored) {
        $rollbackFailures.Add('previous service not restarted because protected Runtime state custody was not restored')
      } else {
        try {
          Start-Service -Name $ServiceName -ErrorAction Stop
          Wait-ServiceState -Expected 'Running'
        } catch {
          $rollbackFailures.Add("restart previous service: $($_.Exception.Message)")
        }
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
