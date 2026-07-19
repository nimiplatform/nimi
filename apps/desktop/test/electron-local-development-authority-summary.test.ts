import assert from 'node:assert/strict';
import { access, lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type {
  NimiElectronLocalDevelopmentAuthoritySummary,
  NimiElectronLocalDevelopmentControl,
} from '@nimiplatform/kit/shell/electron/main';
import {
  authoritySummaryDescriptor,
  createDesktopElectronLocalDevelopmentProjectionPublisher,
} from '../src-electron/local-development-authority-summary';

function availableSummary(): NimiElectronLocalDevelopmentAuthoritySummary {
  return {
    developerMode: {
      availability: 'available',
      state: 'enabled',
      unavailableReason: null,
    },
    projectAuthorization: {
      availability: 'available',
      activeCount: 2,
      deniedCount: 5,
      revokedCount: 7,
      unavailableReason: null,
    },
  };
}

function control(
  getAuthoritySummary: () => Promise<NimiElectronLocalDevelopmentAuthoritySummary>,
): NimiElectronLocalDevelopmentControl {
  const unavailable = async (): Promise<never> => { throw new Error('not-called'); };
  return {
    getAuthoritySummary,
    evaluate: unavailable,
    decide: unavailable,
    listAuthorizations: async () => [],
    revokeAuthorization: unavailable,
    launch: unavailable,
    hostRunning: async () => false,
    terminateHost: async () => {},
    endRun: async () => {},
  };
}

test('Electron publisher writes the PID-bound bounded authority summary beside presence', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-authority-summary-')));
  const publisher = createDesktopElectronLocalDevelopmentProjectionPublisher({
    homeDirectory: home,
    control: control(async () => availableSummary()),
    processId: 4_242,
    now: () => new Date('2026-07-17T03:04:05.678Z'),
  });
  const directory = path.join(home, '.nimi', 'run', 'desktop', 'local-development');
  const presencePath = path.join(directory, 'presence.v1.json');
  const summaryPath = path.join(directory, 'authority-summary.v1.json');
  try {
    await publisher.start('http://127.0.0.1:42424');
    const presence = JSON.parse(await readFile(presencePath, 'utf8')) as Record<string, unknown>;
    const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as Record<string, unknown>;

    assert.deepEqual(Object.keys(presence).sort(), [
      'desktopAppId', 'desktopPid', 'endpoint', 'lastHeartbeatAt', 'schemaVersion', 'startedAt',
    ]);
    assert.deepEqual(Object.keys(summary).sort(), [
      'capturedAt', 'desktopAppId', 'desktopPid', 'developerMode',
      'projectAuthorization', 'schemaVersion',
    ]);
    assert.equal(summary.desktopPid, 4_242);
    assert.equal(summary.capturedAt, '2026-07-17T03:04:05.678Z');
    assert.equal((summary.developerMode as Record<string, unknown>).reasonCode, 'action-executed');
    assert.doesNotMatch(
      JSON.stringify(summary),
      /accountId|authorizationId|grantId|token|credential|canonicalProjectRoot/u,
    );
    if (process.platform !== 'win32') {
      assert.equal((await lstat(directory)).mode & 0o777, 0o700);
      assert.equal((await lstat(summaryPath)).mode & 0o777, 0o600);
    }
  } finally {
    await publisher.shutdown();
    await rm(home, { recursive: true, force: true });
  }
});

test('Electron publisher deletes the previous authority summary when the protected RPC fails', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-authority-failure-')));
  let fails = false;
  const reports: string[] = [];
  const publisher = createDesktopElectronLocalDevelopmentProjectionPublisher({
    homeDirectory: home,
    control: control(async () => {
      if (fails) throw Object.assign(new Error('bounded failure'), {
        reasonCode: 'runtime-service-unavailable',
      });
      return availableSummary();
    }),
    processId: 4_243,
    report: (message) => reports.push(message),
  });
  const summaryPath = path.join(
    home, '.nimi', 'run', 'desktop', 'local-development', 'authority-summary.v1.json',
  );
  try {
    await publisher.start('http://127.0.0.1:42425');
    await access(summaryPath);
    fails = true;
    await publisher.heartbeat();
    await assert.rejects(access(summaryPath), { code: 'ENOENT' });
    assert.deepEqual(reports, ['authority summary unavailable: runtime-service-unavailable']);
  } finally {
    await publisher.shutdown();
    await rm(home, { recursive: true, force: true });
  }
});

test('Electron publisher suppresses only the startup authority race and reports a persistent failure', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-authority-startup-race-'));
  const reports: string[] = [];
  const publisher = createDesktopElectronLocalDevelopmentProjectionPublisher({
    homeDirectory: home,
    control: control(async () => {
      throw Object.assign(new Error('bounded startup race'), {
        reasonCode: 'runtime-service-unavailable',
      });
    }),
    processId: 4_244,
    report: (message) => reports.push(message),
  });
  const summaryPath = path.join(
    home, '.nimi', 'run', 'desktop', 'local-development', 'authority-summary.v1.json',
  );
  try {
    await publisher.start('http://127.0.0.1:42426');
    await assert.rejects(access(summaryPath), { code: 'ENOENT' });
    assert.deepEqual(reports, []);

    await publisher.heartbeat();
    assert.deepEqual(reports, ['authority summary unavailable: runtime-service-unavailable']);
  } finally {
    await publisher.shutdown();
    await rm(home, { recursive: true, force: true });
  }
});

test('Electron authority descriptor rejects unsafe counts and inconsistent unavailable sections', () => {
  assert.throws(() => authoritySummaryDescriptor({
    ...availableSummary(),
    projectAuthorization: {
      ...availableSummary().projectAuthorization,
      activeCount: Number.MAX_SAFE_INTEGER + 1,
    },
  }, 42, '2026-07-17T03:04:05.678Z'), /local-development-authority-summary-untrusted/u);

  assert.throws(() => authoritySummaryDescriptor({
    ...availableSummary(),
    projectAuthorization: {
      ...availableSummary().projectAuthorization,
      availability: 'unavailable',
      unavailableReason: 'principal-unauthorized',
    },
  }, 42, '2026-07-17T03:04:05.678Z'), /local-development-authority-summary-untrusted/u);
});
