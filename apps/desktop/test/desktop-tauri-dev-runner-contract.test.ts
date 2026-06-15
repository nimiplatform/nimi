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

test('Windows Tauri dev runner tears down launched desktop child processes on runner shutdown', () => {
  assert.match(runnerSource, /function terminateProcessTree\(child\)/);
  assert.match(runnerSource, /taskkill\.exe/);
  assert.match(runnerSource, /\['\/pid', String\(child\.pid\), '\/t', '\/f'\]/);
  assert.match(runnerSource, /process\.on\(signal, \(\) => exitFromSignal\(signal\)\)/);
  assert.match(runnerSource, /terminateProcessTree\(activeDesktopChild\)/);
});

test('Desktop Tauri dev command rebuilds SDK dist before renderer loads dist aliases', () => {
  const sdkBuildIndex = runTauriDevSource.indexOf('buildSdkDistForDesktopDev();');
  const spawnIndex = runTauriDevSource.indexOf('const child = spawn(command, commandArgs');

  assert.ok(sdkBuildIndex > -1, 'dev command must build @nimiplatform/sdk dist');
  assert.ok(spawnIndex > sdkBuildIndex, 'SDK dist must be rebuilt before tauri dev starts');
  assert.match(runTauriDevSource, /'--filter', '@nimiplatform\/sdk', 'build'/);
  assert.match(runTauriDevSource, /process\.platform === 'win32' \? 'cmd\.exe' : pnpmBin/);
  assert.match(runTauriDevSource, /\['\/d', '\/s', '\/c', \[pnpmBin, \.\.\.pnpmArgs\]\.map\(quoteCmdArg\)\.join\(' '\)\]/);
  assert.doesNotMatch(runTauriDevSource, /spawnSync\(pnpmBin, \['--dir'/);
});

test('Desktop Tauri dev command tears down the Tauri process tree on Ctrl-C', () => {
  assert.match(runTauriDevSource, /function terminateProcessTree\(child\)/);
  assert.match(runTauriDevSource, /taskkill\.exe/);
  assert.match(runTauriDevSource, /let activeTauriChild = null/);
  assert.match(runTauriDevSource, /process\.on\(signal, \(\) => exitFromSignal\(signal\)\)/);
  assert.match(runTauriDevSource, /terminateProcessTree\(activeTauriChild\)/);
  assert.doesNotMatch(runTauriDevSource, /process\.kill\(process\.pid, signal\)/);
});
