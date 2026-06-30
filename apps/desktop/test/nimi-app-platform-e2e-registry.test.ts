import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopRoot = path.join(import.meta.dirname, '..');

test('Nimi App Platform E2E suites are registered with live lifecycle and Electron host proof tracks', async () => {
  const registry = await import('../e2e/helpers/registry.mjs') as {
    ELECTRON_HOST_RUNNER: string;
    WDIO_RUNNER: string;
    scenarioRegistry: Map<string, { bucket: string; runner?: string; profile?: string; spec: string }>;
    scenarioRunner: (entry: { runner?: string }) => string;
    selectScenarios: (options: { suite?: string; scenario?: string; runner?: string }) => string[];
  };
  const packageJson = JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const runnerSource = readFileSync(path.join(desktopRoot, 'scripts/run-e2e.mjs'), 'utf8');

  assert.equal(
    packageJson.scripts?.['test:e2e:nimi-app-platform-sandbox'],
    'node scripts/run-e2e.mjs --suite nimi-app-platform-sandbox',
  );
  assert.equal(
    packageJson.scripts?.['test:e2e:nimi-app-platform-ordinary'],
    'node scripts/run-e2e.mjs --suite nimi-app-platform-ordinary',
  );
  assert.equal(
    packageJson.scripts?.['test:e2e:nimi-app-platform-negative'],
    'node scripts/run-e2e.mjs --suite nimi-app-platform-negative',
  );

  const sandboxScenarios = registry.selectScenarios({ suite: 'nimi-app-platform-sandbox' });
  assert.deepEqual(sandboxScenarios, [
    'nimi-app-platform.sandbox.lifecycle',
    'nimi-app-platform.sandbox.electron-host',
  ]);
  assert.equal(
    registry.scenarioRunner(registry.scenarioRegistry.get('nimi-app-platform.sandbox.lifecycle')!),
    registry.WDIO_RUNNER,
  );
  assert.equal(
    registry.scenarioRunner(registry.scenarioRegistry.get('nimi-app-platform.sandbox.electron-host')!),
    registry.ELECTRON_HOST_RUNNER,
  );

  const negativeScenarios = registry.selectScenarios({ suite: 'nimi-app-platform-negative' });
  assert.deepEqual(negativeScenarios, [
    'nimi-app-platform.negative.digest-mismatch',
    'nimi-app-platform.negative.permission-pending',
    'nimi-app-platform.negative.account-only',
    'nimi-app-platform.negative.electron-host',
  ]);
  assert.equal(
    registry.scenarioRunner(registry.scenarioRegistry.get('nimi-app-platform.negative.digest-mismatch')!),
    registry.WDIO_RUNNER,
  );
  assert.equal(
    registry.scenarioRunner(registry.scenarioRegistry.get('nimi-app-platform.negative.permission-pending')!),
    registry.WDIO_RUNNER,
  );
  assert.equal(
    registry.scenarioRunner(registry.scenarioRegistry.get('nimi-app-platform.negative.account-only')!),
    registry.WDIO_RUNNER,
  );
  assert.equal(
    registry.scenarioRunner(registry.scenarioRegistry.get('nimi-app-platform.negative.electron-host')!),
    registry.ELECTRON_HOST_RUNNER,
  );

  assert.match(runnerSource, /ELECTRON_HOST_RUNNER/);
  assert.match(runnerSource, /runElectronHostScenario/);
  assert.equal(
    [...runnerSource.matchAll(/NIMI_E2E_PROFILE:\s*scenarioId/g)].length,
    2,
    'run-e2e must pass scenario id to both tauri-driver and WDIO artifact collection',
  );
  assert.doesNotMatch(
    runnerSource,
    /selectScenarios\(\{\s*\.\.\.options,\s*runner:\s*WDIO_RUNNER\s*\}\)/,
    'run-e2e must not filter mixed Nimi App Platform suites down to WDIO-only scenarios',
  );
});

test('Nimi App Platform E2E registered profiles and specs are parity-checked', async () => {
  const registry = await import('../e2e/helpers/registry.mjs') as {
    profilePathForScenario: (scenarioId: string) => string;
    scenarioRegistry: Map<string, { spec: string }>;
    selectScenarios: (options: { suite?: string }) => string[];
  };
  const scenarioIds = [
    ...registry.selectScenarios({ suite: 'nimi-app-platform-sandbox' }),
    ...registry.selectScenarios({ suite: 'nimi-app-platform-negative' }),
  ];
  assert.deepEqual(scenarioIds, [
    'nimi-app-platform.sandbox.lifecycle',
    'nimi-app-platform.sandbox.electron-host',
    'nimi-app-platform.negative.digest-mismatch',
    'nimi-app-platform.negative.permission-pending',
    'nimi-app-platform.negative.account-only',
    'nimi-app-platform.negative.electron-host',
  ]);

  for (const scenarioId of scenarioIds) {
    const entry = registry.scenarioRegistry.get(scenarioId);
    assert.ok(entry, `missing registry entry for ${scenarioId}`);
    assert.equal(
      fs.existsSync(registry.profilePathForScenario(scenarioId)),
      true,
      `${scenarioId} profile must exist`,
    );
    assert.equal(
      fs.existsSync(path.join(desktopRoot, '..', '..', entry.spec)),
      true,
      `${scenarioId} spec must exist`,
    );
  }

  const parity = spawnSync(process.execPath, ['scripts/check-e2e-parity.mjs'], {
    cwd: desktopRoot,
    encoding: 'utf8',
  });
  assert.equal(
    parity.status,
    0,
    `E2E parity must admit Nimi App Platform buckets and runners:\n${parity.stderr}${parity.stdout}`,
  );
});

test('ordinary Nimi App Platform E2E suite fails closed until a real ordinary descriptor exists', () => {
  const run = spawnSync(process.execPath, [
    'scripts/run-e2e.mjs',
    '--suite',
    'nimi-app-platform-ordinary',
    '--skip-build',
  ], {
    cwd: desktopRoot,
    encoding: 'utf8',
  });
  assert.notEqual(run.status, 0, 'ordinary suite must not pass by selecting zero scenarios');
  assert.match(
    `${run.stderr}\n${run.stdout}`,
    /ordinary.*descriptor|descriptor.*ordinary/i,
    'ordinary suite failure must name the missing ordinary descriptor gate',
  );
});
