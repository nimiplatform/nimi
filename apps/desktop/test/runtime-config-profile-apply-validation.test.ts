import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourcePath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-config-page-profiles.tsx',
);

test('profile catalog fails closed when host aiProfile.apply rejects a profile', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /surface\.aiProfile\.apply\(scopeRef, profileId\)/);
  assert.match(source, /result\.failureReason \|\| 'Failed to apply profile\.'/);
  assert.doesNotMatch(source, /applyAIProfileToConfig/);
  assert.doesNotMatch(source, /surface\.aiConfig\.update\(scopeRef/);
});
