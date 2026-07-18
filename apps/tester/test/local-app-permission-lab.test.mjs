import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('local app permission drawer keeps all controls reachable on narrow screens', () => {
  const source = readFileSync(path.join(root, 'src/tester/tester-workbench.tsx'), 'utf8');

  assert.match(source, /panelClassName="flex flex-col overflow-hidden"/);
  assert.match(source, /contentClassName="min-h-0 min-w-0 flex-1 overflow-y-auto"/);
  assert.match(source, /撤销后的即时拒绝/);
});
