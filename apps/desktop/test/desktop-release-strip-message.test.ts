import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDesktopReleaseStripMessage } from '../src/shell/renderer/app-shell/layouts/desktop-release-strip';

test('desktop release strip resolves desktopReleaseError first', () => {
  assert.equal(
    resolveDesktopReleaseStripMessage({
      desktopReleaseError: 'bundled runtime staging failed',
      runtimeLastError: 'runtime version mismatch',
    }),
    'bundled runtime staging failed',
  );
});

test('desktop release strip falls back to runtimeLastError', () => {
  assert.equal(
    resolveDesktopReleaseStripMessage({
      desktopReleaseError: '',
      runtimeLastError: 'runtime version mismatch',
    }),
    'runtime version mismatch',
  );
});
