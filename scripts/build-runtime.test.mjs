import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createRuntimeBuildRecord,
  validateRuntimeBuildRecord,
} from './lib/runtime-build-record.mjs';

const buildRuntimeSource = readFileSync(new URL('./build-runtime.mjs', import.meta.url), 'utf8');
const goTestSignerSource = readFileSync(new URL('./windows-go-test-exec-signer.ps1', import.meta.url), 'utf8');

test('build-runtime uses the unified Windows dev signing helper only', () => {
  assert.match(buildRuntimeSource, /windows-dev-signing\.mjs/);
  assert.match(buildRuntimeSource, /signWindowsDevFiles\(\[outputPath\]/);
  assert.doesNotMatch(buildRuntimeSource, /New-SelfSignedCertificate/);
  assert.doesNotMatch(buildRuntimeSource, /TrustedPublisher/);
  assert.doesNotMatch(buildRuntimeSource, /certutil\.exe/);
});

test('build-runtime signs only the current runtime binary', () => {
  assert.match(buildRuntimeSource, /signWindowsDevFiles\(\[outputPath\]/);
  assert.doesNotMatch(buildRuntimeSource, /nimi-dev\.exe/);
  assert.doesNotMatch(buildRuntimeSource, /signTargets/);
});

test('build-runtime emits a source-bound non-release candidate record', () => {
  assert.match(buildRuntimeSource, /captureRuntimeBuildSource\(repoRoot, \{ pathspecs: WINDOWS_RUNTIME_BUILD_SOURCE_PATHS \}\)/);
  assert.match(buildRuntimeSource, /assertRuntimeBuildSourceUnchanged\(buildSource, repoRoot, \{ pathspecs: WINDOWS_RUNTIME_BUILD_SOURCE_PATHS \}\)/);
  assert.match(buildRuntimeSource, /nimi-build-record\.json/);
  const source = {
    repositoryId: 'nimi',
    headCommit: '1'.repeat(40),
    branch: 'refactory/third-party',
    dirty: true,
    trackedDiffSha256: '2'.repeat(64),
    untrackedFiles: [{ path: 'runtime/new.go', sha256: '3'.repeat(64) }],
    sourceTreeSha256: '4'.repeat(64),
    dirtyDescriptorSha256: '',
  };
  const descriptor = { ...source };
  delete descriptor.dirtyDescriptorSha256;
  const canonical = (value) => Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
      : JSON.stringify(value);
  source.dirtyDescriptorSha256 = createHash('sha256').update(canonical(descriptor)).digest('hex');
  const record = createRuntimeBuildRecord({
    source,
    runtimeBinarySha256: '5'.repeat(64),
    signerCertificateSha256: '6'.repeat(64),
    buildProfile: 'dev_kernel_checkpoint',
    generatedAt: '2026-07-13T00:00:00.000Z',
  });
  assert.equal(validateRuntimeBuildRecord(record, { source, requireDevKernel: true }), record);
  const tampered = structuredClone(record);
  tampered.runtime.binarySha256 = '7'.repeat(64);
  assert.throws(() => validateRuntimeBuildRecord(tampered, { requireDevKernel: true }), /candidate id does not recompute/u);
});

test('build-runtime keeps first-party product acceptance distinct from production and dev-kernel', () => {
  const source = {
    repositoryId: 'nimi',
    headCommit: '1'.repeat(40),
    branch: 'refactory/third-party',
    dirty: false,
    trackedDiffSha256: '2'.repeat(64),
    untrackedFiles: [],
    sourceTreeSha256: '3'.repeat(64),
    dirtyDescriptorSha256: '',
  };
  const descriptor = { ...source };
  delete descriptor.dirtyDescriptorSha256;
  const canonical = (value) => Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
      : JSON.stringify(value);
  source.dirtyDescriptorSha256 = createHash('sha256').update(canonical(descriptor)).digest('hex');
  const record = createRuntimeBuildRecord({
    source,
    runtimeBinarySha256: '4'.repeat(64),
    signerCertificateSha256: '5'.repeat(64),
    buildProfile: 'first_party_product_acceptance',
    generatedAt: '2026-07-23T00:00:00.000Z',
  });
  assert.equal(record.checkpoint, 'first_party_product_acceptance');
  assert.equal(record.nonRelease, true);
  assert.match(record.candidateId, /^product-acceptance-runtime-[0-9a-f]{32}$/u);
  assert.equal(validateRuntimeBuildRecord(record, { source, requireProductAcceptance: true }), record);
  assert.throws(
    () => validateRuntimeBuildRecord(record, { requireDevKernel: true }),
    /checkpoint posture is invalid/u,
  );
  assert.throws(
    () => createRuntimeBuildRecord({
      source,
      runtimeBinarySha256: '4'.repeat(64),
      signerCertificateSha256: '5'.repeat(64),
      buildProfile: 'combined-acceptance-profile',
    }),
    /build profile is invalid/u,
  );
  assert.match(buildRuntimeSource, /--first-party-product-acceptance/u);
  assert.match(buildRuntimeSource, /windowsFirstPartyProductAcceptanceEnabled=true/u);
});

test('build-runtime reports a running Windows runtime binary before signing', () => {
  assert.match(buildRuntimeSource, /findWindowsRuntimeBinaryOwners/);
  assert.match(buildRuntimeSource, /Get-CimInstance Win32_Process/);
  assert.match(buildRuntimeSource, /assertWindowsRuntimeBinaryNotRunning\(outputPath\)/);
  assert.match(buildRuntimeSource, /cannot rebuild runtime binary/);
  assert.match(buildRuntimeSource, /Stop the running runtime first/);
  assert.match(buildRuntimeSource, /pnpm dev:runtime/);
});

test('windows go test signer shares the runtime development signing helper', () => {
  assert.match(goTestSignerSource, /windows-dev-signing\.ps1/);
  assert.match(goTestSignerSource, /-Mode Sign/);
  assert.match(goTestSignerSource, /-Json \| Out-Null/);
  assert.doesNotMatch(goTestSignerSource, /Nimi Local Go Test Code Signing/);
  assert.doesNotMatch(goTestSignerSource, /New-SelfSignedCertificate/);
});
