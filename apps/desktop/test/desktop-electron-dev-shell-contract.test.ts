import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function readIfExists(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

test('desktop package exposes an Electron dev shell entrypoint', () => {
  assert.equal(
    packageJson.scripts?.['dev:electron'],
    'node scripts/run-electron-dev.mjs',
  );
  assert.equal(
    packageJson.scripts?.['build:electron'],
    'pnpm run prepare:workspace-surfaces && tsc -p tsconfig.electron.json && node scripts/bundle-electron-main.mjs && node scripts/bundle-electron-preload.mjs',
  );
  assert.equal(
    packageJson.scripts?.['test:e2e:electron'],
    'corepack pnpm run build:renderer && corepack pnpm run build:electron && node --test test/electron-acceptance.mjs',
  );
  assert.match(packageJson.devDependencies?.electron ?? '', /^\^/);
  assert.match(packageJson.devDependencies?.playwright ?? '', /^\^/);
});

test('desktop Electron host installs the standard shell bridge for the Desktop renderer', () => {
  const mainPath = path.join(root, 'src-electron', 'main.ts');
  const preloadPath = path.join(root, 'src-electron', 'preload.cts');
  const mainSource = readIfExists(mainPath);
  const preloadSource = readIfExists(preloadPath);

  assert.notEqual(mainSource, '', 'desktop Electron main source must exist');
  assert.notEqual(preloadSource, '', 'desktop Electron preload source must exist');
  assert.match(preloadSource, /installNimiElectronRuntimeBridge/);
  assert.match(mainSource, /const APP_ID = 'nimi\.desktop'/);
  assert.match(mainSource, /registerNimiElectronRuntimeBridge\(/);
  assert.match(mainSource, /appId: APP_ID/);
  assert.match(mainSource, /runtimeTrustedCaller:\s*{[\s\S]*mode: 'desktop-shell'/);
  assert.match(mainSource, /NIMI_DESKTOP_ELECTRON_RENDERER_URL/);
  assert.doesNotMatch(mainSource, /resolveOptionalDesktopElectronLocalAgentIdentity/);
  assert.doesNotMatch(mainSource, /NIMI_DESKTOP_ELECTRON_LOCAL_AGENT_REF/);
  assert.doesNotMatch(mainSource, /assertOpaqueElectronLocalAgentRef/);
  assert.doesNotMatch(mainSource, /localAgentIdentity/);
  assert.doesNotMatch(mainSource, /local-agent:desktop-electron/);
});

test('desktop Electron dev runner starts Vite and passes the renderer URL to Electron', () => {
  const runnerPath = path.join(root, 'scripts', 'run-electron-dev.mjs');
  const mainBundlePath = path.join(root, 'scripts', 'bundle-electron-main.mjs');
  const bundlePath = path.join(root, 'scripts', 'bundle-electron-preload.mjs');
  const tsconfigPath = path.join(root, 'tsconfig.electron.json');
  const runnerSource = readIfExists(runnerPath);
  const mainBundleSource = readIfExists(mainBundlePath);
  const bundleSource = readIfExists(bundlePath);

  assert.notEqual(runnerSource, '', 'desktop Electron dev runner must exist');
  assert.notEqual(mainBundleSource, '', 'desktop Electron main bundler must exist');
  assert.notEqual(bundleSource, '', 'desktop Electron preload bundler must exist');
  assert.equal(fs.existsSync(tsconfigPath), true, 'desktop Electron tsconfig must exist');
  assert.match(runnerSource, /ensureSdkDistForDesktopDev\(\)/);
  assert.match(runnerSource, /const rendererUrl = process\.env\.NIMI_DESKTOP_ELECTRON_RENDERER_URL \|\| 'http:\/\/127\.0\.0\.1:1420'/);
  assert.match(runnerSource, /'--',\s*'vite',/);
  assert.doesNotMatch(runnerSource, /process\.execPath,\s*viteBin/);
  assert.match(runnerSource, /'--port',\s*'1420'/);
  assert.match(runnerSource, /NIMI_DESKTOP_ELECTRON_RENDERER_URL: rendererUrl/);
  assert.match(runnerSource, /dist-electron\/main\.js/);
  assert.match(mainBundleSource, /src-electron\/main\.ts/);
  assert.match(mainBundleSource, /dist-electron\/main\.js/);
  assert.match(bundleSource, /src-electron\/preload\.cts/);
  assert.match(bundleSource, /dist-electron\/preload\.cjs/);
});
