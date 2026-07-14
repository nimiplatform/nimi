import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.match(installer, /schemaVersion\s*=\s*4/u);
  assert.match(installer, /runtimeCandidateId\s*=\s*\$buildRecord\.candidateId/u);
  assert.match(installer, /acceptanceRoundId\s*=\s*New-DevKernelAcceptanceRoundId/u);
  assert.match(installer, /RandomNumberGenerator/u);
  assert.match(installer, /developmentDataRootRef\s*=\s*\$resolvedDevelopmentDataRoot/u);
  assert.match(installer, /DevelopmentDataRoot must be an existing non-reparse directory/u);
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
  assert.match(installer, /restart previous service/u);
  assert.match(installer, /rollback failures:/u);
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
  assert.match(runner, /assertFixedServiceStatus\(status\)/u);
  assert.doesNotMatch(
    runner.slice(runner.indexOf('function readFixedServiceStatus'), runner.indexOf('async function reservePort')),
    /-DevKernelCheckpoint/u,
  );
});
