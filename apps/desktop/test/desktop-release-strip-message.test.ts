import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDesktopReleaseStripMessage } from '../src/shell/renderer/app-shell/layouts/desktop-release-strip';

test('desktop release strip resolves desktopReleaseError first', () => {
  assert.equal(
    resolveDesktopReleaseStripMessage({
      desktopReleaseError: 'Desktop release metadata invalid',
    }),
    'Desktop release metadata invalid',
  );
});

test('desktop release strip stays hidden without a Desktop release error', () => {
  assert.equal(
    resolveDesktopReleaseStripMessage({
      desktopReleaseError: '',
    }),
    '',
  );
});
