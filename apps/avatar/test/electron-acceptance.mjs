import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const workspaceRoot = path.resolve(root, '..', '..');

test('Avatar Electron entry delegates exclusively to the official Desktop supervisor', () => {
  for (const relativePath of [
    'scripts/run-electron-dev.mjs',
    'src-electron/main.ts',
    'src-electron/preload.cts',
    'tsconfig.electron.json',
  ]) {
    assert.equal(existsSync(path.join(root, relativePath)), true, `${relativePath} should exist`);
  }

  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const rootPackageJson = JSON.parse(readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['dev:electron'], 'node scripts/run-electron-dev.mjs');
  assert.equal(rootPackageJson.scripts['dev:electron:avatar'], 'pnpm --filter @nimiplatform/avatar dev:electron');

  const launcherSource = readFileSync(path.join(root, 'scripts', 'run-electron-dev.mjs'), 'utf8');
  assert.match(launcherSource, /apps[\\/]+desktop[\\/]+scripts[\\/]+run-electron-dev\.mjs/);
  assert.match(launcherSource, /--avatar-only/);
  assert.doesNotMatch(launcherSource, /(?:_electron\.launch|electron(?:\.cmd)?\s+dist-electron|path-to-app)/i);

  const desktopLauncherSource = readFileSync(
    path.join(workspaceRoot, 'apps', 'desktop', 'scripts', 'run-electron-dev.mjs'),
    'utf8',
  );
  assert.match(desktopLauncherSource, /NIMI_DESKTOP_ELECTRON_AVATAR_ONLY/);
  assert.match(desktopLauncherSource, /NIMI_AVATAR_ELECTRON_RENDERER_URL/);
  assert.match(desktopLauncherSource, /NIMI_AVATAR_AGENT_ID/);
});

test('standalone Avatar Electron main fails closed and preload exposes only the standard bridge', () => {
  const mainSource = readFileSync(path.join(root, 'src-electron', 'main.ts'), 'utf8');
  const preloadSource = readFileSync(path.join(root, 'src-electron', 'preload.cts'), 'utf8');
  const bootstrapSource = readFileSync(
    path.join(root, 'src', 'shell', 'renderer', 'app-shell', 'app-bootstrap.ts'),
    'utf8',
  );

  assert.match(mainSource, /avatar-standalone-electron-host-forbidden/);
  assert.match(mainSource, /launch_avatar_through_desktop_supervisor/);
  assert.doesNotMatch(mainSource, /new BrowserWindow|registerNimiElectronRuntimeBridge/);
  assert.match(preloadSource, /installNimiElectronRuntimeBridge/);
  assert.doesNotMatch(preloadSource, /__NIMI_AVATAR_ELECTRON__/);

  assert.match(bootstrapSource, /createNimiBundledAvatarRuntimeClient/);
  assert.match(bootstrapSource, /session\.getSnapshot/);
  assert.match(bootstrapSource, /session\.subscribe/);
  assert.match(bootstrapSource, /realm\.listPersonaCharacters/);
  assert.match(bootstrapSource, /currentAgent\.get/);
  assert.doesNotMatch(bootstrapSource, /getAccessToken|bindAvatarRuntimeIdentity|registerAvatarRuntimeApp/);
});

test('real Avatar Electron acceptance is owned by the sequential workspace observer', () => {
  const observerSource = readFileSync(
    path.join(workspaceRoot, 'scripts', 'run-electron-full-support-observer.mjs'),
    'utf8',
  );
  assert.match(observerSource, /playwright/);
  assert.match(observerSource, /connectOverCDP/);
  assert.doesNotMatch(observerSource, /_electron\.launch/);
});
