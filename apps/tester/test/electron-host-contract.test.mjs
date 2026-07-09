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

const requiredCommands = [
  'resolve_world_tour_fixture',
  'claim_world_tour_viewer_launch',
  'save_world_tour_viewer_preset',
  'open_world_tour_window',
];

test('tester owns an Electron host beside the Tauri host', () => {
  for (const relativePath of [
    'src-electron/main.ts',
    'src-electron/preload.cts',
    'src-electron/commands/tester-commands.ts',
    'tsconfig.electron.json',
  ]) {
    assert.equal(existsSync(path.join(root, relativePath)), true, `${relativePath} should exist`);
  }

  const packageJson = readJson('package.json');
  assert.match(packageJson.scripts['dev:electron'], /electron/);
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

test('Electron dev runner avoids Windows batch shims for long-running children', () => {
  const runnerSource = read('scripts/run-electron-dev.mjs');
  assert.match(runnerSource, /node_modules['"], ['"]vite['"], ['"]bin['"], ['"]vite\.js/);
  assert.match(runnerSource, /require\(['"]electron['"]\)/);
  assert.doesNotMatch(runnerSource, /cmd\.exe/);
  assert.doesNotMatch(runnerSource, /ComSpec/);
  assert.doesNotMatch(runnerSource, /corepack\.cmd/);
  assert.doesNotMatch(runnerSource, /spawn\(corepack,/);
});

test('Electron dev runner owns Ctrl-C cleanup for renderer and Electron process trees', () => {
  const runnerSource = read('scripts/run-electron-dev.mjs');
  assert.match(runnerSource, /const SIGNAL_EXIT_CODES = new Map/);
  assert.match(runnerSource, /function requestProcessTreeShutdown\(child, signal\)/);
  assert.match(runnerSource, /function forceKillProcessTree\(child\)/);
  assert.match(runnerSource, /taskkill\.exe/);
  assert.match(runnerSource, /process\.on\(signal, \(\) => shutdownFromSignal\(signal\)\)/);
  assert.match(runnerSource, /requestAllChildrenShutdown\(signal\)/);
  assert.doesNotMatch(runnerSource, /renderer\.kill\(\)/);
});

test('Electron dev runner clears stale tester renderers before launching Vite', () => {
  const runnerSource = read('scripts/run-electron-dev.mjs');
  const preflightIndex = runnerSource.indexOf('ensureRendererPortAvailable();');
  const spawnRendererIndex = runnerSource.indexOf('spawnRenderer();');

  assert.ok(preflightIndex > -1, 'Electron dev runner must preflight the renderer port');
  assert.ok(spawnRendererIndex > preflightIndex, 'renderer preflight must run before Vite starts');
  assert.match(runnerSource, /process\.execPath, \['scripts\/ensure-dev-renderer-port\.mjs'\]/);
});

test('Electron host uses canonical tester app identity for Runtime calls', () => {
  const mainSource = read('src-electron/main.ts');
  const sdkAcceptanceSource = read('src/shell/auth/electron-sdk-acceptance.ts');
  const acceptanceSource = read('test/electron-acceptance.mjs');

  assert.match(mainSource, /const APP_ID = 'nimi\.tester'/);
  assert.match(sdkAcceptanceSource, /appId:\s*'nimi\.tester'/);
  assert.doesNotMatch(mainSource, /com\.nimiplatform\.tester/);
  assert.doesNotMatch(sdkAcceptanceSource, /com\.nimiplatform\.tester/);
  assert.doesNotMatch(acceptanceSource, /com\.nimiplatform\.tester/);
});

test('Electron host owns sensitive Runtime auth metadata', () => {
  assert.equal(existsSync(path.join(root, 'src-electron/runtime-auth.ts')), true);
  const mainSource = read('src-electron/main.ts');
  const hostAuthSource = read('src-electron/runtime-auth.ts');
  const kitHostAuthSource = readRepo('kit/shell/electron/src/main/runtime-account-auth.ts');
  const rendererAuthSource = read('src/shell/auth/runtime-platform.ts');

  assert.match(mainSource, /trustedRuntimeMetadataProvider:\s*createTesterElectronTrustedRuntimeMetadataProvider/);
  assert.match(hostAuthSource, /createNimiElectronRuntimeAccountTrustedMetadataProvider/);
  assert.match(hostAuthSource, /appSession:\s*\{/);
  assert.match(hostAuthSource, /protectedAccess:\s*\{/);
  assert.match(kitHostAuthSource, /createNimiRuntimeAppSessionMetadataProvider/);
  assert.match(kitHostAuthSource, /protectedAccessToken:\s*\{/);
  assert.doesNotMatch(hostAuthSource, /\bwindow\b|\bdocument\b/);
  assert.match(rendererAuthSource, /resolveTesterRuntimeHostKind\(\) === 'electron'/);
  assert.match(rendererAuthSource, /authMetadata:\s*createRuntimeAppSessionMetadataProvider/);
});

test('Tester Runtime protected access cache keys in-flight requests by subject', () => {
  for (const source of [
    readRepo('kit/shell/electron/src/main/runtime-account-auth.ts'),
    read('src/shell/auth/runtime-platform.ts'),
  ]) {

    assert.match(source, /protectedAccessInflightKey/);
    assert.match(source, /const cacheKey =[\s\S]{0,220}subjectUserId/);
    assert.match(source, /protectedAccessInflightKey !== cacheKey/);
    assert.match(source, /if \(protectedAccessInflightKey === cacheKey\)/);
  }
});

test('Electron host keeps Runtime bridge in Kit and app commands in tester', () => {
  const mainSource = read('src-electron/main.ts');
  const preloadSource = read('src-electron/preload.cts');
  const commandSource = read('src-electron/commands/tester-commands.ts');

  assert.match(mainSource, /registerNimiElectronRuntimeBridge/);
  assert.match(mainSource, /createTesterElectronCommandHandlers/);
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

  for (const command of requiredCommands) {
    assert.match(commandSource, new RegExp(command));
  }
  assert.doesNotMatch(commandSource, /@grpc\/grpc-js/);
  assert.doesNotMatch(commandSource, /runtime\/internal/);
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
