import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  createRuntimeBuildRecord,
  validateRuntimeBuildRecord,
} from './lib/runtime-build-record.mjs';

test('runtime build record binds the candidate to its source and binary', () => {
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
    generatedAt: '2026-07-13T00:00:00.000Z',
  });
  assert.equal(validateRuntimeBuildRecord(record, { source }), record);
  assert.match(record.candidateId, /^runtime-[0-9a-f]{32}$/u);
  const tampered = structuredClone(record);
  tampered.runtime.binarySha256 = '7'.repeat(64);
  assert.throws(() => validateRuntimeBuildRecord(tampered), /candidate id does not recompute/u);
});
