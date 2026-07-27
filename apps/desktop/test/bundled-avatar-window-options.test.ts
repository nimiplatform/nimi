import assert from 'node:assert/strict';
import test from 'node:test';

import { createBundledAvatarWindowOptions } from '../src-electron/bundled-avatar-window-options.js';

test('bundled Avatar windows keep renderer privileges isolated', () => {
  const options = createBundledAvatarWindowOptions('C:\\Nimi\\avatar-preload.cjs');

  assert.deepEqual(options.webPreferences, {
    preload: 'C:\\Nimi\\avatar-preload.cjs',
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  });
});
