import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import pnpmfile from '../.pnpmfile.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { filterLog } = pnpmfile.hooks;
const platformWarning = {
  name: 'pnpm',
  level: 'warn',
  prefix: path.join(root, 'kit/shell/protected-local-node/npm/win32-x64'),
  message: 'Unsupported platform: wanted: {"os":["win32"]}',
};

test('omits only native workspace platform discovery warnings', () => {
  for (const target of ['win32-x64', 'darwin-arm64']) {
    assert.equal(filterLog({
      ...platformWarning,
      prefix: path.join(root, 'kit/shell/protected-local-node/npm', target),
    }), false);
  }
});

test('preserves errors, engine warnings, install checks, and other packages', () => {
  for (const changed of [
    { level: 'error' },
    { message: 'Unsupported engine: wanted: {"node":">=99"}' },
    { name: 'pnpm:install-check' },
    { prefix: path.join(root, 'apps/desktop') },
    { prefix: `${platformWarning.prefix}-other` },
  ]) {
    assert.equal(filterLog({ ...platformWarning, ...changed }), true);
  }
});
