import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canUseDesktopUpdater,
  collectDesktopUpdatePanelAlerts,
} from '../src/shell/renderer/features/settings/settings-preferences-panel';

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
    updaterUnavailableReason: 'Desktop updates are unavailable in the current environment.',
    updateLastError: 'DESKTOP_UPDATER_INSTALL_FAILED: boom',
  });

  assert.deepEqual(alerts, [
    {
      tone: 'warning',
      message: 'runtime binary mismatch',
    },
    {
      tone: 'warning',
      message: 'Desktop updates are unavailable in the current environment.',
    },
    {
      tone: 'error',
      message: 'DESKTOP_UPDATER_INSTALL_FAILED: boom',
    },
  ]);
});

test('desktop update actions are disabled when updater is unavailable', () => {
  assert.equal(canUseDesktopUpdater({
    desktopReleaseError: null,
    updaterAvailable: false,
  }), false);
  assert.equal(canUseDesktopUpdater({
    desktopReleaseError: null,
    updaterAvailable: true,
  }), true);
  assert.equal(canUseDesktopUpdater({
    desktopReleaseError: 'release metadata unavailable',
    updaterAvailable: true,
  }), false);
});
