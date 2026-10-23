param(
  [Parameter(Mandatory)][ValidateSet('prepare', 'verify', 'expose')][string]$Mode,
  [Parameter(Mandatory)][string]$Target
)
$ErrorActionPreference = 'Stop'

# Only disposable directories created by these tests may receive test ACLs.
$testTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$testTarget = [IO.Path]::GetFullPath($Target)
$testRelative = [IO.Path]::GetRelativePath($testTemp, $testTarget)
if ([IO.Path]::IsPathRooted($testRelative) -or $testRelative.StartsWith('..') -or
    $testRelative.Split('\')[0] -notmatch '^nimi-[A-Za-z0-9-]+$') {
  throw 'Test cache must be inside its disposable nimi-* temporary directory'
}
for ($cursor = $testTarget; $cursor -ne $testTemp; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
  if (Test-Path -LiteralPath $cursor) {
    $entry = Get-Item -LiteralPath $cursor -Force
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'Test cache must not traverse reparse points'
    }
  }
}

$testUser = [Security.Principal.WindowsIdentity]::GetCurrent().User
$admitted = @($testUser.Value, 'S-1-5-18', 'S-1-5-32-544')
if ($Mode -eq 'prepare') {
  [IO.Directory]::CreateDirectory($testTarget) | Out-Null
  $security = Get-Acl -LiteralPath $testTarget
  $security.SetOwner($testUser)
  $security.SetAccessRuleProtection($true, $false)
  foreach ($existing in @($security.Access)) { $security.RemoveAccessRuleSpecific($existing) }
  foreach ($sid in $admitted) {
    $identity = [Security.Principal.SecurityIdentifier]::new($sid)
    $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))
  }
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($testTarget), $security)
}

$security = Get-Acl -LiteralPath $testTarget
if ($Mode -eq 'expose') {
  $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.SecurityIdentifier]::new('S-1-1-0'), 'Read', 'Allow'))
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($testTarget), $security)
  exit 0
}
if ($security.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $testUser.Value) {
  throw 'Test cache owner mismatch'
}
$rules = $security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
if ($rules.Count -eq 0) { throw 'Test cache has no ACL' }
foreach ($rule in $rules) {
  if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $admitted) {
    throw 'Test cache grants access outside its private owner set'
  }
}
