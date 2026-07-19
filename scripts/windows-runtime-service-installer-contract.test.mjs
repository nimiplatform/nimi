import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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
  assert.match(installerBuild, /source: captureRuntimeBuildSource\(repoRoot\)/u);
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
  assert.match(installer, /Sync-DevKernelServiceDataRootConfig/u);
  assert.match(installer, /developmentServiceConfigSynchronized/u);
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

test('service mutation propagates native failures and restores the prior SCM/profile state', () => {
  assert.match(installer, /if \(\$result\.ExitCode -ne 0\) \{/u);
  assert.match(installer, /takeown\.exe[\s\S]*\/grant:r/u);
  assert.match(installer, /if \(\$ownershipChanged\) \{[\s\S]*Set-StateRootAcl/u);
  assert.match(installer, /restore previous service definition/u);
  assert.match(installer, /restore protected acceptance profile/u);
  assert.match(installer, /previousDevelopmentConfigBytes/u);
  assert.match(installer, /configRestoreTemporary/u);
  assert.match(installer, /restart previous service/u);
  assert.match(installer, /rollback failures:/u);
});

test('PowerShell updater synchronizes an existing service config without replacing unrelated admitted fields', {
  skip: process.platform !== 'win32',
}, () => {
  const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-installer-config-'));
  try {
    const configPath = path.join(temporaryRoot, 'config.json');
    const developmentDataRoot = path.join(temporaryRoot, 'nimi-data');
    mkdirSync(developmentDataRoot, { recursive: true });
    writeFileSync(configPath, `${JSON.stringify({
      schemaVersion: 1,
      dataRootRef: path.join(temporaryRoot, 'old-data'),
      managedRoots: {},
      logLevel: 'debug',
    })}\n`, 'utf8');
    const quote = (value) => value.replaceAll("'", "''");
    const command = [
      `. '${quote(installerPath)}'`,
      `$first = Sync-DevKernelServiceDataRootConfig -ConfigPath '${quote(configPath)}' -DevelopmentDataRoot '${quote(developmentDataRoot)}'`,
      `$second = Sync-DevKernelServiceDataRootConfig -ConfigPath '${quote(configPath)}' -DevelopmentDataRoot '${quote(developmentDataRoot)}'`,
      `$config = Get-Content -LiteralPath '${quote(configPath)}' -Raw | ConvertFrom-Json`,
      `@{ first = $first; second = $second; config = $config } | ConvertTo-Json -Depth 10 -Compress`,
    ].join('; ');
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.first, true);
    assert.equal(parsed.second, false);
    assert.equal(parsed.config.dataRootRef, developmentDataRoot);
    assert.equal(parsed.config.logLevel, 'debug');
    assert.deepEqual(parsed.config.managedRoots, {
      models: path.join(developmentDataRoot, 'models'),
      dependencies: path.join(developmentDataRoot, 'dependencies'),
      environments: path.join(developmentDataRoot, 'environments'),
      logs: path.join(developmentDataRoot, 'logs'),
      audit: path.join(developmentDataRoot, 'audit'),
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
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
