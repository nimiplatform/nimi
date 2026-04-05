import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('background local model discovery does not emit a success status banner', () => {
  const source = readFileSync(
    path.join(root, 'src/shell/renderer/features/runtime-config/runtime-config-connector-discover-command.ts'),
    'utf8',
  );

  assert.doesNotMatch(source, /kind:\s*'success'/);
  assert.doesNotMatch(source, /Discovered\s+\$\{discovered\.length\}\s+Local Runtime models/);
  assert.doesNotMatch(source, /Local Runtime model list is up to date/);
});

test('healthy local runtime checks stay silent while degraded checks still warn', () => {
  const source = readFileSync(
    path.join(root, 'src/shell/renderer/features/runtime-config/runtime-config-connector-health-command.ts'),
    'utf8',
  );

  assert.match(source, /if \(health\.status !== 'healthy'\)/);
  assert.match(source, /kind:\s*'warning'/);
  assert.doesNotMatch(source, /kind:\s*health\.status === 'healthy' \? 'success' : 'warning'/);
});

test('connector test success moved to control-inline feedback instead of global banner', () => {
  const source = readFileSync(
    path.join(root, 'src/shell/renderer/features/runtime-config/runtime-config-connector-test-command.ts'),
    'utf8',
  );

  assert.match(source, /setControlFeedback\(/);
  assert.doesNotMatch(source, /setStatusBanner\(/);
});
