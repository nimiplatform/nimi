param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Provision', 'Sign', 'Diagnose')]
  [string] $Mode,

  [string[]] $Path = @(),

  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Subject = 'CN=Nimi Local Development Code Signing'
$MinimumValidDays = 30
$CurrentUserMy = 'Cert:\CurrentUser\My'
$CurrentUserRoot = 'Cert:\CurrentUser\Root'
$CurrentUserTrustedPublisher = 'Cert:\CurrentUser\TrustedPublisher'

function Write-Result {
  param(
    [Parameter(Mandatory = $true)] [object] $Value
  )

  if ($Json) {
    $Value | ConvertTo-Json -Depth 8
    return
  }

  $Value | Format-List
}

function Get-NimiDevCodeSigningCert {
  param(
    [switch] $RequirePrivateKey
  )

  $minimumNotAfter = (Get-Date).AddDays($MinimumValidDays)
  $codeSigningOid = '1.3.6.1.5.5.7.3.3'
  $certs = Get-ChildItem -Path $CurrentUserMy -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Subject -eq $Subject -and
      $_.NotAfter -gt $minimumNotAfter -and
      ($_.EnhancedKeyUsageList | Where-Object { [string] $_.ObjectId -eq $codeSigningOid })
    } |
    Sort-Object -Property NotAfter -Descending

  if ($RequirePrivateKey) {
    $certs = $certs | Where-Object { $_.HasPrivateKey }
  }

  return $certs | Select-Object -First 1
}

function New-NimiDevCodeSigningCert {
  return New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $Subject `
    -CertStoreLocation $CurrentUserMy `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -KeyUsage DigitalSignature `
    -NotAfter (Get-Date).AddYears(5)
}

function Test-CertInStore {
  param(
    [Parameter(Mandatory = $true)] [System.Security.Cryptography.X509Certificates.X509Certificate2] $Cert,
    [Parameter(Mandatory = $true)] [string] $StorePath
  )

  $existing = Get-ChildItem -Path $StorePath -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $Cert.Thumbprint } |
    Select-Object -First 1

  return $null -ne $existing
}

function Ensure-CertInStore {
  param(
    [Parameter(Mandatory = $true)] [System.Security.Cryptography.X509Certificates.X509Certificate2] $Cert,
    [Parameter(Mandatory = $true)] [string] $StorePath,
    [Parameter(Mandatory = $true)] [string] $TempPrefix
  )

  if (Test-CertInStore -Cert $Cert -StorePath $StorePath) {
    return
  }

  $tempCertPath = Join-Path ([System.IO.Path]::GetTempPath()) "$TempPrefix-$($Cert.Thumbprint).cer"
  try {
    Export-Certificate -Cert $Cert -FilePath $tempCertPath -Force | Out-Null
    Import-Certificate -FilePath $tempCertPath -CertStoreLocation $StorePath | Out-Null
  } finally {
    Remove-Item -LiteralPath $tempCertPath -Force -ErrorAction SilentlyContinue
  }
}

function Get-StoreStatus {
  param(
    [System.Security.Cryptography.X509Certificates.X509Certificate2] $Cert
  )

  if ($null -eq $Cert) {
    return [ordered]@{
      currentUserMy = $false
      currentUserRoot = $false
      currentUserTrustedPublisher = $false
    }
  }

  return [ordered]@{
    currentUserMy = Test-CertInStore -Cert $Cert -StorePath $CurrentUserMy
    currentUserRoot = Test-CertInStore -Cert $Cert -StorePath $CurrentUserRoot
    currentUserTrustedPublisher = Test-CertInStore -Cert $Cert -StorePath $CurrentUserTrustedPublisher
  }
}

function Get-CertificateSha256 {
  param(
    [System.Security.Cryptography.X509Certificates.X509Certificate2] $Cert
  )

  if ($null -eq $Cert) {
    return $null
  }
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $sha256.ComputeHash($Cert.RawData)
    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Convert-CertSummary {
  param(
    [System.Security.Cryptography.X509Certificates.X509Certificate2] $Cert,
    [Parameter(Mandatory = $true)] [string] $Status
  )

  if ($null -eq $Cert) {
    return [ordered]@{
      status = $Status
      subject = $Subject
      thumbprint = $null
      certificateSha256 = $null
      notBefore = $null
      notAfter = $null
      stores = Get-StoreStatus -Cert $null
    }
  }

  return [ordered]@{
    status = $Status
    subject = $Cert.Subject
    thumbprint = $Cert.Thumbprint
    certificateSha256 = Get-CertificateSha256 -Cert $Cert
    notBefore = $Cert.NotBefore.ToString('o')
    notAfter = $Cert.NotAfter.ToString('o')
    stores = Get-StoreStatus -Cert $Cert
  }
}

function Resolve-RequiredFile {
  param(
    [Parameter(Mandatory = $true)] [string] $FilePath
  )

  if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    throw "File not found: $FilePath"
  }

  return (Resolve-Path -LiteralPath $FilePath).Path
}

function Get-SignatureSummary {
  param(
    [Parameter(Mandatory = $true)] [string] $FilePath
  )

  if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    return [ordered]@{
      path = $FilePath
      exists = $false
      status = 'Missing'
      statusMessage = 'File not found.'
      signerSubject = $null
      signerThumbprint = $null
      signerCertificateSha256 = $null
    }
  }

  $signature = Get-AuthenticodeSignature -FilePath $FilePath
  return [ordered]@{
    path = $FilePath
    exists = $true
    status = [string] $signature.Status
    statusMessage = [string] $signature.StatusMessage
    signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
    signerThumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }
    signerCertificateSha256 = if ($signature.SignerCertificate) { Get-CertificateSha256 -Cert $signature.SignerCertificate } else { $null }
  }
}

function Ensure-ProvisionedCertForSign {
  $cert = Get-NimiDevCodeSigningCert -RequirePrivateKey
  if ($null -eq $cert) {
    throw "Missing provisioned Nimi local development code signing certificate. Run: pnpm provision:windows-dev-trust"
  }

  $stores = Get-StoreStatus -Cert $cert
  if (-not $stores.currentUserRoot -or -not $stores.currentUserTrustedPublisher) {
    throw "Nimi local development certificate is not trusted in CurrentUser Root and TrustedPublisher. Run: pnpm provision:windows-dev-trust"
  }

  return $cert
}

function Sign-FileWithCert {
  param(
    [Parameter(Mandatory = $true)] [string] $FilePath,
    [Parameter(Mandatory = $true)] [System.Security.Cryptography.X509Certificates.X509Certificate2] $Cert
  )

  $resolvedPath = Resolve-RequiredFile -FilePath $FilePath
  $lastError = $null

  for ($attempt = 1; $attempt -le 12; $attempt++) {
    try {
      Set-AuthenticodeSignature -FilePath $resolvedPath -Certificate $Cert -HashAlgorithm SHA256 | Out-Null
      $signature = Get-AuthenticodeSignature -FilePath $resolvedPath
      if ($signature.Status -ne 'Valid') {
        throw "signature status is $($signature.Status): $($signature.StatusMessage)"
      }
      if ($null -eq $signature.SignerCertificate) {
        throw 'signature has no signer certificate'
      }
      if ($signature.SignerCertificate.Thumbprint -ne $Cert.Thumbprint) {
        throw "signature thumbprint $($signature.SignerCertificate.Thumbprint) did not match expected $($Cert.Thumbprint)"
      }

      return Get-SignatureSummary -FilePath $resolvedPath
    } catch {
      $lastError = $_
      Start-Sleep -Milliseconds 250
    }
  }

  throw "Failed to sign $resolvedPath`: $($lastError.Exception.Message)"
}

function Get-RecentApplicationControlEvents {
  param(
    [string[]] $Needles = @()
  )

  if ($Needles.Count -eq 0) {
    return @()
  }

  $events = @()
  foreach ($logName in @('Microsoft-Windows-CodeIntegrity/Operational', 'Microsoft-Windows-AppLocker/EXE and DLL')) {
    try {
      $logEvents = Get-WinEvent -LogName $logName -MaxEvents 50 -ErrorAction Stop |
        Where-Object {
          $message = [string] $_.Message
          foreach ($needle in $Needles) {
            if ($needle -and $message.Contains($needle)) {
              return $true
            }
          }
          return $false
        } |
        Select-Object -First 10

      foreach ($event in $logEvents) {
        $events += [ordered]@{
          logName = $logName
          timeCreated = $event.TimeCreated.ToString('o')
          id = $event.Id
          message = [string] $event.Message
        }
      }
    } catch {
      $events += [ordered]@{
        logName = $logName
        timeCreated = $null
        id = $null
        message = "Unable to read log: $($_.Exception.Message)"
      }
    }
  }

  return $events
}

function Invoke-Provision {
  $cert = Get-NimiDevCodeSigningCert -RequirePrivateKey
  if ($null -eq $cert) {
    $cert = New-NimiDevCodeSigningCert
  }

  Ensure-CertInStore -Cert $cert -StorePath $CurrentUserRoot -TempPrefix 'nimi-dev-code-signing-root'
  Ensure-CertInStore -Cert $cert -StorePath $CurrentUserTrustedPublisher -TempPrefix 'nimi-dev-code-signing-publisher'

  Write-Result -Value (Convert-CertSummary -Cert $cert -Status 'provisioned')
}

function Invoke-Sign {
  if ($Path.Count -lt 1) {
    throw 'Sign mode requires -Path.'
  }

  $cert = Ensure-ProvisionedCertForSign
  $signatures = @()
  foreach ($filePath in $Path) {
    $signatures += Sign-FileWithCert -FilePath $filePath -Cert $cert
  }

  Write-Result -Value ([ordered]@{
    status = 'signed'
    subject = $cert.Subject
    thumbprint = $cert.Thumbprint
    certificateSha256 = Get-CertificateSha256 -Cert $cert
    signatures = @($signatures)
  })
}

function Invoke-Diagnose {
  $cert = Get-NimiDevCodeSigningCert -RequirePrivateKey
  $signatures = @()
  $needles = @()

  foreach ($filePath in $Path) {
    $signatures += Get-SignatureSummary -FilePath $filePath
    if (Test-Path -LiteralPath $filePath -PathType Leaf) {
      $needles += (Resolve-Path -LiteralPath $filePath).Path
    } elseif ($filePath) {
      $needles += $filePath
    }
  }

  $events = @()
  if ($Path.Count -gt 0) {
    $events = Get-RecentApplicationControlEvents -Needles $needles
  }
  $eventItems = @()
  if ($null -ne $events) {
    $eventItems = @($events)
  }

  Write-Result -Value ([ordered]@{
    status = 'diagnosed'
    certificate = Convert-CertSummary -Cert $cert -Status $(if ($null -eq $cert) { 'missing' } else { 'present' })
    signatures = @($signatures)
    applicationControlEvents = $eventItems
  })
}

try {
  switch ($Mode) {
    'Provision' { Invoke-Provision }
    'Sign' { Invoke-Sign }
    'Diagnose' { Invoke-Diagnose }
  }
} catch {
  $errorPayload = [ordered]@{
    status = 'failed'
    subject = $Subject
    mode = $Mode
    error = $_.Exception.Message
  }
  if ($Json) {
    [Console]::Error.WriteLine(($errorPayload | ConvertTo-Json -Depth 8))
  } else {
    [Console]::Error.WriteLine($_.Exception.Message)
  }
  exit 1
}
