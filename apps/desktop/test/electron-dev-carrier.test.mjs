import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  resolveDesktopDevObservationArguments,
  resolvePersistentDesktopDevProfile,
  resolveSignedDesktopDevCarrier,
} from '../scripts/lib/electron-dev-carrier.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const electronMainPath = new URL('../src-electron/main.ts', import.meta.url);

test('Desktop dev resolves the signed external Electron carrier and persistent profile', () => {
  const carrier = resolveSignedDesktopDevCarrier({
    platform: 'win32',
    architecture: 'x64',
    electronVersion: '42.5.0',
    workspaceRoot,
    existsSync: () => true,
  });
  assert.equal(carrier, path.join(
    workspaceRoot,
    '.nimi', 'local', 'electron-desktop-runtime', '42.5.0', 'Nimi Desktop Runtime.exe',
  ));
  assert.equal(
    resolvePersistentDesktopDevProfile(workspaceRoot),
    path.join(workspaceRoot, '.nimi', 'local', 'dev-profiles', 'desktop'),
  );
});

test('Desktop dev fails closed when the signed carrier is absent', () => {
  assert.throws(
    () => resolveSignedDesktopDevCarrier({
      platform: 'win32',
      architecture: 'x64',
      electronVersion: '42.5.0',
      workspaceRoot,
      existsSync: () => false,
    }),
    (error) => error.reasonCode === 'desktop-dev-signed-carrier-missing'
      && error.actionHint === 'run_pnpm_build_dev_kernel_electron_carrier',
  );
});

test('Desktop dev rejects unsigned-carrier platforms instead of falling back to workspace Electron', () => {
  assert.throws(
    () => resolveSignedDesktopDevCarrier({
      platform: 'linux',
      architecture: 'x64',
      electronVersion: '42.5.0',
      workspaceRoot,
      existsSync: () => true,
    }),
    (error) => error.reasonCode === 'desktop-dev-signed-carrier-platform-unsupported',
  );
});

test('Desktop dev CDP observation is explicit, loopback-only, and fail-closed', () => {
  assert.deepEqual(resolveDesktopDevObservationArguments({}), []);
  assert.deepEqual(resolveDesktopDevObservationArguments({
    NIMI_DESKTOP_DEV_CDP_PORT: '19470',
  }), [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=19470',
  ]);
  assert.throws(
    () => resolveDesktopDevObservationArguments({ NIMI_DESKTOP_DEV_CDP_PORT: '80' }),
    (error) => error.reasonCode === 'desktop-dev-observation-port-invalid',
  );
});

test('Desktop signed Electron host exposes the Kit standard file dialog surface', async () => {
  const source = await readFile(electronMainPath, 'utf8');
  assert.match(source, /openFileDialog: openDesktopStandardFileDialog/u);
  assert.match(source, /dialog\.showOpenDialog/u);
});
