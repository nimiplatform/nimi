import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  inspectHostHardcut,
  validateHostHardcutManifest,
} from './lib/nimicoding-host-hardcut.mjs';

function fixtureManifest(overrides = {}) {
  return validateHostHardcutManifest({
    version: 2,
    policy_id: 'nimi.nimicoding-host-boundary-hardcut.v2',
    authority: {
      path: '.nimi/spec/platform/authority-admission.authority.yaml',
      required_rule_ids: ['P-PKG-010', 'P-PKG-011'],
    },
    package: {
      name: '@nimiplatform/nimi-coding',
      required_version: '0.3.1',
      required_dependency_range: '^0.3.1',
    },
    retired_active_projection_paths: ['.nimi/contracts/topic.schema.yaml'],
    preserved_historical_roots: ['.nimi/topics', '.nimi/local'],
    forbidden_installed_package_paths: ['cli/commands/topic.mjs'],
    entrypoint_scan: {
      roots: ['docs'],
      included_extensions: ['.md'],
      excluded_path_segments: ['_archive'],
      forbidden_substrings: ['audit-sweep', 'topic-runner'],
    },
    required_package_scripts: {
      'check:nimicoding-host-hardcut': 'node scripts/check-nimicoding-host-hardcut.mjs',
    },
    forbidden_package_scripts: ['nimicoding:topic'],
    ...overrides,
  });
}

async function write(root, relativePath, content) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

async function createFixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-host-hardcut-'));
  await write(
    root,
    '.nimi/spec/platform/authority-admission.authority.yaml',
    'P-PKG-010\nP-PKG-011\n',
  );
  await write(root, '.nimi/topics/retired-topic/evidence.md', 'historical audit-sweep evidence\n');
  await write(root, '.nimi/local/audit/report.md', 'historical topic-runner evidence\n');
  await write(root, 'docs/index.md', 'Current deterministic governance documentation.\n');
  await write(root, 'node_modules/@nimiplatform/nimi-coding/package.json', JSON.stringify({
    name: '@nimiplatform/nimi-coding',
    version: '0.3.1',
  }));
  await write(root, 'package.json', JSON.stringify({
    scripts: {
      'check:nimicoding-host-hardcut': 'node scripts/check-nimicoding-host-hardcut.mjs',
    },
    devDependencies: {
      '@nimiplatform/nimi-coding': '^0.3.1',
    },
  }));
  await write(root, 'pnpm-lock.yaml', [
    "lockfileVersion: '9.0'",
    'importers:',
    '  .:',
    '    devDependencies:',
    "      '@nimiplatform/nimi-coding':",
    '        specifier: ^0.3.1',
    '        version: 0.3.1',
    'packages:',
    "  '@nimiplatform/nimi-coding@0.3.1': {}",
    'snapshots:',
    "  '@nimiplatform/nimi-coding@0.3.1': {}",
    '',
  ].join('\n'));
  return root;
}

test('manifest protects historical evidence roots from deletion and scanning', () => {
  assert.throws(
    () => fixtureManifest({
      retired_active_projection_paths: ['.nimi/topics/retired-topic/evidence.md'],
    }),
    /crosses preserved historical root/u,
  );
  assert.throws(
    () => fixtureManifest({
      entrypoint_scan: {
        roots: ['.nimi'],
        included_extensions: ['.md'],
        excluded_path_segments: ['_archive'],
        forbidden_substrings: ['audit-sweep'],
      },
    }),
    /must not cross preserved historical root/u,
  );
});

test('clean 0.3.1 host passes while historical evidence remains untouched', async () => {
  const root = await createFixtureRoot();
  try {
    const report = await inspectHostHardcut(root, fixtureManifest());
    assert.equal(report.ok, true);
    assert.equal(report.packageVersion, '0.3.1');
    assert.equal(report.workspaceConsumerCount, 1);
    assert.equal(report.historicalRoots['.nimi/topics'], 'directory');
    assert.equal(report.historicalRoots['.nimi/local'], 'directory');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace importer and lockfile version drift fail closed', async () => {
  const root = await createFixtureRoot();
  try {
    await write(root, 'pnpm-lock.yaml', [
      "lockfileVersion: '9.0'",
      'importers:',
      '  .:',
      '    devDependencies:',
      "      '@nimiplatform/nimi-coding':",
      '        specifier: ^0.3.1',
      '        version: 0.3.1',
      '  apps/tester:',
      '    devDependencies:',
      "      '@nimiplatform/nimi-coding':",
      '        specifier: 0.2.7',
      '        version: 0.2.7',
      'packages:',
      "  '@nimiplatform/nimi-coding@0.2.7': {}",
      "  '@nimiplatform/nimi-coding@0.3.1': {}",
      'snapshots:',
      "  '@nimiplatform/nimi-coding@0.2.7': {}",
      "  '@nimiplatform/nimi-coding@0.3.1': {}",
      '',
    ].join('\n'));
    const report = await inspectHostHardcut(root, fixtureManifest());
    assert.equal(report.ok, false);
    assert.ok(report.failures.some((failure) => failure.includes('workspace importer apps/tester declares')));
    assert.ok(report.failures.some((failure) => failure.includes('workspace importer apps/tester resolves')));
    assert.ok(report.failures.some((failure) => failure.includes('lockfile retains unsupported')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('active retired projections and installed execution surfaces fail closed', async () => {
  const root = await createFixtureRoot();
  try {
    const manifest = fixtureManifest();
    await write(root, '.nimi/contracts/topic.schema.yaml', 'version: 1\n');
    let report = await inspectHostHardcut(root, manifest);
    assert.equal(report.ok, false);
    assert.ok(report.failures.some((failure) => failure.includes('retired active nimi-coding projection')));

    await rm(path.join(root, '.nimi/contracts/topic.schema.yaml'));
    await write(root, 'node_modules/@nimiplatform/nimi-coding/cli/commands/topic.mjs', 'export {};\n');
    report = await inspectHostHardcut(root, manifest);
    assert.equal(report.ok, false);
    assert.ok(report.failures.some((failure) => failure.includes('retired execution surface')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stale entrypoints, dependency drift, and retired scripts fail closed', async () => {
  const root = await createFixtureRoot();
  try {
    const manifest = fixtureManifest();
    await write(root, 'docs/index.md', 'Run the old AUDIT-SWEEP command.\n');
    await write(root, 'package.json', JSON.stringify({
      scripts: {
        'check:nimicoding-host-hardcut': 'node scripts/check-nimicoding-host-hardcut.mjs',
        'nimicoding:topic': 'pnpm exec nimicoding topic',
      },
      devDependencies: {
        '@nimiplatform/nimi-coding': '^0.2.7',
      },
    }));
    const report = await inspectHostHardcut(root, manifest);
    assert.equal(report.ok, false);
    assert.ok(report.failures.some((failure) => failure.includes('execution reference')));
    assert.ok(report.failures.some((failure) => failure.includes('must declare exactly')));
    assert.ok(report.failures.some((failure) => failure.includes('retired nimi-coding package script')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('installed package version is pinned to the audited release', async () => {
  const root = await createFixtureRoot();
  try {
    await write(root, 'node_modules/@nimiplatform/nimi-coding/package.json', JSON.stringify({
      name: '@nimiplatform/nimi-coding',
      version: '0.3.2',
    }));
    const report = await inspectHostHardcut(root, fixtureManifest());
    assert.equal(report.ok, false);
    assert.ok(report.failures.some((failure) => failure.includes('version must be 0.3.1')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
