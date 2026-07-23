param(
  [ValidateSet('Inspect', 'Reset')]
  [string] $Mode = 'Inspect',

  [Parameter(Mandatory = $true)]
  [string] $ProductRoot,

  [switch] $ResetCompletedAcceptanceAttempt,

  [string] $ExpectedExecutionEvidenceRef = '',

  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ServiceName = 'NimiRuntime'
$StateRoot = Join-Path $env:ProgramData 'Nimi\Runtime\Protected'
$ProductControlPath = Join-Path $StateRoot 'nimi.json'
$RuntimeConfigPath = Join-Path $StateRoot 'runtime\config.json'

function Write-Result {
  param([Parameter(Mandatory = $true)] [object] $Value)
  if ($Json) {
    $Value | ConvertTo-Json -Depth 6 -Compress
  } else {
    $Value | Format-List
  }
}

function Assert-Elevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Resetting the fixed NimiRuntime Product Control state requires an elevated Administrator process.'
  }
}

function Resolve-ValidatedProductRoot {
  param([Parameter(Mandatory = $true)] [string] $Value)
  $trimmed = $Value.Trim()
  if ($trimmed -ne $Value -or [string]::IsNullOrWhiteSpace($trimmed)) {
    throw 'ProductRoot must be an absolute non-volume-root directory.'
  }
  $inputRoot = [IO.Path]::GetPathRoot($trimmed)
  if ([string]::IsNullOrWhiteSpace($inputRoot) -or
      $inputRoot -eq '\' -or
      $inputRoot -match '^[A-Za-z]:$') {
    throw 'ProductRoot must be an absolute non-volume-root directory.'
  }
  $item = Get-Item -LiteralPath $trimmed -Force -ErrorAction Stop
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'ProductRoot must be an existing non-reparse directory.'
  }
  $resolved = $item.FullName.TrimEnd('\')
  if ([string]::IsNullOrWhiteSpace($resolved) -or $resolved -eq [IO.Path]::GetPathRoot($resolved)) {
    throw 'ProductRoot must be an absolute non-volume-root directory.'
  }
  return $resolved
}

function Read-OptionalJson {
  param([Parameter(Mandatory = $true)] [string] $Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $null
  }
  try {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Refusing to reset unreadable JSON state at $Path`: $($_.Exception.Message)"
  }
}

function Open-ControlFileForReset {
  param([Parameter(Mandatory = $true)] [string] $Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $null
  }
  $originalAcl = Get-Acl -LiteralPath $Path
  & takeown.exe /F $Path /A | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to take temporary reset ownership of $Path."
  }
  $resetAcl = Get-Acl -LiteralPath $Path
  $administrators = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $resetRule = [Security.AccessControl.FileSystemAccessRule]::new(
    $administrators,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow
  )
  $resetAcl.AddAccessRule($resetRule) | Out-Null
  Set-Acl -LiteralPath $Path -AclObject $resetAcl
  return [pscustomobject]@{
    path = $Path
    originalAcl = $originalAcl
  }
}

function Restore-ControlFileAccess {
  param([Parameter(Mandatory = $true)] [object] $Entry)
  if (Test-Path -LiteralPath $Entry.path -PathType Leaf) {
    Set-Acl -LiteralPath $Entry.path -AclObject $Entry.originalAcl
  }
}

function Get-PropertyValue {
  param(
    [AllowNull()] [object] $InputObject,
    [Parameter(Mandatory = $true)] [string] $Name
  )
  if ($null -eq $InputObject) {
    return $null
  }
  $property = $InputObject.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $null
  }
  return $property.Value
}

function Normalize-OptionalPath {
  param([AllowNull()] [object] $Value)
  $text = [string] $Value
  if ([string]::IsNullOrWhiteSpace($text)) {
    return ''
  }
  if (-not [IO.Path]::IsPathFullyQualified($text)) {
    throw "Refusing to reset non-absolute persisted data root: $text"
  }
  return [IO.Path]::GetFullPath($text).TrimEnd('\')
}

function Read-ResetState {
  $record = Read-OptionalJson -Path $ProductControlPath
  $runtimeConfig = Read-OptionalJson -Path $RuntimeConfigPath
  $dataRoot = Get-PropertyValue -InputObject $record -Name 'dataRoot'
  $firstRun = Get-PropertyValue -InputObject $record -Name 'firstRun'
  return [pscustomobject]@{
    recordExists = $null -ne $record
    recordState = [string] (Get-PropertyValue -InputObject $record -Name 'state')
    recordDataRoot = Normalize-OptionalPath -Value (Get-PropertyValue -InputObject $dataRoot -Name 'path')
    firstRunCompleted = [bool] (Get-PropertyValue -InputObject $firstRun -Name 'completed')
    firstRunExecutionEvidenceRef = [string] (Get-PropertyValue -InputObject $firstRun -Name 'executionEvidenceRef')
    runtimeConfigExists = $null -ne $runtimeConfig
    runtimeConfigDataRoot = Normalize-OptionalPath -Value (Get-PropertyValue -InputObject $runtimeConfig -Name 'dataRootRef')
  }
}

function Paths-Equal {
  param(
    [Parameter(Mandatory = $true)] [AllowEmptyString()] [string] $Left,
    [Parameter(Mandatory = $true)] [AllowEmptyString()] [string] $Right
  )
  return [string]::Equals($Left, $Right, [StringComparison]::OrdinalIgnoreCase)
}

function Resolve-ResetDisposition {
  param(
    [Parameter(Mandatory = $true)] [object] $State,
    [Parameter(Mandatory = $true)] [string] $DesiredRoot,
    [Parameter(Mandatory = $true)] [bool] $CompletedAcceptanceReset,
    [Parameter(Mandatory = $true)] [AllowEmptyString()] [string] $ExpectedEvidenceRef
  )
  $recordMismatch = -not [string]::IsNullOrWhiteSpace($State.recordDataRoot) -and
    -not (Paths-Equal -Left $State.recordDataRoot -Right $DesiredRoot)
  $configMismatch = -not [string]::IsNullOrWhiteSpace($State.runtimeConfigDataRoot) -and
    -not (Paths-Equal -Left $State.runtimeConfigDataRoot -Right $DesiredRoot)
  if ($CompletedAcceptanceReset) {
    if (-not $State.recordExists -or
        -not $State.firstRunCompleted -or
        $State.recordState -ne 'ready_for_use') {
      throw 'Completed acceptance reset requires an existing ready_for_use Product Control record.'
    }
    if ($recordMismatch -or $configMismatch -or
        [string]::IsNullOrWhiteSpace($State.recordDataRoot) -or
        -not (Paths-Equal -Left $State.recordDataRoot -Right $DesiredRoot)) {
      throw 'Completed acceptance reset requires Product Control and Runtime config to remain bound to the exact requested product root.'
    }
    if ($ExpectedEvidenceRef -notmatch '^execution_evidence_[0-9a-z]+$' -or
        -not [string]::Equals(
          $State.firstRunExecutionEvidenceRef,
          $ExpectedEvidenceRef,
          [StringComparison]::Ordinal
        )) {
      throw 'Completed acceptance reset requires the exact current First Run executionEvidenceRef.'
    }
    return [pscustomobject]@{
      recordReset = $true
      configReset = $State.runtimeConfigExists
      required = $true
      completedAcceptanceAttemptReset = $true
    }
  }
  if ($recordMismatch -and
      -not [string]::IsNullOrWhiteSpace($State.runtimeConfigDataRoot) -and
      -not (Paths-Equal -Left $State.recordDataRoot -Right $State.runtimeConfigDataRoot)) {
    throw 'Refusing to reset inconsistent Product Control and Runtime config data-root bindings.'
  }
  if ($recordMismatch -and ($State.firstRunCompleted -or $State.recordState -eq 'ready_for_use')) {
    throw 'Refusing to reset a completed Product Control installation; this tool is only for an incomplete local acceptance attempt.'
  }
  return [pscustomobject]@{
    recordReset = $recordMismatch
    configReset = $configMismatch
    required = $recordMismatch -or $configMismatch
    completedAcceptanceAttemptReset = $false
  }
}

$resolvedProductRoot = Resolve-ValidatedProductRoot -Value $ProductRoot

if ($Mode -eq 'Inspect') {
  if ($ResetCompletedAcceptanceAttempt -or -not [string]::IsNullOrWhiteSpace($ExpectedExecutionEvidenceRef)) {
    throw 'Inspect mode does not accept completed-reset mutation parameters.'
  }
  $initialState = Read-ResetState
  $initialDisposition = Resolve-ResetDisposition `
    -State $initialState `
    -DesiredRoot $resolvedProductRoot `
    -CompletedAcceptanceReset $false `
    -ExpectedEvidenceRef ''
  Write-Result -Value ([ordered]@{
    mode = 'inspect'
    desiredProductRoot = $resolvedProductRoot
    productControlState = $initialState.recordState
    firstRunCompleted = $initialState.firstRunCompleted
    executionEvidenceRef = if ([string]::IsNullOrWhiteSpace($initialState.firstRunExecutionEvidenceRef)) { $null } else { $initialState.firstRunExecutionEvidenceRef }
    currentProductRoot = if ([string]::IsNullOrWhiteSpace($initialState.recordDataRoot)) { $null } else { $initialState.recordDataRoot }
    runtimeConfigProductRoot = if ([string]::IsNullOrWhiteSpace($initialState.runtimeConfigDataRoot)) { $null } else { $initialState.runtimeConfigDataRoot }
    resetRequired = $initialDisposition.required
    productRootPayloadTouched = $false
  })
  exit 0
}

if ($ResetCompletedAcceptanceAttempt.IsPresent -ne (-not [string]::IsNullOrWhiteSpace($ExpectedExecutionEvidenceRef))) {
  throw 'Completed acceptance reset requires both -ResetCompletedAcceptanceAttempt and -ExpectedExecutionEvidenceRef.'
}

Assert-Elevated
$service = Get-Service -Name $ServiceName -ErrorAction Stop
$wasRunning = $service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped
$stoppedByReset = $false
$accessEntries = [System.Collections.Generic.List[object]]::new()
$removed = [System.Collections.Generic.List[string]]::new()
try {
  if ($wasRunning) {
    Stop-Service -Name $ServiceName -ErrorAction Stop
    (Get-Service -Name $ServiceName -ErrorAction Stop).WaitForStatus(
      [System.ServiceProcess.ServiceControllerStatus]::Stopped,
      [TimeSpan]::FromSeconds(30)
    )
    $stoppedByReset = $true
  }

  foreach ($controlPath in @($ProductControlPath, $RuntimeConfigPath)) {
    $accessEntry = Open-ControlFileForReset -Path $controlPath
    if ($null -ne $accessEntry) {
      $accessEntries.Add($accessEntry)
    }
  }

  $currentState = Read-ResetState
  $disposition = Resolve-ResetDisposition `
    -State $currentState `
    -DesiredRoot $resolvedProductRoot `
    -CompletedAcceptanceReset $ResetCompletedAcceptanceAttempt.IsPresent `
    -ExpectedEvidenceRef $ExpectedExecutionEvidenceRef
  if ($disposition.recordReset) {
    Remove-Item -LiteralPath $ProductControlPath -Force
    $removed.Add($ProductControlPath)
  }
  if ($disposition.configReset) {
    Remove-Item -LiteralPath $RuntimeConfigPath -Force
    $removed.Add($RuntimeConfigPath)
  }
} finally {
  try {
    foreach ($accessEntry in $accessEntries) {
      Restore-ControlFileAccess -Entry $accessEntry
    }
  } finally {
    if ($stoppedByReset) {
      Start-Service -Name $ServiceName -ErrorAction Stop
      (Get-Service -Name $ServiceName -ErrorAction Stop).WaitForStatus(
        [System.ServiceProcess.ServiceControllerStatus]::Running,
        [TimeSpan]::FromSeconds(30)
      )
    }
  }
}

Write-Result -Value ([ordered]@{
  mode = 'reset'
  desiredProductRoot = $resolvedProductRoot
  resetPerformed = $removed.Count -gt 0
  completedAcceptanceAttemptReset = $ResetCompletedAcceptanceAttempt.IsPresent
  removedControlFiles = @($removed)
  productRootPayloadTouched = $false
  serviceRestoredToRunning = $wasRunning
})
