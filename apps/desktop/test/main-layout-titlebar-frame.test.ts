import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveMainLayoutTitlebarFrame,
} from '../src/shell/renderer/app-shell/layouts/main-layout-titlebar-frame.js';

test('native Electron frame does not add a second macOS traffic-light inset', () => {
  assert.deepEqual(resolveMainLayoutTitlebarFrame(false), {
    topInsetClass: 'top-0',
    contentTopPaddingClass: 'pt-14',
    settingsMenuFallbackTop: 64,
    leftInsetClass: 'pl-3',
  });
});

test('custom titlebar capability retains the admitted macOS traffic-light inset', () => {
  assert.deepEqual(resolveMainLayoutTitlebarFrame(true), {
    topInsetClass: 'top-7',
    contentTopPaddingClass: 'pt-[calc(3.5rem+1.75rem)]',
    settingsMenuFallbackTop: 92,
    leftInsetClass: 'pl-[92px]',
  });
});
