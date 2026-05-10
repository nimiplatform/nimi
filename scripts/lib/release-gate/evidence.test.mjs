// Tests for scripts/lib/release-gate/evidence.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  EVIDENCE_SCHEMA_VERSION,
  defaultEvidencePath,
  buildGateRow,
  computeSummary,
  buildEvidenceDocument,
  writeEvidenceFile,
  assertEvidenceShape,
} from './evidence.mjs';

test('schema version locked at v1', () => {
  assert.equal(EVIDENCE_SCHEMA_VERSION, 'release-gate-evidence/v1');
});

test('defaultEvidencePath includes safe timestamp', () => {
  const p = defaultEvidencePath('2026-05-10T10:30:45.123Z');
  assert.match(p, /preflight-evidence-2026-05-10T10-30-45-123Z\.json$/);
});

test('buildGateRow rejects invalid verdict', () => {
  assert.throws(() =>
    buildGateRow({
      gateId: 'gate.test.x',
      tier: 'fast',
      target: 'any',
      command: 'echo',
      startedAt: '2026-05-10T00:00:00Z',
      finishedAt: '2026-05-10T00:00:01Z',
      verdict: 'warn',
    })
  );
});

test('buildGateRow defaults blocker_reason_code/exit_code/log_excerpt_path to null', () => {
  const r = buildGateRow({
    gateId: 'gate.test.x',
    tier: 'fast',
    target: 'any',
    command: 'echo',
    startedAt: '2026-05-10T00:00:00Z',
    finishedAt: '2026-05-10T00:00:01Z',
    verdict: 'pass',
  });
  assert.equal(r.blocker_reason_code, null);
  assert.equal(r.exit_code, null);
  assert.equal(r.log_excerpt_path, null);
});

test('computeSummary tallies all four verdicts', () => {
  const rows = [
    { verdict: 'pass' },
    { verdict: 'pass' },
    { verdict: 'fail' },
    { verdict: 'blocked' },
    { verdict: 'unreachable' },
  ];
  const s = computeSummary(rows);
  assert.deepEqual(s, {
    pass_count: 2,
    fail_count: 1,
    blocked_count: 1,
    unreachable_count: 1,
  });
});

test('buildEvidenceDocument produces v1 shape', () => {
  const doc = buildEvidenceDocument({
    profileId: 'nimi',
    registryVersion: '1.0.0',
    startedAt: '2026-05-10T00:00:00Z',
    finishedAt: '2026-05-10T00:00:01Z',
    hostEnvironment: { os: 'darwin-arm64', node_version: 'v24.11.0', ci: false },
    tierFilter: 'release',
    targetFilter: 'any',
    requireRelease: true,
    gateRows: [
      buildGateRow({
        gateId: 'gate.test.x',
        tier: 'release',
        target: 'any',
        command: 'echo',
        startedAt: '2026-05-10T00:00:00Z',
        finishedAt: '2026-05-10T00:00:01Z',
        verdict: 'pass',
      }),
    ],
  });
  assert.equal(doc.schema_version, EVIDENCE_SCHEMA_VERSION);
  assert.equal(doc.profile_id, 'nimi');
  assert.equal(doc.summary.pass_count, 1);
  assert.equal(doc.summary.fail_count, 0);
  assert.equal(doc.require_release, true);
});

test('assertEvidenceShape rejects missing fields', () => {
  assert.throws(() => assertEvidenceShape({}));
  assert.throws(() =>
    assertEvidenceShape({
      schema_version: 'wrong/v1',
      profile_id: 'x',
      registry_version: '1',
      started_at: 't',
      finished_at: 't',
      host_environment: {},
      tier_filter: 't',
      target_filter: 'any',
      require_release: false,
      gates: [],
      summary: { pass_count: 0, fail_count: 0, blocked_count: 0, unreachable_count: 0 },
    })
  );
});

test('writeEvidenceFile writes deterministic JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
  try {
    const doc = buildEvidenceDocument({
      profileId: 'nimi',
      registryVersion: '1.0.0',
      startedAt: '2026-05-10T00:00:00Z',
      finishedAt: '2026-05-10T00:00:01Z',
      hostEnvironment: { os: 'darwin-arm64', node_version: 'v24.11.0', ci: false },
      tierFilter: 'release',
      targetFilter: 'any',
      requireRelease: false,
      gateRows: [],
    });
    const out = path.join(tmp, 'ev.json');
    const written = writeEvidenceFile(doc, out);
    assert.equal(written, out);
    const text = fs.readFileSync(out, 'utf8');
    assert.match(text, /"schema_version": "release-gate-evidence\/v1"/);
    assert.match(text, /\n$/, 'trailing newline expected');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
