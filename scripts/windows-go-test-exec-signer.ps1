param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $RemainingArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$SigningScript = Join-Path $PSScriptRoot 'lib\windows-dev-signing.ps1'

function Ensure-TestBinarySigned {
  param(
    [Parameter(Mandatory = $true)] [string] $Path
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Go test executable not found: $Path"
  }

  & $SigningScript -Mode Sign -Path $Path -Json | Out-Null
}

$argsList = @($RemainingArgs)

if ($argsList.Count -lt 1 -or [string]::IsNullOrWhiteSpace($argsList[0])) {
  throw 'Missing Go test executable argument.'
}

$testExe = $argsList[0]
$testArgs = @()
if ($argsList.Count -gt 1) {
  $testArgs = $argsList[1..($argsList.Count - 1)]
}

Ensure-TestBinarySigned -Path $testExe

& $testExe @testArgs
exit $LASTEXITCODE
