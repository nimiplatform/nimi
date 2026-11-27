import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { repoRoot } from './context.mjs';
import { buildErrorCodesManifest, extractErrorCodes } from './manifests.mjs';

function makeTempFixture(t) {
  const parentDir = path.join(repoRoot, '.nimi/local');
  fs.mkdirSync(parentDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parentDir, 'sdk-error-codes-test-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    write(relativeName, content) {
      const target = path.join(dir, relativeName);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf8');
      return path.relative(repoRoot, target).replaceAll(path.sep, '/');
    },
  };
}

test('extractErrorCodes derives values in category-row order and matches generated manifests', () => {
  const extracted = extractErrorCodes();
  assert.equal(extracted.contract, 'nimi.sdks.error-codes-manifest.v1');
  assert.deepEqual(extracted.source_paths, ['config/sdks-error-codes.yaml']);
  assert.equal(extracted.codes.length, 243);
  assert.deepEqual(
    extracted.values,
    extracted.codes.map((entry) => entry.name),
  );
  assert.equal(new Set(extracted.values).size, extracted.values.length);
  assert.equal(extracted.values[8], 'SDK_TRANSPORT_INVALID');
  assert.equal(extracted.values[34], 'SDK_MOD_HOST_MISSING');
  assert.equal(extracted.values[35], 'SDK_ADAPTER_FEATURE_UNSUPPORTED');
  assert.equal(extracted.values[36], 'SDK_AI_PROVIDER_BASE64_UNAVAILABLE');
  assert.equal(extracted.codes[8]?.name, 'SDK_TRANSPORT_INVALID');
  assert.equal(extracted.codes[35]?.name, 'SDK_ADAPTER_FEATURE_UNSUPPORTED');

  const sharedManifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'sdks/generators/shared/generated/error-codes.manifest.json'), 'utf8'),
  );
  const tsManifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'sdks/typescript/core-generated/error-codes.manifest.json'), 'utf8'),
  );
  assert.deepEqual(sharedManifest, extracted);
  assert.deepEqual(tsManifest, {
    ...extracted,
    language: 'typescript',
    generated_projection: 'language-core-generated',
  });
});

test('extractErrorCodes derives values in fragment order without hand-maintained values tables', (t) => {
  const fixture = makeTempFixture(t);
  fixture.write('fragments/10-first.yaml', `
table_family: closed_enum
owner: sdks
enum_id: test_error_codes
codes:
  - name: SDK_FIRST_ERROR
    family: SDK_CONFIG
    source_rule: S-ERROR-003
  - name: SDK_SECOND_ERROR
    family: SDK_HOST
    source_rule: S-ERROR-003
`);
  fixture.write('fragments/20-second.yaml', `
table_family: closed_enum
owner: sdks
enum_id: test_error_codes
codes:
  - name: RUNTIME_UNAVAILABLE
    family: SDK_SYNTHETIC_REASON
    source_rule: S-ERROR-010
    note: Synthetic retryable error
`);
  const rootRel = fixture.write('root.yaml', `
version: 1
table_family: closed_enum
owner: sdks
enum_id: test_error_codes
fragments:
  codes:
    - fragments/10-first.yaml
    - fragments/20-second.yaml
`);

  const manifest = extractErrorCodes(rootRel);
  assert.deepEqual(manifest.source_paths, [rootRel]);
  assert.deepEqual(manifest.values, [
    'SDK_FIRST_ERROR',
    'SDK_SECOND_ERROR',
    'RUNTIME_UNAVAILABLE',
  ]);
  assert.deepEqual(manifest.codes, [
    { name: 'SDK_FIRST_ERROR', family: 'SDK_CONFIG', source_rule: 'S-ERROR-003' },
    { name: 'SDK_SECOND_ERROR', family: 'SDK_HOST', source_rule: 'S-ERROR-003' },
    {
      name: 'RUNTIME_UNAVAILABLE',
      family: 'SDK_SYNTHETIC_REASON',
      source_rule: 'S-ERROR-010',
      note: 'Synthetic retryable error',
    },
  ]);
});

test('extractErrorCodes rejects hand-maintained values in root or fragment files', (t) => {
  const fixture = makeTempFixture(t);
  fixture.write('fragments/clean.yaml', `
codes:
  - name: SDK_CLEAN_CODE
    family: SDK_CONFIG
    source_rule: S-ERROR-003
`);
  fixture.write('fragments/with-values.yaml', `
values:
  - SDK_FRAGMENT_VALUE
codes:
  - name: SDK_FRAGMENT_VALUE
    family: SDK_CONFIG
    source_rule: S-ERROR-003
`);
  const rootWithValues = fixture.write('root-with-values.yaml', `
values:
  - SDK_CLEAN_CODE
fragments:
  codes:
    - fragments/clean.yaml
`);
  const rootWithValuesFragment = fixture.write('root-with-values-fragment.yaml', `
fragments:
  values:
    - fragments/with-values.yaml
  codes:
    - fragments/clean.yaml
`);
  const rootPointingToFragmentValues = fixture.write('root-fragment-values.yaml', `
fragments:
  codes:
    - fragments/with-values.yaml
`);

  assert.throws(() => extractErrorCodes(rootWithValues), /must not declare hand-maintained values/);
  assert.throws(() => extractErrorCodes(rootWithValuesFragment), /must not declare hand-maintained values fragments/);
  assert.throws(() => extractErrorCodes(rootPointingToFragmentValues), /must not declare hand-maintained values/);
});

test('buildErrorCodesManifest fails closed on duplicate or malformed category rows', () => {
  assert.throws(
    () => buildErrorCodesManifest({ codes: [] }),
    /must declare non-empty codes/,
  );
  assert.throws(
    () => buildErrorCodesManifest({
      values: ['SDK_ONE'],
      codes: [{ name: 'SDK_ONE', family: 'SDK_CONFIG', source_rule: 'S-ERROR-003' }],
    }),
    /must not declare hand-maintained values/,
  );
  assert.throws(
    () => buildErrorCodesManifest({
      codes: [
        { name: 'SDK_DUP', family: 'SDK_CONFIG', source_rule: 'S-ERROR-003' },
        { name: 'SDK_DUP', family: 'SDK_HOST', source_rule: 'S-ERROR-003' },
      ],
    }),
    /duplicate codes entry: SDK_DUP/,
  );
  assert.throws(
    () => buildErrorCodesManifest({
      codes: [{ name: 'sdk_lower', family: 'SDK_CONFIG', source_rule: 'S-ERROR-003' }],
    }),
    /not UPPER_SNAKE_CASE/,
  );
  assert.throws(
    () => buildErrorCodesManifest({
      codes: [{ name: 'SDK_NO_FAMILY', family: '', source_rule: 'S-ERROR-003' }],
    }),
    /invalid family/,
  );
  assert.throws(
    () => buildErrorCodesManifest({
      codes: [{ name: 'SDK_NO_RULE', family: 'SDK_CONFIG', source_rule: '   ' }],
    }),
    /missing source_rule/,
  );
  assert.throws(
    () => buildErrorCodesManifest({
      codes: [{ name: 'SDK_BAD_NOTE', family: 'SDK_CONFIG', source_rule: 'S-ERROR-003', note: '' }],
    }),
    /invalid note/,
  );
});
