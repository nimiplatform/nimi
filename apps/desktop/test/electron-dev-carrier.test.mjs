import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  resolveDesktopDevObservationArguments,
  resolveMacOSDesktopAcceptanceEnvironment,
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

test('Desktop dev resolves only the fixed installed macOS development application', () => {
  assert.equal(resolveSignedDesktopDevCarrier({
    platform: 'darwin',
    architecture: 'arm64',
    electronVersion: '42.5.0',
    workspaceRoot,
    existsSync: () => true,
  }), '/Applications/Nimi Dev.app/Contents/MacOS/Nimi Dev');
  assert.throws(() => resolveSignedDesktopDevCarrier({
    platform: 'darwin',
    architecture: 'arm64',
    electronVersion: '42.5.0',
    workspaceRoot,
    existsSync: () => false,
  }), (error) => error.reasonCode === 'dev-runtime-service-not-installed');
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

test('macOS Desktop CDP is coupled to one fresh private acceptance evidence root', async () => {
  const authorityRoot = path.join(workspaceRoot, '.nimi', 'local', 'acceptance');
  await mkdir(authorityRoot, { recursive: true });
  const evidenceRoot = await mkdtemp(path.join(authorityRoot, 'carrier-contract-'));
  await chmod(evidenceRoot, 0o700);
  const desktopUserDataRoot = path.join(evidenceRoot, 'desktop-user-data');
  const zhiyuUserDataRoot = path.join(evidenceRoot, 'zhiyu-user-data');
  await mkdir(desktopUserDataRoot, { mode: 0o700 });
  await mkdir(zhiyuUserDataRoot, { mode: 0o700 });
  try {
    const value = resolveMacOSDesktopAcceptanceEnvironment({
      env: {
        NIMI_MACOS_DEV_ACCEPTANCE: '1',
        NIMI_MACOS_DEV_ACCEPTANCE_ROOT: evidenceRoot,
        NIMI_DESKTOP_DEV_CDP_PORT: '19470',
        NIMI_MACOS_DEV_ACCEPTANCE_ZHIYU_CDP_PORT: '19471',
      },
      workspaceRoot,
    });
    assert.equal(value.NIMI_MACOS_DEV_ACCEPTANCE_ROOT, evidenceRoot);
    assert.equal(value.NIMI_DEV_KERNEL_CHECKPOINT, '1');
    assert.equal(value.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_CDP_PORT, '19471');
    assert.equal(value.NIMI_MACOS_DEV_ACCEPTANCE_DESKTOP_USER_DATA_ROOT, desktopUserDataRoot);
    assert.equal(value.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT, zhiyuUserDataRoot);
    assert.equal(
      value.NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE,
      path.join(evidenceRoot, 'oauth-authorization-url.txt'),
    );
    assert.throws(() => resolveMacOSDesktopAcceptanceEnvironment({
      env: { NIMI_DESKTOP_DEV_CDP_PORT: '19470' },
      workspaceRoot,
    }), (error) => error.reasonCode === 'desktop-dev-acceptance-profile-invalid');
    await writeFile(path.join(evidenceRoot, 'oauth-authorization-url.txt'), 'occupied\n');
    assert.throws(() => resolveMacOSDesktopAcceptanceEnvironment({
      env: {
        NIMI_MACOS_DEV_ACCEPTANCE: '1',
        NIMI_MACOS_DEV_ACCEPTANCE_ROOT: evidenceRoot,
        NIMI_DESKTOP_DEV_CDP_PORT: '19470',
        NIMI_MACOS_DEV_ACCEPTANCE_ZHIYU_CDP_PORT: '19471',
      },
      workspaceRoot,
    }), (error) => error.reasonCode === 'desktop-dev-acceptance-capture-not-fresh');
  } finally {
    await rm(evidenceRoot, { recursive: true, force: true });
  }
});

test('Desktop signed Electron host exposes the Kit standard file dialog surface', async () => {
  const source = await readFile(electronMainPath, 'utf8');
  assert.match(source, /openFileDialog: openDesktopStandardFileDialog/u);
  assert.match(source, /dialog\.showOpenDialog/u);
});
