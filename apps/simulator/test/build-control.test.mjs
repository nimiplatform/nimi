import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  loadSimulatorConfig,
  parseSelectedSourceDescriptor,
  validateSelectedSourceDescriptor,
  validateSimulatorScenario,
} from '../build/config.mjs';
import { readSimulatorPublicEnvironment } from '../build/public-env.mjs';
import { REPO_ROOT } from '../build/paths.mjs';

function scenarioValue() {
  return {
    schema: 'nimi.simulator.scenario/v1',
    scenario_id: 'scenario-test',
    scenario_revision: 'test',
    seed: 'a5'.repeat(32),
    initial_logical_time: 0,
    state: { scenario: {}, ecosystem: {}, shell: { readiness: {} } },
    module_data: [{ module_id: 'sample-app', data: {} }],
    enabled_capabilities: [],
    launch: [{
      launch_id: 'sample-launch',
      module_id: 'sample-app',
      surface_id: 'main',
      activate: true,
    }],
  };
}

test('selected source descriptors point directly at current workspace Apps', () => {
  assert.deepEqual(
    validateSelectedSourceDescriptor({
      module_id: 'sample-app',
      root: 'apps/sample-app',
      icon: 'src/assets/icon.png',
    }),
    {
      module_id: 'sample-app',
      root: 'apps/sample-app',
      icon: 'src/assets/icon.png',
      descriptor_label: 'selected-source',
    },
  );
  assert.throws(
    () => validateSelectedSourceDescriptor({
      module_id: 'sample-app',
      root: 'apps/sample-app',
      icon: 'src/assets/icon.png',
      source_revision: 'stale',
    }),
    (error) => error?.code === 'SIM_DESCRIPTOR_UNKNOWN_FIELD',
  );
  assert.throws(
    () => validateSelectedSourceDescriptor({
      module_id: 'sample-app',
      root: '../sample-app',
      icon: 'src/assets/icon.png',
    }),
    (error) => error?.code === 'SIM_MANIFEST_PATH',
  );
  assert.throws(
    () => validateSelectedSourceDescriptor({
      module_id: 'sample-app',
      root: 'apps/sample-app',
      icon: '../icon.png',
    }),
    (error) => error?.code === 'SIM_MANIFEST_PATH',
  );
  assert.throws(
    () => parseSelectedSourceDescriptor(
      'module_id: &module sample-app\nroot: *module\nicon: src/assets/icon.png\n',
      'fixture',
    ),
    (error) => ['SIM_DESCRIPTOR_YAML_ANCHOR', 'SIM_DESCRIPTOR_YAML_ALIAS'].includes(error?.code),
  );
});

test('current Simulator config selects the three workspace Apps without repository metadata', () => {
  const config = loadSimulatorConfig(path.join(REPO_ROOT, 'config', 'simulator'));
  assert.deepEqual(
    config.descriptors.map((descriptor) => ({
      module_id: descriptor.module_id,
      root: descriptor.root,
      icon: descriptor.icon,
    })),
    [
      {
        module_id: 'desktop',
        root: 'apps/desktop',
        icon: 'src/shell/renderer/assets/logo.png',
      },
      {
        module_id: 'tester',
        root: 'apps/tester',
        icon: 'src-tauri/icons/icon.png',
      },
      {
        module_id: 'zhiyu',
        root: 'apps/zhiyu',
        icon: 'src/shell/assets/app-icon.png',
      },
    ],
  );
  assert.equal(config.scenario.launch.length, 6);
  assert.equal(Object.hasOwn(config.scenario, 'readiness'), false);
});

test('Shell App logos consume only selected-source generated inputs', () => {
  const source = readFileSync(
    path.join(REPO_ROOT, 'apps', 'simulator', 'src', 'shell', 'chrome', 'app-logo.tsx'),
    'utf8',
  );
  assert.match(source, /simulatorSelectedModuleLogos/u);
  assert.doesNotMatch(source, /apps\/(?:desktop|tester|zhiyu)|\.\.\/\.\.\/\.\.\/\.\.\//u);
});

test('Scenario validation keeps launch/state structure and rejects removed readiness policy', () => {
  const valid = scenarioValue();
  assert.doesNotThrow(() => validateSimulatorScenario(valid));
  assert.throws(
    () => validateSimulatorScenario({ ...valid, readiness: [] }),
    (error) => error?.code === 'SIM_DESCRIPTOR_UNKNOWN_FIELD',
  );
  assert.throws(
    () => validateSimulatorScenario({
      ...valid,
      launch: [...valid.launch, { ...valid.launch[0] }],
    }),
    (error) => error?.code === 'SIM_SCENARIO_DUPLICATE',
  );
});

test('browser-public environment is an exact HTTPS-origin allowlist', () => {
  assert.deepEqual(readSimulatorPublicEnvironment({}), { publicOrigin: null });
  assert.deepEqual(
    readSimulatorPublicEnvironment({ NIMI_SIMULATOR_PUBLIC_ORIGIN: 'https://simulator.nimi.example' }),
    { publicOrigin: 'https://simulator.nimi.example' },
  );
  assert.throws(() => readSimulatorPublicEnvironment({
    NIMI_SIMULATOR_PUBLIC_ORIGIN: 'http://localhost:3000',
  }));
  assert.deepEqual(
    readSimulatorPublicEnvironment({ VITE_SECRET_TOKEN: 'forbidden-but-not-read' }),
    { publicOrigin: null },
  );
});
