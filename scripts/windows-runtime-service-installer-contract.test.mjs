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
const runner = readFileSync(
  new URL('../tests/local-agent-product/harness/dev-kernel-cross-app-driver.mjs', import.meta.url),
  'utf8',
);
const hostDriver = readFileSync(
  new URL('../tests/local-agent-product/harness/dev-kernel-host-driver.mjs', import.meta.url),
  'utf8',
);
const fixedServiceContract = readFileSync(
  new URL('../tests/local-agent-product/harness/dev-kernel-fixed-service-contract.mjs', import.meta.url),
  'utf8',
);

test('service installer binds the signed binary to the exact repository source record', () => {
  assert.match(installerBuild, /validateRuntimeBuildRecord\(runtimeBuildRecord, \{/u);
  assert.match(installerBuild, /source: captureRuntimeBuildSource\(repoRoot, \{ pathspecs: WINDOWS_RUNTIME_BUILD_SOURCE_PATHS \}\)/u);
  assert.match(installerBuild, /runtimeBuildRecordSha256/u);
  assert.match(installerBuild, /copyFileSync\(runtimeBuildRecordSource/u);
  assert.match(installer, /Assert-InstalledCandidate/u);
  assert.match(installer, /runtimeBuildRecordMatchesCandidate/u);
  assert.match(installer, /checkpointCandidatePostureVerified/u);
});

test('service candidate stages into an immutable version root and moves atomically', () => {
  assert.match(
    installer,
    /\$CandidateVersionId = "\$ExpectedRuntimeSha256-\$ExpectedRuntimeBuildRecordSha256"/u,
  );
  assert.match(installer, /versions\\\$CandidateVersionId/u);
  assert.doesNotMatch(installer, /versions\\\$ExpectedRuntimeSha256["']/u);
  assert.match(installer, /runtimeStartupStage=/u);
  assert.match(installer, /42251\s*=\s*'daemon'/u);
  assert.match(installer, /\.staging-/u);
  assert.match(installer, /Move-Item -LiteralPath \$stagingRoot -Destination \$InstalledVersionRoot/u);
  assert.match(installer, /Assert-FileSha256 -Path \$stagedBinary/u);
  assert.match(installer, /Assert-SignedFile -Path \$stagedBinary/u);
  assert.doesNotMatch(installer, /Copy-Item[^\r\n]*-Destination \$InstalledBinary/u);
});

test('checkpoint profile separates real Realm account authority from the provider fixture', () => {
  assert.match(installer, /schemaVersion\s*=\s*5/u);
  assert.match(installer, /runtimeCandidateId\s*=\s*\$buildRecord\.candidateId/u);
  assert.match(installer, /developmentStateCandidateId\s*=\s*\[string\]\s*\$stateLineage\.developmentStateCandidateId/u);
  assert.match(installer, /acceptanceRoundId\s*=\s*\[string\]\s*\$stateLineage\.acceptanceRoundId/u);
  assert.match(installer, /RandomNumberGenerator/u);
  assert.match(installer, /Resolve-DevKernelCheckpointStateLineage/u);
  assert.match(installer, /signed_installer_preserved_development_state_lineage/u);
  assert.match(installer, /elseif \(\[int\] \$acceptanceProfile\.schemaVersion -eq 4\) \{\s*\[string\] \$acceptanceProfile\.runtimeCandidateId/u);
  assert.match(installer, /developmentDataRootRef\s*=\s*\$resolvedDevelopmentDataRoot/u);
  assert.match(installer, /Resolve-DevKernelCheckpointDataRootBinding/u);
  assert.match(installer, /signed_installer_explicit_operator_selection/u);
  assert.match(installer, /signed_installer_preserved_operator_selection/u);
  assert.match(installer, /developmentDataRootAuthority/u);
  assert.match(installer, /developmentDataRootDisposition/u);
  assert.doesNotMatch(
    installer,
    /Get-DevKernelServiceConfigPath|Sync-DevKernelServiceDataRootConfig|developmentServiceConfigSynchronized/u,
  );
  assert.match(installer, /Existing protected acceptance profile identity is invalid/u);
  assert.match(installer, /\$PreviousProfile\.developmentDataRootRef/u);
  assert.doesNotMatch(installer, /RuntimeUserConfigPath|\$runtimeConfig\.dataRootRef/u);
  assert.match(installer, /DevelopmentDataRoot must be an existing non-reparse directory/u);
  assert.match(installer, /DevelopmentDataRoot path components must be existing non-reparse directories/u);
  assert.match(installer, /foreach \(\$segment in \$resolved\.Substring\(\$volumeRoot\.Length\)/u);
  assert.doesNotMatch(installer, /runtime_candidate_isolated_fallback|candidate_specific_payload_root/u);
  assert.match(installer, /accountRealmBaseUrl\s*=\s*\$fixture\.accountRealmBaseUrl/u);
  assert.match(installer, /fixtureBaseUrl\s*=\s*\$fixture\.fixtureBaseUrl/u);
  assert.match(installer, /providerBaseUrl\s*=\s*\$fixture\.providerBaseUrl/u);
  assert.match(installer, /\$fixture\.accountRealmBaseUrl -ne 'http:\/\/localhost:3002'/u);
  assert.match(installer, /\$fixture\.accountWebBaseUrl -ne 'http:\/\/localhost:3000'/u);
  assert.match(installer, /\$fixture\.fixtureBaseUrl -ne 'http:\/\/127\.0\.0\.1:19443'/u);
  assert.match(installer, /\$fixture\.providerBaseUrl -ne \(\$fixture\.fixtureBaseUrl \+ '\/v1'\)/u);
  assert.doesNotMatch(installer, /realmIssuer\s*=\s*\$fixture\.realmBaseUrl/u);
});

test('first-party product acceptance is an exact signed endpoint-only build profile', () => {
  assert.match(installer, /\[switch\]\s+\$FirstPartyProductAcceptance/u);
  assert.match(installer, /DevKernelCheckpoint and FirstPartyProductAcceptance are mutually exclusive/u);
  assert.match(installer, /first_party_product_acceptance/u);
  assert.match(installer, /\^product-acceptance-runtime-\[0-9a-f\]\{32\}\$/u);
  assert.match(installer, /configuredAccountRealmBaseUrl/u);
  assert.match(installer, /http:\/\/localhost:3002/u);
  assert.match(installer, /productAcceptanceCandidatePostureVerified/u);
  assert.match(installerBuild, /runtimeBuildRecord\.checkpoint === 'dev_kernel_checkpoint'/u);
  assert.match(installerBuild, /rmSync\(path\.join\(resourceOutputDir, 'dev-kernel-checkpoint-acceptance\.json'\)/u);
  assert.doesNotMatch(
    installer.slice(installer.indexOf('function Assert-RequestedBuildProfile'), installer.indexOf('function Assert-InstalledCandidate')),
    /Realm|endpoint|environment/u,
  );
});

test('installer build-profile verifier rejects implicit or cross-profile installation', {
  skip: process.platform !== 'win32',
}, () => {
  const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
  const escapedInstallerPath = installerPath.replaceAll("'", "''");
  const command = [
    `. '${escapedInstallerPath}'`,
    `$FirstPartyProductAcceptance = $true`,
    `$accepted = $true`,
    `Assert-RequestedBuildProfile -BuildRecord ([pscustomobject]@{ checkpoint = 'first_party_product_acceptance' })`,
    `$rejected = $false`,
    `try { Assert-RequestedBuildProfile -BuildRecord ([pscustomobject]@{ checkpoint = 'production_build' }) } catch { $rejected = $true }`,
    `@{ accepted = $accepted; rejected = $rejected } | ConvertTo-Json -Compress`,
  ].join('; ');
  const result = spawnSync(resolveWindowsPowerShell7(), [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { accepted: true, rejected: true });
});

test('service mutation propagates native failures and restores the prior SCM/profile state', () => {
  assert.match(installer, /if \(\$result\.ExitCode -ne 0\) \{/u);
  assert.match(installer, /takeown\.exe[\s\S]*\/grant:r/u);
  assert.match(installer, /if \(\$ownershipChanged\) \{[\s\S]*Set-StateRootAcl/u);
  assert.match(installer, /restore previous service definition/u);
  assert.match(installer, /restore protected acceptance profile/u);
  assert.doesNotMatch(
    installer,
    /previousDevelopmentConfigBytes|Grant-InstallerFileAccess|Set-ServiceOnlyFileAcl/u,
  );
  assert.doesNotMatch(installer, /takeown\.exe[^\r\n]*(?:\/R|\/r)|icacls\.exe[^\r\n]*(?:\/T|\/t)/u);
  assert.match(installer, /restart previous service/u);
  assert.match(installer, /rollback failures:/u);
});

test('an installed service cannot silently create a replacement development lineage', () => {
  const continuityCheck = installer.indexOf('Existing NimiRuntime service has no protected development state lineage');
  const serviceStop = installer.indexOf('if ($previousWasRunning)');
  assert.ok(continuityCheck >= 0 && continuityCheck < serviceStop);
  assert.match(installer, /\$DevKernelCheckpoint -and \$null -ne \$existing -and -not \$previousProfilePresent/u);
  assert.match(installer, /explicit destructive repair is required/u);
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

test('status and runner derive checkpoint posture from immutable candidate material', () => {
  const statusBody = installer.slice(
    installer.indexOf('function Get-Status'),
    installer.indexOf('function Install-Service'),
  );
  assert.doesNotMatch(statusBody, /\$DevKernelCheckpoint/u);
  assert.match(statusBody, /runtimeBuildRecordSha256/u);
  assert.match(statusBody, /checkpointCandidatePostureVerified/u);
  assert.match(fixedServiceContract, /'runtimeBuildRecordMatchesCandidate'/u);
  assert.match(fixedServiceContract, /'checkpointCandidatePostureVerified'/u);
  assert.match(fixedServiceContract, /status\?\.\[field\] !== true/u);
  assert.match(hostDriver, /assertFixedServiceStatus\(status\)/u);
  assert.doesNotMatch(
    hostDriver.slice(hostDriver.indexOf('function readFixedServiceStatus'), hostDriver.indexOf('async function reservePort')),
    /-DevKernelCheckpoint/u,
  );
});

test('PowerShell lineage resolver preserves schema-4 and schema-5 state identities across binary candidates', {
  skip: process.platform !== 'win32',
}, () => {
  const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
  const escapedInstallerPath = installerPath.replaceAll("'", "''");
  const oldCandidate = `dev-kernel-runtime-${'1'.repeat(32)}`;
  const currentCandidate = `dev-kernel-runtime-${'2'.repeat(32)}`;
  const durableCandidate = `dev-kernel-runtime-${'3'.repeat(32)}`;
  const round = `dev-kernel-round-${'4'.repeat(32)}`;
  const command = [
    `. '${escapedInstallerPath}'`,
    `$schema4 = '${JSON.stringify({ schemaVersion: 4, trialId: 'dev-kernel-checkpoint', runtimeCandidateId: oldCandidate, acceptanceRoundId: round })}' | ConvertFrom-Json`,
    `$schema5 = '${JSON.stringify({ schemaVersion: 5, trialId: 'dev-kernel-checkpoint', runtimeCandidateId: oldCandidate, developmentStateCandidateId: durableCandidate, acceptanceRoundId: round })}' | ConvertFrom-Json`,
    `$from4 = Resolve-DevKernelCheckpointStateLineage -PreviousProfile $schema4 -CurrentCandidateId '${currentCandidate}' -TrialId 'dev-kernel-checkpoint'`,
    `$from5 = Resolve-DevKernelCheckpointStateLineage -PreviousProfile $schema5 -CurrentCandidateId '${currentCandidate}' -TrialId 'dev-kernel-checkpoint'`,
    `@{ from4 = $from4; from5 = $from5 } | ConvertTo-Json -Depth 5 -Compress`,
  ].join('; ');
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout.trim());
  assert.deepEqual(parsed.from4, {
    developmentStateCandidateId: oldCandidate,
    acceptanceRoundId: round,
    authority: 'signed_installer_preserved_development_state_lineage',
  });
  assert.deepEqual(parsed.from5, {
    developmentStateCandidateId: durableCandidate,
    acceptanceRoundId: round,
    authority: 'signed_installer_preserved_development_state_lineage',
  });
});
