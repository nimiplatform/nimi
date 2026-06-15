param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $RemainingArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Subject = 'CN=Nimi Local Go Test Code Signing'

function Get-NimiCodeSigningCert {
  $cert = Get-ChildItem -Path Cert:\CurrentUser\My -CodeSigningCert |
    Where-Object { $_.Subject -eq $Subject -and $_.NotAfter -gt (Get-Date).AddDays(30) } |
    Sort-Object -Property NotAfter -Descending |
    Select-Object -First 1

  if ($null -ne $cert) {
    return $cert
  }

  return New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $Subject `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -KeyUsage DigitalSignature `
    -NotAfter (Get-Date).AddYears(5)
}

function Ensure-CertInStore {
  param(
    [Parameter(Mandatory = $true)] [System.Security.Cryptography.X509Certificates.X509Certificate2] $Cert,
    [Parameter(Mandatory = $true)] [string] $StorePath
  )

  $existing = Get-ChildItem -Path $StorePath -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $Cert.Thumbprint } |
    Select-Object -First 1

  if ($null -ne $existing) {
    return
  }

  $tempCertPath = Join-Path ([System.IO.Path]::GetTempPath()) "nimi-go-test-$($Cert.Thumbprint).cer"
  try {
    Export-Certificate -Cert $Cert -FilePath $tempCertPath | Out-Null
    Import-Certificate -FilePath $tempCertPath -CertStoreLocation $StorePath | Out-Null
  } finally {
    Remove-Item -LiteralPath $tempCertPath -Force -ErrorAction SilentlyContinue
  }
}

function Ensure-TestBinarySigned {
  param(
    [Parameter(Mandatory = $true)] [string] $Path
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Go test executable not found: $Path"
  }

  $currentSignature = Get-AuthenticodeSignature -FilePath $Path
  if ($currentSignature.Status -eq 'Valid') {
    return
  }

  $cert = Get-NimiCodeSigningCert
  Ensure-CertInStore -Cert $cert -StorePath Cert:\CurrentUser\Root
  Ensure-CertInStore -Cert $cert -StorePath Cert:\CurrentUser\TrustedPublisher

  $signed = Set-AuthenticodeSignature -FilePath $Path -Certificate $cert -HashAlgorithm SHA256
  if ($signed.Status -ne 'Valid') {
    throw "Failed to sign Go test executable $Path`: $($signed.Status) $($signed.StatusMessage)"
  }
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
