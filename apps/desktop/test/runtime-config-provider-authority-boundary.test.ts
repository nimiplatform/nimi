import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { updateConnectorField } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-actions';
import type { RuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';

const cloudPageSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-page-cloud.tsx'),
  'utf8',
);

test('editing a connector endpoint preserves its Runtime provider identity', () => {
  const initial = {
    connectors: [{
      id: 'connector-1',
      provider: 'deepseek',
      endpoint: 'https://old.example.test',
    }],
    selectedConnectorId: 'connector-1',
  } as RuntimeConfigStateV11;

  const next = updateConnectorField(initial, 'connector-1', {
    endpoint: 'https://custom.example.test',
  });

  assert.equal(next.connectors[0]?.endpoint, 'https://custom.example.test');
  assert.equal(next.connectors[0]?.provider, 'deepseek');
});

test('cloud connector UI does not hardcode provider hostnames', () => {
  assert.doesNotMatch(
    cloudPageSource,
    /api\.deepseek\.com|api\.anthropic\.com|openrouter\.ai|generativelanguage\.googleapis\.com/,
  );
});
