import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseDesktopReleaseInfo,
  parseDesktopUpdateCheckResult,
  parseDesktopUpdateState,
} from '../src/shell/renderer/bridge/runtime-bridge/types';

test('desktop release info parser accepts bundled runtime metadata', () => {
  const parsed = parseDesktopReleaseInfo({
    desktopVersion: '0.2.0',
    runtimeVersion: '0.2.0',
    channel: 'stable',
    commit: 'abc123',
    builtAt: '2026-03-15T00:00:00Z',
    runtimeReady: true,
    runtimeStagedPath: '/tmp/nimi',
  });

  assert.equal(parsed.desktopVersion, '0.2.0');
  assert.equal(parsed.runtimeVersion, '0.2.0');
  assert.equal(parsed.runtimeReady, true);
  assert.equal(parsed.runtimeStagedPath, '/tmp/nimi');
});

test('desktop update state parser accepts progress payload', () => {
  const parsed = parseDesktopUpdateState({
    status: 'downloading',
    currentVersion: '0.1.0',
    targetVersion: '0.2.0',
    downloadedBytes: 512,
    totalBytes: 1024,
    readyToRestart: false,
  });

  assert.equal(parsed.status, 'downloading');
  assert.equal(parsed.downloadedBytes, 512);
  assert.equal(parsed.totalBytes, 1024);
  assert.equal(parsed.readyToRestart, false);
});

test('desktop update check parser accepts stable update payload', () => {
  const parsed = parseDesktopUpdateCheckResult({
    available: true,
    currentVersion: '0.1.0',
    targetVersion: '0.2.0',
    notes: 'Release notes',
    pubDate: '2026-03-15T00:00:00Z',
  });

  assert.equal(parsed.available, true);
  assert.equal(parsed.currentVersion, '0.1.0');
  assert.equal(parsed.targetVersion, '0.2.0');
  assert.equal(parsed.notes, 'Release notes');
});
