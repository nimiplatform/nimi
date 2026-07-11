import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const gateRelative = 'scripts/check-installed-realm-owner-boundary.mjs';

const bundleFiles = [
  gateRelative,
  '.nimi/spec/runtime/kernel/account-session-contract.md',
  '.nimi/spec/runtime/kernel/tables/rule-evidence.rules-core-auth.yaml',
  '.nimi/spec/platform/kernel/nimi-app-admission-contract.md',
  '.nimi/spec/platform/kernel/kit-contract.md',
  '.nimi/spec/platform/kernel/tables/rule-evidence.rules-nimi-app.yaml',
  '.nimi/spec/platform/kernel/tables/rule-evidence.rules-kit.yaml',
  '.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml',
  '.nimi/spec/sdks/kernel/runtime-contract.md',
  '.nimi/spec/sdks/kernel/realm-contract.md',
  '.nimi/spec/sdks/kernel/tables/rule-evidence.rules-runtime-client.yaml',
  '.nimi/spec/sdks/kernel/tables/rule-evidence.rules-domain-adapters.yaml',
  '.nimi/spec/desktop/kernel/network-contract.md',
  '.nimi/spec/desktop/kernel/tables/rule-evidence.rules-shell-ui.yaml',
];

const detailedRules = [
  ['K-ACCSVC-022', '.nimi/spec/runtime/kernel/account-session-contract.md'],
  ['K-ACCSVC-023', '.nimi/spec/runtime/kernel/account-session-contract.md'],
  ['K-ACCSVC-024', '.nimi/spec/runtime/kernel/account-session-contract.md'],
  ['K-ACCSVC-025', '.nimi/spec/runtime/kernel/account-session-contract.md'],
  ['P-NAPP-033', '.nimi/spec/platform/kernel/nimi-app-admission-contract.md'],
  ['P-NAPP-034', '.nimi/spec/platform/kernel/nimi-app-admission-contract.md'],
  ['S-REALM-035', '.nimi/spec/sdks/kernel/realm-contract.md'],
  ['S-REALM-036', '.nimi/spec/sdks/kernel/realm-contract.md'],
  ['S-REALM-037', '.nimi/spec/sdks/kernel/realm-contract.md'],
  ['D-NET-007', '.nimi/spec/desktop/kernel/network-contract.md'],
];

const a0SplitRules = [
  ['K-ACCSVC-022', '.nimi/spec/runtime/kernel/account-session-contract.md', '`K-PLOCAL-008` admits a Windows installed session', '`K-PLOCAL-008` does not admit a Windows installed session'],
  ['K-ACCSVC-024', '.nimi/spec/runtime/kernel/account-session-contract.md', '**A.0 authority disposition:**', '**A.0 authority disposition removed:**'],
  ['K-ACCSVC-025', '.nimi/spec/runtime/kernel/account-session-contract.md', 'A.1\nauthority comes only from the inherited native channel', 'A.1\nauthority does not come from the inherited native channel'],
  ['P-NAPP-034', '.nimi/spec/platform/kernel/nimi-app-admission-contract.md', '**A.0 authority disposition:** Admitted per OS platform:', '**A.0 authority disposition:** Removed:'],
];

const expectedFixtureCodes = [
  'APP_ID_AUTHORIZATION_FORBIDDEN',
  'MANIFEST_AUTHORIZATION_FORBIDDEN',
  'RENDERER_METADATA_AUTHORIZATION_FORBIDDEN',
  'APP_HOST_SELF_DESCRIPTION_AUTHORIZATION_FORBIDDEN',
  'HOST_REALM_CREDENTIAL_CUSTODY_FORBIDDEN',
  'RENDERER_REALM_CREDENTIAL_CUSTODY_FORBIDDEN',
  'STATIC_PER_APP_AUTHORITY_FORBIDDEN',
  'APP_SIGNED_UPLOAD_OWNERSHIP_FORBIDDEN',
  'DESKTOP_REALM_DATA_PLANE_OWNER_FORBIDDEN',
  'HOST_OWNED_RUNTIME_SESSION_FORBIDDEN',
];

const evidenceRemovalCases = [
  {
    ruleId: 'P-KIT-044',
    evidence: '.nimi/spec/platform/kernel/tables/rule-evidence.rules-kit.yaml',
    remove: '      - nimi_kit_gate\n',
    expectedCode: 'OWNER_IMPLEMENTATION_EVIDENCE_MISSING',
  },
  {
    ruleId: 'D-NET-007',
    evidence: '.nimi/spec/desktop/kernel/tables/rule-evidence.rules-shell-ui.yaml',
    remove: '  - desktop_test_gate\n',
    expectedCode: 'BLOCKED_DETAIL_IMPLEMENTATION_EVIDENCE_MISSING',
  },
];

async function makeFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'installed-realm-owner-boundary-'));
  for (const relative of bundleFiles) {
    const source = path.join(repoRoot, relative);
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
  return root;
}

function runGate(root, args = []) {
  return spawnSync(process.execPath, [path.join(root, gateRelative), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function insertIntoRule(source, ruleId, statement) {
  const heading = `## ${ruleId}`;
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `missing fixture rule ${ruleId}`);
  const next = source.indexOf('\n## ', start + heading.length);
  const insertAt = next === -1 ? source.length : next;
  return `${source.slice(0, insertAt)}\n${statement}\n${source.slice(insertAt)}`;
}

function replaceInRule(source, ruleId, from, to) {
  const heading = `## ${ruleId}`;
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `missing fixture rule ${ruleId}`);
  const next = source.indexOf('\n## ', start + heading.length);
  const end = next === -1 ? source.length : next;
  const section = source.slice(start, end);
  const changed = section.replace(from, to);
  assert.notEqual(changed, section, `missing fixture marker for ${ruleId}`);
  return `${source.slice(0, start)}${changed}${source.slice(end)}`;
}

function extractEvidenceRow(source, ruleId) {
  const marker = `- rule_id: ${ruleId}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing evidence row ${ruleId}`);
  const tail = source.slice(start + marker.length);
  const nextMatch = /\n\s*-\s+rule_id:/u.exec(tail);
  const end = nextMatch ? start + marker.length + nextMatch.index : source.length;
  return source.slice(start, end);
}

test('negative fixtures report independent stable codes and reasons', () => {
  const result = runGate(repoRoot, ['--fixture-report-json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.fixtures.map((fixture) => fixture.code), expectedFixtureCodes);
  assert.equal(new Set(report.fixtures.map((fixture) => fixture.fixtureId)).size, expectedFixtureCodes.length);
  for (const fixture of report.fixtures) {
    assert.match(fixture.reason, /\S/u);
    assert.match(fixture.target, /^\.nimi\/spec\//u);
  }
});

for (const [ruleId, contract] of detailedRules) {
  test(`rejects an admission inversion inside detailed rule ${ruleId}`, async () => {
    const root = await makeFixtureRoot();
    try {
      const contractPath = path.join(root, contract);
      const source = await fs.readFile(contractPath, 'utf8');
      await fs.writeFile(
        contractPath,
        insertIntoRule(source, ruleId, '**Authority disposition:** This detailed rule is independently admitted for implementation.'),
        'utf8',
      );
      const result = runGate(root);
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /BLOCKED_DETAIL_CONFLICT/u);
      assert.ok(result.stderr.includes(ruleId), result.stderr);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

for (const [ruleId, contract, from, to] of a0SplitRules) {
  test(`rejects rollback of admitted A.0 protected-origin slice ${ruleId}`, async () => {
    const root = await makeFixtureRoot();
    try {
      const contractPath = path.join(root, contract);
      const source = await fs.readFile(contractPath, 'utf8');
      const next = replaceInRule(
        source,
        ruleId,
        from,
        to,
      );
      await fs.writeFile(contractPath, next, 'utf8');
      const result = runGate(root);
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /A0_ADMITTED_SLICE_MISSING/u);
      assert.ok(result.stderr.includes(ruleId), result.stderr);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

for (const fixture of evidenceRemovalCases) {
  test(`rejects removal of truthful implementation evidence for ${fixture.ruleId}`, async () => {
    const root = await makeFixtureRoot();
    try {
      const evidencePath = path.join(root, fixture.evidence);
      const source = await fs.readFile(evidencePath, 'utf8');
      const row = extractEvidenceRow(source, fixture.ruleId);
      const nextRow = row.replace(fixture.remove, '');
      assert.notEqual(nextRow, row, `fixture token missing for ${fixture.ruleId}`);
      await fs.writeFile(evidencePath, source.replace(row, nextRow), 'utf8');
      const result = runGate(root);
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.ok(result.stderr.includes(fixture.expectedCode), result.stderr);
      assert.ok(result.stderr.includes(fixture.ruleId), result.stderr);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

test('Runtime rows retain structural A.1 evidence without claiming product closeout', async () => {
  const source = await fs.readFile(
    path.join(repoRoot, '.nimi/spec/runtime/kernel/tables/rule-evidence.rules-core-auth.yaml'),
    'utf8',
  );
  const row = extractEvidenceRow(source, 'K-ACCSVC-022');
  for (const expected of [
    'protected_local_authority_gate',
    'scripts/check-installed-realm-owner-boundary.mjs',
    'evidence_scope_note:',
    'positive evidence remains required before product closeout',
  ]) {
    assert.match(row, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
});

test('Kit and Desktop rows preserve implementation evidence beside owner-boundary evidence', async () => {
  const kit = await fs.readFile(
    path.join(repoRoot, '.nimi/spec/platform/kernel/tables/rule-evidence.rules-kit.yaml'),
    'utf8',
  );
  const kitRow = extractEvidenceRow(kit, 'P-KIT-044');
  for (const expected of [
    'nimi_kit_gate',
    'kit/shell/electron/test/electron-shell-capabilities.test.ts',
    'apps/desktop/test/desktop-installed-app-launcher.test.ts',
    'scripts/check-installed-realm-owner-boundary.mjs',
    'evidence_scope_note:',
  ]) assert.match(kitRow, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  const desktop = await fs.readFile(
    path.join(repoRoot, '.nimi/spec/desktop/kernel/tables/rule-evidence.rules-shell-ui.yaml'),
    'utf8',
  );
  const desktopRow = extractEvidenceRow(desktop, 'D-NET-007');
  for (const expected of [
    'desktop_lint_gate',
    'desktop_test_gate',
    'scripts/check-installed-realm-owner-boundary.mjs',
    'evidence_scope_note:',
  ]) assert.match(desktopRow, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
});
