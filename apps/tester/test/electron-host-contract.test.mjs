import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readRepo(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function readRepoJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

test('tester owns an Electron host beside the Tauri host', () => {
  for (const relativePath of [
    'src-electron/main.ts',
    'src-electron/preload.cts',
    'tsconfig.electron.json',
  ]) {
    assert.equal(existsSync(path.join(root, relativePath)), true, `${relativePath} should exist`);
  }

  const packageJson = readJson('package.json');
  assert.equal(packageJson.scripts['dev:electron'], 'nimi-app dev --shell electron');
  assert.match(packageJson.scripts['build:electron'], /tsconfig\.electron\.json/);
  assert.match(packageJson.scripts['test:e2e:electron'], /electron-acceptance/);
  assert.equal(packageJson.devDependencies['@grpc/grpc-js'], undefined, 'tester must not own raw gRPC');
  assert.match(packageJson.devDependencies.electron || '', /^\^?42\./);
  assert.match(packageJson.devDependencies.playwright || '', /^\^?1\./);
  assert.match(packageJson.devDependencies.tsx || '', /^\^?4\./);
});

test('repo exposes a first-class tester Electron dev command', () => {
  const packageJson = readRepoJson('package.json');
  assert.equal(
    packageJson.scripts['dev:electron:tester'],
    'pnpm --filter @nimiplatform/tester dev:electron',
  );
});

test('Electron development is supervised by Desktop and not by app-owned scripts', () => {
  const launcher = readRepo('app-tools/scripts/dev-shell.mjs');
  const supervisor = readRepo('apps/desktop/src-tauri/src/desktop_local_development/supervisor.rs');
  assert.match(launcher, /\/v1\/start/);
  assert.match(supervisor, /spawn_package_script\(run\.clone\(\), "dev:renderer"\)/);
  assert.match(supervisor, /launch_electron_host/);
  assert.equal(existsSync(path.join(root, 'scripts/run-electron-dev.mjs')), false);
});

test('Electron host uses canonical tester app identity for Runtime calls', () => {
  const mainSource = read('src-electron/main.ts');
  const sdkAcceptanceSource = read('src/shell/auth/electron-sdk-acceptance.ts');
  const localAppClientSource = read('src/shell/local-app-runtime-platform.ts');
  const acceptanceSource = read('test/electron-acceptance.mjs');

  assert.match(mainSource, /const APP_ID = 'nimi\.tester'/);
  assert.match(sdkAcceptanceSource, /testerLocalAppRuntimePlatform/);
  assert.doesNotMatch(localAppClientSource, /(?:appId|sessionId|grantId)\s*[:=]/);
  assert.doesNotMatch(mainSource, /com\.nimiplatform\.tester/);
  assert.doesNotMatch(sdkAcceptanceSource, /com\.nimiplatform\.tester/);
  assert.doesNotMatch(acceptanceSource, /com\.nimiplatform\.tester/);
});

test('Electron local-app host does not synthesize Runtime account authority', () => {
  assert.equal(existsSync(path.join(root, 'src-electron/runtime-auth.ts')), false);
  const mainSource = read('src-electron/main.ts');
  const rendererAuthSource = read('src/shell/auth/runtime-platform.ts');

  assert.doesNotMatch(mainSource, /trustedRuntimeMetadataProvider|createTesterElectronTrustedRuntimeMetadataProvider/);
  assert.equal(existsSync(path.join(repoRoot, 'kit/shell/electron/src/main/runtime-account-auth.ts')), false);
  assert.doesNotMatch(rendererAuthSource, /DeveloperRegistered|FullAppRegistration|AppSessionMetadataProvider/);
  assert.doesNotMatch(rendererAuthSource, /local-developer|developerRegistration|getRuntimeAccountCaller/);
  assert.match(rendererAuthSource, /testerLocalAppRuntimePlatform\.auth\.status\(\)/);
  assert.match(rendererAuthSource, /operationAllowed/);
  assert.doesNotMatch(rendererAuthSource, /readonly client:|readonly auth:/);
});

test('Tester renderer carrier retains no portable protected-access cache', () => {
  for (const source of [read('src/shell/auth/runtime-platform.ts')]) {
    assert.doesNotMatch(source, /protectedAccessInflightKey|protectedAccessCache|authorizeExternalPrincipal/);
    assert.doesNotMatch(source, /x-nimi-access-token-(?:id|secret)|tokenId|secret/);
  }
});

test('Electron host exposes only the fixed Kit app-host bridge', () => {
  const mainSource = read('src-electron/main.ts');
  const preloadSource = read('src-electron/preload.cts');

  assert.match(mainSource, /registerNimiElectronAppBridge/);
  assert.doesNotMatch(mainSource, /registerNimiElectronRuntimeBridge/);
  assert.doesNotMatch(mainSource, /createTesterElectronCommandHandlers/);
  assert.doesNotMatch(mainSource, /runtimeEndpoint|NIMI_RUNTIME_GRPC_ADDR|createGrpcClient/);
  assert.match(mainSource, /BrowserWindow/);
  assert.match(mainSource, /Menu\.setApplicationMenu\(null\)/);
  assert.match(mainSource, /autoHideMenuBar:\s*true/);
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /sandbox:\s*true/);
  assert.doesNotMatch(mainSource, /sandbox:\s*false/);
  assert.match(mainSource, /preload/);
  assert.match(mainSource, /setWindowOpenHandler/);
  assert.match(mainSource, /will-navigate/);
  assert.match(mainSource, /isTesterRendererUrl/);
  assert.match(mainSource, /setMenuBarVisibility\(false\)/);
  assert.match(mainSource, /removeMenu\(\)/);
  assert.match(mainSource, /hardenTesterWindowChrome\(window\)/);
  assert.doesNotMatch(mainSource, /new Set\(\['file:\/\/'\]\)/);
  assert.match(preloadSource, /@nimiplatform\/kit\/shell\/electron\/preload-cjs/);
  assert.match(preloadSource, /installNimiElectronRuntimeBridge/);
  assert.doesNotMatch(mainSource, /runtime\/internal/);
});

test('Electron host disables Chromium background networking before startup', () => {
  const mainSource = read('src-electron/main.ts');
  const configureIndex = mainSource.indexOf('configureTesterElectronChromiumRuntime();');
  const readyIndex = mainSource.indexOf('app.whenReady()');

  assert.ok(configureIndex > -1, 'Electron main must configure Chromium before app readiness');
  assert.ok(readyIndex > configureIndex, 'Chromium switches must be appended before app.whenReady()');
  assert.match(mainSource, /app\.commandLine\.appendSwitch\('disable-background-networking'\)/);
});

test('Electron spike evidence is not part of the accepted host', () => {
  assert.equal(existsSync(path.join(root, 'src-electron/spike')), false);
  assert.doesNotMatch(read('AGENTS.md'), /src-electron\/spike/);
});
