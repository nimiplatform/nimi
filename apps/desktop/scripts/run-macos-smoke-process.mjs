import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { repoRoot, writeJson } from './run-macos-smoke-helpers.mjs';

export function applicationPath() {
  const bundleRoot = path.join(repoRoot, 'apps/desktop/src-tauri/target/release/bundle/macos');
  if (!fs.existsSync(bundleRoot)) {
    throw new Error(`desktop macOS app bundle not found: ${bundleRoot}`);
  }
  const appEntry = fs.readdirSync(bundleRoot, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.endsWith('.app'));
  if (!appEntry) {
    throw new Error(`desktop macOS app bundle is missing under ${bundleRoot}`);
  }
  const macOsDir = path.join(bundleRoot, appEntry.name, 'Contents', 'MacOS');
  const executable = fs.readdirSync(macOsDir, { withFileTypes: true })
    .find((entry) => entry.isFile());
  if (!executable) {
    throw new Error(`desktop macOS bundle executable is missing under ${macOsDir}`);
  }
  return path.join(macOsDir, executable.name);
}

export async function spawnLogged(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: { ...process.env, ...options.env },
      stdio: options.stdio || 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

export async function buildApplication() {
  await spawnLogged('pnpm', ['--filter', '@nimiplatform/desktop', 'run', 'prepare:runtime-bundle']);
  await spawnLogged('pnpm', [
    '--filter',
    '@nimiplatform/desktop',
    'exec',
    'tauri',
    'build',
    '--bundles',
    'app',
    '--no-sign',
  ]);
}

export function ensureSupportedPlatform() {
  if (os.platform() !== 'darwin') {
    throw new Error('desktop macOS smoke only supports darwin hosts');
  }
}

export function createLogFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return fs.createWriteStream(filePath, { flags: 'w' });
}

export function makeRunRoot() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const root = path.join(repoRoot, '.local', 'report', 'desktop-macos-smoke', runId);
  fs.mkdirSync(root, { recursive: true });
  return { runId, root };
}

export async function waitForFixtureHealth(origin, timeoutMs = 15000) {
  const url = new URL('/__fixture/health', origin).toString();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for fixture server ${url}`);
}

export async function waitForReport(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (raw.trim()) {
        return JSON.parse(raw);
      }
    } catch {
      // file not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for smoke report: ${filePath}`);
}

export async function waitForBackendLogPattern(filePath, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (pattern.test(raw)) {
        return raw;
      }
    } catch {
      // file not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for backend log pattern ${pattern}: ${filePath}`);
}

export function writeSyntheticFailureReport({
  smokeReportPath,
  scenarioId,
  scenarioManifestPath,
  failedStep,
  failurePhase,
  message,
  backendLogPath,
}) {
  const backendLogPresent = Boolean(backendLogPath && fs.existsSync(backendLogPath));
  writeJson(smokeReportPath, {
    generatedAt: new Date().toISOString(),
    ok: false,
    scenarioId,
    steps: [],
    failedStep,
    errorMessage: message,
    route: null,
    htmlSnapshotPath: null,
    fixtureManifestPath: scenarioManifestPath,
    failureSource: 'runner',
    failurePhase,
    backendLogPath: backendLogPath || null,
    backendLogPresent,
  });
}

export function runtimeLockPath() {
  return path.join(os.homedir(), '.nimi', 'runtime', 'runtime.lock');
}

export function readRuntimeLockPid() {
  try {
    const raw = fs.readFileSync(runtimeLockPath(), 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessAlive(pid);
}

export async function terminatePid(pid, label, timeoutMs = 5000) {
  if (!pid || !isProcessAlive(pid)) {
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  if (await waitForProcessExit(pid, timeoutMs)) {
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return;
  }
  await waitForProcessExit(pid, 1000);
  if (isProcessAlive(pid)) {
    process.stderr.write(`[desktop-macos-smoke] warning: ${label} pid ${pid} did not exit\n`);
  }
}

export async function terminateChildProcess(child, label) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const closed = new Promise((resolve) => {
    child.once('close', () => resolve(true));
    child.once('exit', () => resolve(true));
  });
  await terminatePid(child.pid, label);
  await Promise.race([
    closed,
    new Promise((resolve) => setTimeout(() => resolve(false), 1000)),
  ]);
}

export function closeWriteStream(stream) {
  return new Promise((resolve) => {
    if (!stream || stream.closed || stream.destroyed) {
      resolve();
      return;
    }
    stream.end(resolve);
  });
}

export function avatarInstanceIdFromReport(smokeReportPath) {
  try {
    const report = JSON.parse(fs.readFileSync(smokeReportPath, 'utf8'));
    return String(report?.details?.avatarProductPath?.liveInstance?.avatarInstanceId || '').trim();
  } catch {
    return '';
  }
}

export async function terminateAvatarProductResidue(smokeReportPath) {
  const avatarInstanceId = avatarInstanceIdFromReport(smokeReportPath);
  if (!avatarInstanceId) {
    return;
  }
  const result = spawnSync('pgrep', ['-f', avatarInstanceId], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return;
  }
  const pids = result.stdout
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid);
  for (const pid of pids) {
    await terminatePid(pid, `Avatar product smoke residue ${avatarInstanceId}`);
  }
}

export async function terminateRuntimeStartedByScenario(initialRuntimeLockPid) {
  const currentLockPid = readRuntimeLockPid();
  if (!currentLockPid || currentLockPid === initialRuntimeLockPid) {
    return;
  }
  await terminatePid(currentLockPid, 'Runtime product smoke residue');
  const remainingLockPid = readRuntimeLockPid();
  if (remainingLockPid === currentLockPid && !isProcessAlive(currentLockPid)) {
    try {
      fs.unlinkSync(runtimeLockPath());
    } catch {
      // Runtime may have removed the lock between the read and unlink.
    }
  }
}
