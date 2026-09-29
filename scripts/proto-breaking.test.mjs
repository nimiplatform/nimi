import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BASELINE_IMAGE_PATH,
  breakingFindings,
  buildWireImage,
  classifyFindings,
  readBaselineRecord,
  requireBuf,
  resolveBuf,
  sha256,
  validateBaselineRecord,
  verifyBaselineProvenance,
  verifyMigrationReferences,
  withTempDir,
} from './lib/proto-wire-baseline.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineImage = path.join(repoRoot, BASELINE_IMAGE_PATH);
const buf = resolveBuf();
// The proto CI lane sets this so a missing buf fails instead of skipping.
const bufSkip = !buf && process.env.NIMI_PROTO_GATE_REQUIRE_BUF !== '1' ? 'buf is not installed' : false;

const migration = { file: 'sdks/typescript/CHANGELOG.md', heading: '0.20.0' };
const finding = { rule: 'FIELD_NO_DELETE', path: 'runtime/v1/ai.proto', message: 'Previously present field "3" with name "a" on message "B" was deleted.' };

function committedRecord() {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'runtime/proto/runtime-v1.baseline.json'), 'utf8'));
}

// Mutates a copy of the repository proto; every edit must actually apply.
function withEditedProto(edits, callback) {
  return withTempDir('nimi-proto-fixture-', (dir) => {
    const protoDir = path.join(dir, 'proto');
    fs.cpSync(path.join(repoRoot, 'proto'), protoDir, { recursive: true });
    for (const { file, from, to } of edits) {
      const target = path.join(protoDir, file);
      const source = fs.readFileSync(target, 'utf8');
      assert.ok(source.includes(from), `fixture edit target is missing from ${file}: ${from}`);
      fs.writeFileSync(target, source.replace(from, to));
    }
    return callback(protoDir, dir);
  });
}

test('the committed record names a published wire-carrying tag and validates', () => {
  const record = readBaselineRecord(repoRoot);
  assert.match(record.source.tag, /^sdk\/v\d+\.\d+\.\d+$/u);
  assert.equal(record.image.sha256, sha256(fs.readFileSync(baselineImage)));
  assert.deepEqual(record.declaredBreaking, []);
});

test('record validation rejects unpublished or unexplained sources and declarations', () => {
  const reject = (mutate, pattern) => {
    const record = committedRecord();
    mutate(record);
    assert.throws(() => validateBaselineRecord(record), pattern);
  };
  reject((record) => { record.source.tag = 'v0.15.0'; }, /source\.tag is invalid/u);
  reject((record) => { record.source.tag = 'app-tools/v0.7.5'; }, /source\.tag is invalid/u);
  reject((record) => { record.source.commit = 'HEAD'; }, /source\.commit is invalid/u);
  reject((record) => { record.source.publishedArtifacts = []; }, /publishedArtifacts/u);
  reject((record) => { record.source.publishedArtifacts = ['@nimiplatform/sdk@0.15.0']; }, /publishedArtifacts\[0\] is invalid/u);
  reject((record) => { record.refresh.adjudication = ''; }, /refresh\.adjudication/u);
  reject((record) => { record.image.format = 'buf-image'; }, /image\.format/u);
  reject((record) => { record.extra = true; }, /must contain exactly/u);
  reject((record) => { record.declaredBreaking = [{ ...finding, reason: 'r' }]; }, /must contain exactly/u);
  reject((record) => { record.declaredBreaking = [{ ...finding, reason: '', migration }]; }, /reason/u);
  reject((record) => {
    record.declaredBreaking = [{ ...finding, reason: 'r', migration }, { ...finding, reason: 'again', migration }];
  }, /duplicates/u);
  reject((record) => {
    record.declaredBreaking = [{ ...finding, reason: 'r', migration: { file: 'README.md', heading: 'x' } }];
  }, /migration\.file is invalid/u);
});

test('every finding needs a declaration and every declaration needs a finding', () => {
  const other = { ...finding, message: 'Previously present RPC "X" on service "Y" was deleted.', rule: 'RPC_NO_DELETE' };
  const declaration = { ...finding, reason: 'r', migration };
  assert.deepEqual(classifyFindings([finding], [declaration]), { declared: [finding], undeclared: [], stale: [] });
  assert.deepEqual(classifyFindings([finding, other], [declaration]).undeclared, [other]);
  assert.deepEqual(classifyFindings([], [declaration]).stale, [declaration]);
  // Line numbers move with ordinary edits and never decide the match.
  assert.equal(classifyFindings([{ ...finding, line: 42 }], [declaration]).undeclared.length, 0);
});

test('a declared break must point at an existing migration heading', () => {
  withTempDir('nimi-proto-migration-', (dir) => {
    fs.mkdirSync(path.join(dir, 'sdks', 'typescript'), { recursive: true });
    fs.writeFileSync(path.join(dir, migration.file), '# SDK migration notes\n\n## 0.20.0\n\n- Removed.\n');
    verifyMigrationReferences(dir, [migration]);
    assert.throws(() => verifyMigrationReferences(dir, [{ ...migration, heading: '0.21.0' }]), /heading "0\.21\.0" is missing/u);
    assert.throws(() => verifyMigrationReferences(dir, [{ file: 'kit/CHANGELOG.md', heading: 'x' }]), /does not exist/u);
  });
});

test('deleting definitions published after the retired snapshot fails against the published wire', { skip: bufSkip }, () => {
  const tool = requireBuf(buf);
  const edits = [
    { file: 'runtime/v1/ai.proto', from: '  SCENARIO_TYPE_TEXT_ANNOTATE = 16;\n', to: '' },
    { file: 'runtime/v1/capability_configuration.proto', from: '  VoiceReferenceInputCapabilities reference_audio_input = 11;\n', to: '' },
    { file: 'runtime/v1/ai.proto', from: '  rpc OpenVideoSession(OpenVideoSessionRequest) returns (OpenVideoSessionResponse);\n', to: '' },
  ];
  const findings = withEditedProto(edits, (protoDir) => breakingFindings({ buf: tool, protoDir, againstImage: baselineImage }));
  assert.deepEqual(findings.map(({ rule, path: file }) => `${rule} ${file}`).sort(), [
    'ENUM_VALUE_NO_DELETE runtime/v1/ai.proto',
    'FIELD_NO_DELETE runtime/v1/capability_configuration.proto',
    'RPC_NO_DELETE runtime/v1/ai.proto',
  ]);
  assert.ok(findings.some((item) => item.message.includes('"reference_audio_input"')));
  assert.ok(findings.some((item) => item.message.includes('"OpenVideoSession"')));
});

test('unchanged and additive proto passes against the published wire', { skip: bufSkip }, () => {
  const tool = requireBuf(buf);
  assert.deepEqual(breakingFindings({ buf: tool, protoDir: path.join(repoRoot, 'proto'), againstImage: baselineImage }), []);
  const additive = [
    { file: 'runtime/v1/ai.proto', from: '  SCENARIO_TYPE_TEXT_ANNOTATE = 16;\n', to: '  SCENARIO_TYPE_TEXT_ANNOTATE = 16;\n  SCENARIO_TYPE_GATE_FIXTURE = 999;\n' },
  ];
  assert.deepEqual(withEditedProto(additive, (protoDir) => breakingFindings({ buf: tool, protoDir, againstImage: baselineImage })), []);
});

test('source that does not compile fails instead of producing findings', { skip: bufSkip }, () => {
  const tool = requireBuf(buf);
  const broken = [{ file: 'runtime/v1/common.proto', from: 'syntax = "proto3";', to: 'syntax = "proto3";\nmessage GateFixture {' }];
  assert.throws(
    () => withEditedProto(broken, (protoDir) => breakingFindings({ buf: tool, protoDir, againstImage: baselineImage })),
    /proto source does not compile/u,
  );
});

test('the committed image rebuilds from the recorded published tag and a self-stamped image does not', { skip: bufSkip }, () => {
  const tool = requireBuf(buf);
  const record = readBaselineRecord(repoRoot);
  verifyBaselineProvenance({ repoRoot, record, buf: tool });

  // A refresh from unpublished source, even with a matching recorded digest.
  const additive = [{ file: 'runtime/v1/ai.proto', from: '  SCENARIO_TYPE_TEXT_ANNOTATE = 16;\n', to: '  SCENARIO_TYPE_TEXT_ANNOTATE = 16;\n  SCENARIO_TYPE_GATE_FIXTURE = 999;\n' }];
  withEditedProto(additive, (protoDir, dir) => {
    const imagePath = path.join(dir, 'self-stamped.binpb');
    const bytes = buildWireImage({ buf: tool, protoDir, outputPath: imagePath });
    const stamped = { ...record, image: { ...record.image, sha256: sha256(bytes) } };
    assert.throws(() => verifyBaselineProvenance({ repoRoot, record: stamped, buf: tool, imagePath }), /is not the wire published at/u);
  });
  assert.throws(
    () => verifyBaselineProvenance({ repoRoot, record: { ...record, source: { ...record.source, commit: '0'.repeat(40) } }, buf: tool }),
    /not the recorded published commit/u,
  );
  assert.throws(
    () => verifyBaselineProvenance({ repoRoot, record: { ...record, source: { ...record.source, tag: 'sdk/v999.0.0' } }, buf: tool }),
    /is not available locally; fetch it/u,
  );
  withTempDir('nimi-proto-digest-', (dir) => {
    const imagePath = path.join(dir, 'copy.binpb');
    fs.writeFileSync(imagePath, Buffer.concat([fs.readFileSync(baselineImage), Buffer.from([0])]));
    assert.throws(() => verifyBaselineProvenance({ repoRoot, record, buf: tool, imagePath }), /does not match the sha256/u);
  });
});
