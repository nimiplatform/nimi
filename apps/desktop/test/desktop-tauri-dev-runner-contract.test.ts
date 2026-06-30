import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runnerSource = fs.readFileSync(
  path.join(root, 'scripts/tauri-dev-runner.mjs'),
  'utf8',
);
const runTauriDevSource = fs.readFileSync(
  path.join(root, 'scripts/run-tauri-dev.mjs'),
  'utf8',
);
const workspacePackageJson = JSON.parse(fs.readFileSync(
  path.join(root, '../..', 'package.json'),
  'utf8',
)) as {
  scripts?: Record<string, string>;
};
const windowsDevConfig = JSON.parse(fs.readFileSync(
  path.join(root, 'src-tauri/tauri.dev.windows.conf.json'),
  'utf8',
)) as {
  build?: {
    runner?: {
      cmd?: string;
      args?: string[];
    };
  };
};

test('Windows Tauri dev runner stops the stale desktop binary before Cargo rebuilds it', () => {
  const resolveIndex = runnerSource.indexOf('const binaryPath = resolveDesktopBinary(cargoArgs);');
  const launchResolveIndex = runnerSource.indexOf('const launchBinaryPath = resolveDesktopLaunchBinary(binaryPath);');
  const stopIndex = runnerSource.indexOf('stopExistingWindowsDevBinary(binaryPath);');
  const buildIndex = runnerSource.indexOf("const buildArgs = ['build', '--quiet', ...cargoArgs];");

  assert.ok(resolveIndex > -1, 'runner must resolve the desktop binary path before build');
  assert.ok(launchResolveIndex > resolveIndex, 'runner must resolve a separate dev launch binary');
  assert.ok(stopIndex > resolveIndex, 'runner must stop the resolved desktop binary');
  assert.ok(buildIndex > stopIndex, 'stale binary cleanup must run before cargo build');
  assert.match(runnerSource, /Get-CimInstance Win32_Process -Filter "Name = '\$BinaryName'"/);
  assert.match(runnerSource, /ExecutablePath[\s\S]*GetFullPath\(\$_.ExecutablePath\)[\s\S]*-ieq \$BinaryPath/);
  assert.match(runnerSource, /stale dev binary process still running for \\\$\{BinaryPath\}: \$RemainingIds/);
  assert.doesNotMatch(runnerSource, /stale dev binary process still running for \$BinaryPath: \$RemainingIds/);
});

test('Windows Tauri dev runner launches a copy instead of locking Cargo output', () => {
  const stopLaunchIndex = runnerSource.indexOf('stopExistingWindowsDevBinary(launchBinaryPath, { replacementMarkerPath });');
  const copyIndex = runnerSource.indexOf('copyFileSync(binaryPath, launchBinaryPath);');
  const spawnIndex = runnerSource.indexOf('spawnDesktopBinary(launchBinaryPath, appArgs, { replacementMarkerPath });');

  assert.match(runnerSource, /const DESKTOP_LAUNCH_BINARY_NAME = process\.platform === 'win32'[\s\S]*'nimiplatform-desktop-dev-run\.exe'/);
  assert.match(runnerSource, /function resolveDesktopLaunchBinary\(cargoBinaryPath\)/);
  assert.ok(stopLaunchIndex > -1, 'runner must stop any previous launch copy before replacing it');
  assert.ok(copyIndex > stopLaunchIndex, 'runner must copy the Cargo output to the launch binary');
  assert.ok(spawnIndex > copyIndex, 'runner must launch the copied dev binary');
  assert.doesNotMatch(runnerSource, /spawnDesktopBinary\(binaryPath, appArgs\)/);
});

test('Windows Tauri dev config delegates runner subcommands through the batch wrapper', () => {
  assert.deepEqual(windowsDevConfig.build?.runner, {
    cmd: '../scripts/tauri-dev-runner.cmd',
  });
  assert.equal(Object.hasOwn(windowsDevConfig.build?.runner ?? {}, 'args'), false);

  const wrapperPath = path.join(root, 'scripts/tauri-dev-runner.cmd');
  assert.equal(fs.existsSync(wrapperPath), true);
  const wrapperSource = fs.readFileSync(wrapperPath, 'utf8');
  assert.match(wrapperSource, /node "%~dp0tauri-dev-runner\.mjs" %\*/);
  assert.doesNotMatch(wrapperSource, /node\s+run\s+\.\.\/scripts\/tauri-dev-runner\.mjs/);
});

test('Windows Tauri dev runner does not require local code signing by default', () => {
  assert.doesNotMatch(runnerSource, /Set-AuthenticodeSignature/);
  assert.doesNotMatch(runnerSource, /New-SelfSignedCertificate/);
  assert.doesNotMatch(runnerSource, /TrustedPublisher/);
  assert.doesNotMatch(runnerSource, /signWindowsDevBinary/);
});

test('Windows Tauri dev runner treats replacement kills as successful handoff', () => {
  assert.match(runnerSource, /const DESKTOP_REPLACEMENT_MARKER_NAME = '.nimiplatform-desktop-dev-run.replace.json'/);
  assert.match(runnerSource, /function wasReplacedByNewRunner\(childPid, replacementMarkerPath\)/);
  assert.match(runnerSource, /marker\.pids\.includes\(childPid\)/);
  assert.match(runnerSource, /stopExistingWindowsDevBinary\(launchBinaryPath, \{ replacementMarkerPath \}\)/);
  assert.match(runnerSource, /wasReplacedByNewRunner\(child\.pid, options\.replacementMarkerPath\)[\s\S]*process\.exit\(0\)/);
});

test('Windows Tauri dev runner lets Ctrl-C reach the desktop child before forced cleanup', () => {
  assert.match(runnerSource, /function requestProcessTreeShutdown\(child, signal\)/);
  assert.match(runnerSource, /const SIGNAL_FORCE_KILL_GRACE_MS = 1500/);
  assert.doesNotMatch(runnerSource, /spawnSync\('taskkill\.exe'/);
  assert.match(runnerSource, /function forceKillProcessTree\(child\)/);
  assert.match(runnerSource, /taskkill\.exe/);
  assert.match(runnerSource, /\['\/pid', String\(child\.pid\), '\/t', '\/f'\]/);
  assert.match(runnerSource, /process\.on\(signal, \(\) => exitFromSignal\(signal\)\)/);
  assert.match(runnerSource, /requestProcessTreeShutdown\(activeDesktopChild, signal\)/);
  assert.match(runnerSource, /if \(signal !== 'SIGINT'\)/);
});

test('Desktop Tauri dev command rebuilds SDK dist when renderer aliases are missing or stale', () => {
  const sdkBuildIndex = runTauriDevSource.indexOf('if (ensureSdkDistForDesktopDev()) {');
  const spawnIndex = runTauriDevSource.indexOf('const child = spawn(command, commandArgs');

  assert.ok(sdkBuildIndex > -1, 'dev command must ensure @nimiplatform/sdk dist');
  assert.ok(spawnIndex > sdkBuildIndex, 'SDK dist must be ensured before tauri dev starts');
  assert.match(runTauriDevSource, /const REQUIRED_SDK_DIST_FILES = \[/);
  assert.match(runTauriDevSource, /'core\/app\/index\.js'/);
  assert.match(runTauriDevSource, /'core\/contracts\/index\.js'/);
  assert.match(runTauriDevSource, /'features\/conversation\/index\.js'/);
  assert.match(runTauriDevSource, /const SDK_DIST_FRESHNESS_INPUT_EXTENSIONS = new Set\(\[/);
  assert.match(runTauriDevSource, /const SDK_DIST_FRESHNESS_SKIP_DIRS = new Set\(\['dist', 'node_modules'\]\)/);
  assert.match(runTauriDevSource, /function collectNewestSdkInputMtimeMs\(rootDir\)/);
  assert.match(runTauriDevSource, /oldestDistMtimeMs = Math\.min\(oldestDistMtimeMs, statSync\(distPath\)\.mtimeMs\)/);
  assert.match(runTauriDevSource, /const newestSdkInputMtimeMs = collectNewestSdkInputMtimeMs\(sdkPackageRoot\)/);
  assert.match(runTauriDevSource, /return newestSdkInputMtimeMs <= oldestDistMtimeMs/);
  assert.match(runTauriDevSource, /function isSdkDistReadyForDesktopDev\(\)/);
  assert.match(runTauriDevSource, /if \(isSdkDistReadyForDesktopDev\(\)\) \{\s*return false;\s*\}/);
  assert.match(runTauriDevSource, /'--filter', '@nimiplatform\/sdk', 'build'/);
  assert.match(runTauriDevSource, /process\.platform === 'win32' \? 'cmd\.exe' : pnpmBin/);
  assert.match(runTauriDevSource, /\['\/d', '\/s', '\/c', \[pnpmBin, \.\.\.pnpmArgs\]\.map\(quoteCmdArg\)\.join\(' '\)\]/);
  assert.doesNotMatch(runTauriDevSource, /spawnSync\(pnpmBin, \['--dir'/);
});

test('Desktop Tauri dev command refreshes renderer optimizer after rebuilding SDK dist', () => {
  assert.match(runTauriDevSource, /const viteOptimizerCacheRoot = path\.join\(desktopRoot, 'node_modules', '\.vite'\)/);
  assert.match(runTauriDevSource, /function refreshRendererOptimizerAfterSdkRebuild\(\)/);
  assert.match(runTauriDevSource, /rmSync\(viteOptimizerCacheRoot, \{ recursive: true, force: true \}\)/);
  assert.match(runTauriDevSource, /childEnv\.NIMI_DESKTOP_DEV_RENDERER_RESTART = '1'/);
  assert.match(runTauriDevSource, /if \(ensureSdkDistForDesktopDev\(\)\) \{\s*refreshRendererOptimizerAfterSdkRebuild\(\);\s*\}/);
});

test('Workspace desktop dev script avoids a nested pnpm batch wrapper on Windows', () => {
  assert.equal(workspacePackageJson.scripts?.['dev:desktop'], 'node apps/desktop/scripts/run-tauri-dev.mjs');
  assert.match(runTauriDevSource, /const desktopRoot = path\.resolve\(path\.dirname\(fileURLToPath\(import\.meta\.url\)\), '\.\.'\)/);
  assert.match(runTauriDevSource, /cwd: desktopRoot/);
  assert.match(runTauriDevSource, /path\.join\(desktopRoot, 'node_modules', '\.bin', process\.platform === 'win32'\s*\? 'tauri\.cmd'\s*: 'tauri'\)/);
});

test('Desktop Tauri dev command lets Ctrl-C reach Tauri before forced cleanup', () => {
  assert.match(runTauriDevSource, /function requestProcessTreeShutdown\(child, signal\)/);
  assert.match(runTauriDevSource, /const SIGNAL_FORCE_KILL_GRACE_MS = 1500/);
  assert.doesNotMatch(runTauriDevSource, /spawnSync\('taskkill\.exe'/);
  assert.match(runTauriDevSource, /function forceKillProcessTree\(child\)/);
  assert.match(runTauriDevSource, /taskkill\.exe/);
  assert.match(runTauriDevSource, /let activeTauriChild = null/);
  assert.match(runTauriDevSource, /process\.on\(signal, \(\) => exitFromSignal\(signal\)\)/);
  assert.match(runTauriDevSource, /requestProcessTreeShutdown\(activeTauriChild, signal\)/);
  assert.match(runTauriDevSource, /if \(signal !== 'SIGINT'\)/);
  assert.doesNotMatch(runTauriDevSource, /process\.kill\(process\.pid, signal\)/);
});

test('Windows Tauri dev child shells do not inherit stdin while waiting for Ctrl-C cleanup', () => {
  assert.match(runTauriDevSource, /const inheritedChildStdio = process\.platform === 'win32'[\s\S]*\['ignore', 'inherit', 'inherit'\][\s\S]*: 'inherit'/);
  assert.match(runTauriDevSource, /stdio: inheritedChildStdio/);
  assert.match(runnerSource, /const inheritedChildStdio = process\.platform === 'win32'[\s\S]*\['ignore', 'inherit', 'inherit'\][\s\S]*: 'inherit'/);
  assert.match(runnerSource, /stdio: inheritedChildStdio/);
});
