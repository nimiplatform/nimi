import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { resolveWindowsPowerShell7 } from './lib/windows-powershell.mjs';

const installer = readFileSync(
  new URL('./install-windows-runtime-service.ps1', import.meta.url),
  'utf8',
);
const installerBuild = readFileSync(
  new URL('./build-windows-runtime-service-installer.mjs', import.meta.url),
  'utf8',
);

test('service installer binds the signed binary to the exact repository source record', () => {
  assert.match(installerBuild, /validateRuntimeBuildRecord\(runtimeBuildRecord, \{/u);
  assert.match(installerBuild, /source: captureRuntimeBuildSource\(repoRoot, \{ pathspecs: WINDOWS_RUNTIME_BUILD_SOURCE_PATHS \}\)/u);
  assert.match(installerBuild, /runtimeBuildRecordSha256/u);
  assert.match(installerBuild, /copyFileSync\(runtimeBuildRecordSource/u);
  assert.match(installer, /Assert-InstalledCandidate/u);
  assert.match(installer, /runtimeBuildRecordMatchesCandidate/u);
});

test('service candidate stages into an immutable version root and moves atomically', () => {
  assert.match(
    installer,
    /\$CandidateVersionId = "\$ExpectedRuntimeSha256-\$ExpectedRuntimeBuildRecordSha256"/u,
  );
  assert.match(installer, /versions\\\$CandidateVersionId/u);
  assert.doesNotMatch(installer, /versions\\\$ExpectedRuntimeSha256["']/u);
  assert.match(installer, /runtimeStartupStage=/u);
  assert.match(installer, /42250\s*=\s*'daemon'/u);
  assert.match(installer, /\.staging-/u);
  assert.match(installer, /Move-Item -LiteralPath \$stagingRoot -Destination \$InstalledVersionRoot/u);
  assert.match(installer, /Assert-FileSha256 -Path \$stagedBinary/u);
  assert.match(installer, /Assert-SignedFile -Path \$stagedBinary/u);
  assert.doesNotMatch(installer, /Copy-Item[^\r\n]*-Destination \$InstalledBinary/u);
});

test('service mutation propagates native failures and restores the prior SCM/state ownership', () => {
  assert.match(installer, /if \(\$result\.ExitCode -ne 0\) \{/u);
  assert.match(installer, /takeown\.exe[\s\S]*\/grant:r/u);
  assert.match(installer, /if \(\$ownershipChanged\) \{[\s\S]*Set-StateRootAcl/u);
  assert.match(installer, /restore previous service definition/u);
  assert.match(installer, /restore protected state ownership/u);
  assert.doesNotMatch(
    installer,
    /previousDevelopmentConfigBytes|Grant-InstallerFileAccess|Set-ServiceOnlyFileAcl/u,
  );
  assert.doesNotMatch(installer, /takeown\.exe[^\r\n]*(?:\/R|\/r)|icacls\.exe[^\r\n]*(?:\/T|\/t)/u);
  assert.match(installer, /restart previous service/u);
  assert.match(installer, /rollback failures:/u);
});

test('protected existing state root is taken over before any create attempt', {
  skip: process.platform !== 'win32',
}, () => {
  const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
  const escapedInstallerPath = installerPath.replaceAll("'", "''");
  const command = [
    `. '${escapedInstallerPath}'`,
    `$StateRoot = 'C:\\protected-existing'`,
    `$calls = [System.Collections.Generic.List[string]]::new()`,
    `function Invoke-NativeCommand { param([string] $FilePath, [string[]] $Arguments); $calls.Add($FilePath + ' ' + ($Arguments -join ' ')); [pscustomobject]@{ ExitCode = 0; StdOut = ''; StdErr = '' } }`,
    `function New-Item { throw 'create must not run for an existing protected root' }`,
    `Grant-InstallerStateAccess`,
    `$calls | ConvertTo-Json -Compress`,
  ].join('; ');
  const result = spawnSync(resolveWindowsPowerShell7(), [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()), [
    'takeown.exe /F C:\\protected-existing /A',
    'icacls.exe C:\\protected-existing /grant:r *S-1-5-32-544:(OI)(CI)F',
  ]);
});

test('status validates the installed build record from immutable candidate material', () => {
  const statusBody = installer.slice(
    installer.indexOf('function Get-Status'),
    installer.indexOf('function Install-Service'),
  );
  assert.match(statusBody, /runtimeBuildRecordSha256/u);
  assert.match(statusBody, /runtimeBuildRecordMatchesCandidate\s*=\s*\$null -ne \$runtimeBuildRecord/u);
});
