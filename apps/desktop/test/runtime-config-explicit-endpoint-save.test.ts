import assert from 'node:assert/strict';
import test from 'node:test';

import { updateConnectorField } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-actions';
import type { RuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults.js';

test('editing a connector endpoint preserves its Runtime provider identity', () => {
  const initial = {
    ...createDefaultStateV11(),
    connectors: [{
      id: 'connector-1',
      provider: 'deepseek',
      endpoint: 'https://old.example.test',
    }],
  } as RuntimeConfigStateV11;

  const next = updateConnectorField(initial, 'connector-1', {
    endpoint: 'https://custom.example.test',
  });

  assert.equal(next.connectors[0]?.endpoint, 'https://custom.example.test');
  assert.equal(next.connectors[0]?.provider, 'deepseek');
});
