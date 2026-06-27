import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const runTauriDevSource = fs.readFileSync(
  path.join(root, 'scripts/run-tauri-dev.mjs'),
  'utf8',
);
const tauriDevRunnerSource = fs.readFileSync(
  path.join(root, 'scripts/tauri-dev-runner.mjs'),
  'utf8',
);

test('tester renderer dev command only owns the Vite long-running process', () => {
  assert.equal(
    packageJson.scripts['dev:renderer'],
    'vite --host 127.0.0.1 --port 1468 --strictPort',
  );
});

test('tester Tauri dev command performs renderer port preflight before Tauri supervises beforeDevCommand', () => {
  const preflightIndex = runTauriDevSource.indexOf('ensureRendererPortAvailable();');
  const spawnIndex = runTauriDevSource.indexOf('const child = spawn(command, commandArgs');

  assert.ok(preflightIndex > -1, 'dev command must run renderer port preflight');
  assert.ok(spawnIndex > preflightIndex, 'renderer port preflight must finish before Tauri starts');
  assert.match(runTauriDevSource, /process\.execPath, \['scripts\/ensure-dev-renderer-port\.mjs'\]/);
});

test('tester Tauri dev command does not self-signal when the Tauri child exits', () => {
  assert.match(runTauriDevSource, /const SIGNAL_EXIT_CODES = new Map/);
  assert.match(runTauriDevSource, /let activeTauriChild = null/);
  assert.match(runTauriDevSource, /function terminateProcessTree\(child\)/);
  assert.match(runTauriDevSource, /process\.on\(signal, \(\) => exitFromSignal\(signal\)\)/);
  assert.doesNotMatch(runTauriDevSource, /process\.kill\(process\.pid, signal\)/);
});

test('tester Windows Tauri dev runner stops stale shell binary before Cargo rebuilds it', () => {
  const splitIndex = tauriDevRunnerSource.indexOf('const { cargoArgs, appArgs } = splitRunArgs(rawArgs.slice(1));');
  const resolveIndex = tauriDevRunnerSource.indexOf('const binaryPath = resolveAppBinary(cargoArgs);');
  const stopIndex = tauriDevRunnerSource.indexOf('stopExistingWindowsDevBinary(binaryPath);');
  const buildIndex = tauriDevRunnerSource.indexOf("const buildArgs = ['build', '--quiet', ...cargoArgs];");
  const spawnIndex = tauriDevRunnerSource.indexOf('spawnAppBinary(binaryPath, appArgs);');

  assert.ok(splitIndex > -1, 'runner must split Cargo args before resolving the app binary path');
  assert.ok(resolveIndex > splitIndex, 'runner must resolve the tester shell binary path before cleanup');
  assert.ok(stopIndex > resolveIndex, 'runner must stop the resolved tester shell binary');
  assert.ok(buildIndex > stopIndex, 'stale shell cleanup must run before cargo build');
  assert.ok(spawnIndex > buildIndex, 'runner must launch after rebuild without a signing step');
  assert.match(tauriDevRunnerSource, /Get-CimInstance Win32_Process -Filter "Name = '\$BinaryName'"/);
  assert.match(tauriDevRunnerSource, /ExecutablePath[\s\S]*GetFullPath\(\$_.ExecutablePath\)[\s\S]*-ieq \$BinaryPath/);
});

test('tester Windows Tauri dev runner suppresses PowerShell progress during stale shell cleanup', () => {
  const stopStart = tauriDevRunnerSource.indexOf('function stopExistingWindowsDevBinary(binaryPath)');
  const nextFunctionStart = tauriDevRunnerSource.indexOf('function signWindowsDevBinary(binaryPath)');
  const executionStart = tauriDevRunnerSource.indexOf('const rawArgs = process.argv.slice(2);');
  const stopEnd = nextFunctionStart > -1 ? nextFunctionStart : executionStart;

  assert.ok(stopStart > -1, 'runner must define stale shell cleanup');
  assert.ok(stopEnd > stopStart, 'runner cleanup block must appear before execution starts');
  const stopBlock = tauriDevRunnerSource.slice(stopStart, stopEnd);
  assert.match(stopBlock, /\$ProgressPreference = 'SilentlyContinue'/);
});

test('tester Windows Tauri dev runner does not require local code signing by default', () => {
  assert.doesNotMatch(tauriDevRunnerSource, /signWindowsDevBinary/);
  assert.doesNotMatch(tauriDevRunnerSource, /Set-AuthenticodeSignature/);
  assert.doesNotMatch(tauriDevRunnerSource, /New-SelfSignedCertificate/);
  assert.doesNotMatch(tauriDevRunnerSource, /Get-ChildItem Cert:/);
  assert.doesNotMatch(tauriDevRunnerSource, /TrustedPublisher/);
  assert.doesNotMatch(tauriDevRunnerSource, /certutil\.exe/);
});
