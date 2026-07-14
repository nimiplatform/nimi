import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  evaluateDoctorCompatibility,
  evaluateSyncCompatibility,
  inspectHostHardcut,
  validateHostHardcutManifest,
} from './lib/nimicoding-host-hardcut.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixtureManifest() {
  return validateHostHardcutManifest({
    version: 1,
    policy_id: 'nimi.nimicoding-host-workflow-hardcut.v1',
    authority: {
      path: '.nimi/spec/platform/kernel/package-authority-admission-contract.md',
      required_rule_ids: ['P-PKG-010', 'P-PKG-011'],
    },
    package_compatibility: {
      package_name: '@nimiplatform/nimi-coding',
      allowed_versions: ['0.2.7'],
    },
    forbidden_package_projection_paths: ['.nimi/contracts/topic.schema.yaml'],
    host_override_projection_paths: ['.nimi/methodology/core.yaml'],
    host_projection_semantics: {
      yaml_assertions: [
        {
          path: '.nimi/methodology/core.yaml',
          assertions: [
            {
              pointer: 'execution_bootstrap.host_execution_owner',
              operator: 'equals',
              value: 'external_ai_host',
            },
          ],
        },
      ],
    },
    old_doctor_compatibility: {
      allowed_error_checks: [
        { id: 'bootstrap_seed_files', detail: 'expected hardcut absence' },
      ],
      allowed_invalid_contract_paths: ['.nimi/contracts/execution-packet.schema.yaml'],
    },
    entrypoint_scan: {
      roots: ['README.md'],
      included_extensions: ['.md'],
      excluded_path_suffixes: ['.test.mjs'],
      excluded_path_segments: ['testdata'],
      forbidden_substrings: ['topic-runner', 'inline manager-worker'],
    },
    package_script_contract: {
      'check:nimicoding-host-hardcut': 'node scripts/check-nimicoding-host-hardcut.mjs',
    },
  });
}

function syncReport(results) {
  const failureStatuses = new Set([
    'missing_host_state_seed',
    'missing_package_canonical',
    'drifted_package_canonical',
  ]);
  const summary = {
    total: results.length,
    in_sync: 0,
    drifted_preserved: 0,
    missing_host_state_seed: 0,
    missing_package_canonical: 0,
    drifted_package_canonical: 0,
  };
  for (const entry of results) {
    summary[entry.status] += 1;
  }
  return {
    mode: 'check',
    summary,
    results,
    ok: !results.some((entry) => failureStatuses.has(entry.status)),
    checkFailures: results.filter((entry) => failureStatuses.has(entry.status)),
  };
}

function syncEntry(outputRelativePath, status, ownership = 'package_canonical') {
  return { outputRelativePath, ownership, status, detail: status };
}

function compatibleSyncEntries() {
  return [
    syncEntry('.nimi/contracts/topic.schema.yaml', 'missing_package_canonical'),
    syncEntry('.nimi/methodology/core.yaml', 'drifted_package_canonical'),
    syncEntry('.nimi/contracts/prompt.schema.yaml', 'in_sync'),
  ];
}

test('sync compatibility tolerates only declared missing and drift paths', () => {
  const manifest = fixtureManifest();
  const accepted = evaluateSyncCompatibility(syncReport(compatibleSyncEntries()), manifest);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.tolerated.length, 2);

  const unexpectedMissing = evaluateSyncCompatibility(syncReport(compatibleSyncEntries().map((entry) => (
    entry.outputRelativePath === '.nimi/contracts/prompt.schema.yaml'
      ? syncEntry(entry.outputRelativePath, 'missing_package_canonical')
      : entry
  ))), manifest);
  assert.equal(unexpectedMissing.ok, false);
  assert.ok(unexpectedMissing.failures.some((entry) => /prompt\.schema\.yaml/u.test(entry)));

  const unexpectedDrift = evaluateSyncCompatibility(syncReport(compatibleSyncEntries().map((entry) => (
    entry.outputRelativePath === '.nimi/contracts/prompt.schema.yaml'
      ? syncEntry(entry.outputRelativePath, 'drifted_package_canonical')
      : entry
  ))), manifest);
  assert.equal(unexpectedDrift.ok, false);
  assert.ok(unexpectedDrift.failures.some((entry) => /drifted_package_canonical/u.test(entry)));

  const unexpectedHostSeedAbsence = evaluateSyncCompatibility(syncReport([
    ...compatibleSyncEntries(),
    syncEntry('.nimi/config/spec-generation-inputs.yaml', 'missing_host_state_seed', 'host_state_seed'),
  ]), manifest);
  assert.equal(unexpectedHostSeedAbsence.ok, false);
  assert.ok(unexpectedHostSeedAbsence.failures.some((entry) => /missing_host_state_seed/u.test(entry)));

  const omittedProjection = evaluateSyncCompatibility(syncReport(
    compatibleSyncEntries().filter((entry) => entry.outputRelativePath !== '.nimi/contracts/topic.schema.yaml'),
  ), manifest);
  assert.equal(omittedProjection.ok, false);
  assert.ok(omittedProjection.failures.some((entry) => /omitted forbidden projection/u.test(entry)));

  const omittedOverride = evaluateSyncCompatibility(syncReport(
    compatibleSyncEntries().filter((entry) => entry.outputRelativePath !== '.nimi/methodology/core.yaml'),
  ), manifest);
  assert.equal(omittedOverride.ok, false);
  assert.ok(omittedOverride.failures.some((entry) => /omitted host override projection/u.test(entry)));

  const inconsistentOk = syncReport(compatibleSyncEntries());
  inconsistentOk.ok = true;
  assert.throws(
    () => evaluateSyncCompatibility(inconsistentOk, manifest),
    /report ok does not match checkFailures/u,
  );
});

test('mutating package workflow entrypoints are blocked without invoking the package CLI', () => {
  for (const blockedCommand of ['start', 'sync-apply']) {
    const result = spawnSync(
      process.execPath,
      [path.join(projectRoot, 'scripts', 'nimicoding-host-compat.mjs'), 'block', blockedCommand],
      { cwd: projectRoot, encoding: 'utf8', windowsHide: true },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`command ${blockedCommand} is blocked`, 'u'));
    assert.equal(result.stdout, '');
  }
});

test('doctor compatibility rejects every non-allowlisted failure and invalid contract', () => {
  const manifest = fixtureManifest();
  const projectRoot = path.resolve('fixture-root');
  const base = {
    projectRoot,
    ok: false,
    bootstrapPresent: true,
    runtimeInstalled: false,
    adapterProfiles: { selected: null },
    delegatedContracts: { selectedAdapterId: 'none' },
    checks: [
      { id: 'bootstrap_seed_files', ok: false, severity: 'error', detail: 'expected hardcut absence' },
      { id: 'nimi_root', ok: true, severity: 'ok', detail: 'present' },
    ],
    executionContracts: { invalid: ['.nimi/contracts/execution-packet.schema.yaml'] },
  };
  assert.equal(evaluateDoctorCompatibility(base, manifest, projectRoot).ok, true);

  const unknownCheck = structuredClone(base);
  unknownCheck.checks.push({ id: 'unexpected', ok: false, severity: 'error', detail: 'bad' });
  assert.equal(evaluateDoctorCompatibility(unknownCheck, manifest, projectRoot).ok, false);

  const changedDetail = structuredClone(base);
  changedDetail.checks[0].detail = 'changed detail';
  assert.equal(evaluateDoctorCompatibility(changedDetail, manifest, projectRoot).ok, false);

  const missingExpectedCheck = structuredClone(base);
  missingExpectedCheck.checks = missingExpectedCheck.checks.filter((entry) => entry.id !== 'bootstrap_seed_files');
  assert.equal(evaluateDoctorCompatibility(missingExpectedCheck, manifest, projectRoot).ok, false);

  const unknownContract = structuredClone(base);
  unknownContract.executionContracts.invalid.push('.nimi/contracts/prompt.schema.yaml');
  assert.equal(evaluateDoctorCompatibility(unknownContract, manifest, projectRoot).ok, false);

  const missingContract = structuredClone(base);
  missingContract.executionContracts.invalid = [];
  assert.equal(evaluateDoctorCompatibility(missingContract, manifest, projectRoot).ok, false);

  const selectedAdapter = structuredClone(base);
  selectedAdapter.adapterProfiles.selected = { id: 'codex' };
  selectedAdapter.delegatedContracts.selectedAdapterId = 'codex';
  assert.equal(evaluateDoctorCompatibility(selectedAdapter, manifest, projectRoot).ok, false);

  const runtimeInstalled = structuredClone(base);
  runtimeInstalled.runtimeInstalled = true;
  assert.equal(evaluateDoctorCompatibility(runtimeInstalled, manifest, projectRoot).ok, false);
});

test('host inspection enforces projection semantics, absence, authority, scripts, and entrypoints', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-host-hardcut-'));
  const manifest = fixtureManifest();
  manifest.entrypoint_scan.roots.push('.claude');
  manifest.entrypoint_scan.excluded_path_segments.push('worktrees');
  try {
    await mkdir(path.join(root, '.nimi', 'spec', 'platform', 'kernel'), { recursive: true });
    await mkdir(path.join(root, '.nimi', 'methodology'), { recursive: true });
    await writeFile(
      path.join(root, '.nimi', 'spec', 'platform', 'kernel', 'package-authority-admission-contract.md'),
      'P-PKG-010\nP-PKG-011\n',
    );
    await writeFile(
      path.join(root, '.nimi', 'methodology', 'core.yaml'),
      'version: 1\nexecution_bootstrap:\n  host_execution_owner: external_ai_host\n',
    );
    await writeFile(path.join(root, 'README.md'), 'Host-owned workflow.\n');
    await mkdir(path.join(root, '.claude', 'worktrees', 'external-session'), { recursive: true });
    await writeFile(
      path.join(root, '.claude', 'worktrees', 'external-session', 'README.md'),
      'Use TOPIC-RUNNER in an independent worktree.\n',
    );
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      scripts: {
        'check:nimicoding-host-hardcut': 'node scripts/check-nimicoding-host-hardcut.mjs',
      },
    }));

    assert.equal((await inspectHostHardcut(root, manifest)).ok, true);

    await writeFile(
      path.join(root, '.nimi', 'methodology', 'core.yaml'),
      'version: 1\nexecution_bootstrap:\n  host_execution_owner: nimi_coding\n',
    );
    const semanticFailure = await inspectHostHardcut(root, manifest);
    assert.equal(semanticFailure.ok, false);
    assert.ok(semanticFailure.failures.some((entry) => entry.includes('host projection semantic drift')));
    await writeFile(
      path.join(root, '.nimi', 'methodology', 'core.yaml'),
      'version: 1\nexecution_bootstrap:\n  host_execution_owner: external_ai_host\n',
    );

    await mkdir(path.join(root, '.nimi', 'contracts'), { recursive: true });
    await writeFile(path.join(root, '.nimi', 'contracts', 'topic.schema.yaml'), 'retired: false\n');
    const projectionFailure = await inspectHostHardcut(root, manifest);
    assert.equal(projectionFailure.ok, false);
    assert.ok(projectionFailure.failures.some((entry) => entry.includes('topic.schema.yaml')));

    await rm(path.join(root, '.nimi', 'contracts', 'topic.schema.yaml'));
    await writeFile(path.join(root, 'README.md'), 'Use TOPIC-RUNNER here.\n');
    const entrypointFailure = await inspectHostHardcut(root, manifest);
    assert.equal(entrypointFailure.ok, false);
    assert.ok(entrypointFailure.failures.some((entry) => entry.includes('retired package workflow entrypoint')));

    await writeFile(path.join(root, 'README.md'), 'Use inline manager-worker orchestration here.\n');
    const managerWorkerFailure = await inspectHostHardcut(root, manifest);
    assert.equal(managerWorkerFailure.ok, false);
    assert.ok(managerWorkerFailure.failures.some((entry) => entry.includes('retired package workflow entrypoint')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
