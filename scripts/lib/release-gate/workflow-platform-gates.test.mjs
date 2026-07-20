import assert from 'node:assert/strict';
import test from 'node:test';

import { checkPlatformSpecificGateConsumers } from './workflow-platform-gates.mjs';

const registry = {
  gates: [
    {
      id: 'gate.desktop.macos-native',
      command: 'pnpm test:macos-native',
      tiers: ['release', 'release-target:desktop'],
      skip_when: { condition: 'not_macos' },
    },
  ],
};

test('requires an explicit workflow consumer for a platform-specific release gate', () => {
  assert.deepEqual(checkPlatformSpecificGateConsumers(registry, []), [
    'gate.desktop.macos-native: platform-specific release gate has no workflow consumer',
  ]);
});

test('rejects a consumer without evidence that it selects the required platform', () => {
  const workflows = [{
    fileName: 'release.yml',
    document: {
      jobs: { release: { 'runs-on': 'ubuntu-latest', steps: [{ run: 'pnpm test:macos-native' }] } },
    },
  }];
  assert.deepEqual(checkPlatformSpecificGateConsumers(registry, workflows), [
    'gate.desktop.macos-native: workflow consumer does not prove macos runner selection',
  ]);
});

test('accepts matrix execution guarded to the required platform', () => {
  const workflows = [{
    fileName: 'release.yml',
    document: {
      jobs: {
        release: {
          'runs-on': '${{ matrix.platform }}',
          steps: [{
            if: "matrix.platform == 'macos-latest'",
            run: 'pnpm test:macos-native',
          }],
        },
      },
    },
  }];
  assert.deepEqual(checkPlatformSpecificGateConsumers(registry, workflows), []);
});
