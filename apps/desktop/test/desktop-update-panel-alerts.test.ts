import assert from 'node:assert/strict';
import test from 'node:test';

import { collectDesktopUpdatePanelAlerts } from '../src/shell/renderer/features/settings/settings-preferences-panel';

test('desktop update panel surfaces desktop release errors as warnings', () => {
  const alerts = collectDesktopUpdatePanelAlerts({
    desktopReleaseError: 'bundled runtime staging failed',
    runtimeLastError: '',
    updateLastError: '',
  });

  assert.deepEqual(alerts, [
    {
      tone: 'warning',
      message: 'bundled runtime staging failed',
    },
  ]);
});

test('desktop update panel keeps runtime and updater errors visible with distinct tones', () => {
  const alerts = collectDesktopUpdatePanelAlerts({
    desktopReleaseError: '',
    runtimeLastError: 'runtime binary mismatch',
    updateLastError: 'DESKTOP_UPDATER_INSTALL_FAILED: boom',
  });

  assert.deepEqual(alerts, [
    {
      tone: 'warning',
      message: 'runtime binary mismatch',
    },
    {
      tone: 'error',
      message: 'DESKTOP_UPDATER_INSTALL_FAILED: boom',
    },
  ]);
});
