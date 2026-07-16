import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  resolvePersistentDesktopDevProfile,
  resolveSignedDesktopDevCarrier,
} from '../scripts/lib/electron-dev-carrier.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..', '..');

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
