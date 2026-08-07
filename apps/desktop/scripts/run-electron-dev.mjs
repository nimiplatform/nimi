#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWorkspaceSurfaceFreshness } from '../../../scripts/lib/dev-workspace-surfaces.mjs';
import {
  resolveDesktopDevLaunchOptions,
  resolvePersistentDesktopDevProfile,
  resolveWorkspaceElectronDevCarrier,
} from './lib/electron-dev-carrier.mjs';
import { acquireDesktopDevSessionLock } from './lib/electron-dev-session-lock.mjs';

const require = createRequire(import.meta.url);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, '..');
const avatarRoot = path.resolve(appRoot, '../avatar');
const workspaceRoot = path.resolve(appRoot, '../..');
const macOSSourceLocalDevelopmentRuntime = path.join(workspaceRoot, '.nimi', 'local', 'imp3', 'runtime-local-development', 'nimi-runtime');
const windowsSourceLocalDevelopmentRuntime = path.join(workspaceRoot, '.nimi', 'local', 'imp6', 'runtime-local-development', 'nimi.exe');
const macOSSourceLocalDevelopmentNativeEntry = path.join(
  workspaceRoot,
  'kit',
  'shell',
  'protected-local-node',
  'npm',
  'darwin-arm64',
  'index.cjs',
);
const windowsSourceLocalDevelopmentNativeEntry = path.join(
  workspaceRoot,
  'kit',
  'shell',
  'protected-local-node',
  'npm',
  'win32-x64',
  'index.cjs',
);
const sourceLocalDevelopmentRealmUrl = ['darwin', 'win32'].includes(process.platform)
  ? resolveSourceLocalDevelopmentRealmUrl(workspaceRoot)
  : '';
const rendererUrl = process.env.NIMI_DESKTOP_ELECTRON_RENDERER_URL || 'http://127.0.0.1:1420';
const bundledAvatarRendererUrl = process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_RENDERER_URL
  || 'http://127.0.0.1:1427';
const {
  avatarOnly,
  observationArguments: desktopDevObservationArguments,
} = resolveDesktopDevLaunchOptions(process.argv.slice(2));
const profileRoot = resolvePersistentDesktopDevProfile(workspaceRoot);
let desktopDevSession;
if (process.platform === 'win32') {
  try {
    desktopDevSession = await acquireDesktopDevSessionLock(profileRoot);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error || 'Desktop Electron dev session lock failed'));
    process.exit(1);
  }
}
const localAssetRoot = path.join(profileRoot, 'local-assets');
const children = new Set();
let shuttingDown = false;
const SIGNAL_EXIT_CODES = new Map([
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
]);
for (const signal of SIGNAL_EXIT_CODES.keys()) {
  process.on(signal, () => {
    void shutdownFromSignal(signal);
  });
}

if (process.platform === 'darwin') {
  await runMacOSDesktopDev();
} else {
  await runWindowsDesktopDev();
}

async function runWindowsDesktopDev() {
  try {
    process.env.NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT = '1';
    const workspaceSurfaceWatcher = spawnWorkspaceSurfaceWatcher();
    buildWindowsSourceLocalDevelopmentRuntime();
    await waitForWorkspaceSurfaces(workspaceSurfaceWatcher, 180_000);
    await buildElectronHostForDesktopDev();
    const electronBin = resolveWorkspaceElectronDevCarrier({
      platform: process.platform,
      architecture: process.arch,
      electronExecutable: require('electron'),
      existsSync,
    });
    mkdirSync(localAssetRoot, { recursive: true });
    process.stdout.write(`${JSON.stringify({
      status: 'starting',
      carrier: electronBin,
      hostBundle: 'workspace-electron',
      rendererUrl,
      mainIteration: 'workspace_build',
      protectedRuntime: 'source-local-development',
    })}\n`);
    if (!avatarOnly) {
      spawnRenderer();
      await waitForUrl(rendererUrl, 45_000);
    }
    const avatarAgentId = String(
      process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_AGENT_ID
      || process.env.NIMI_AVATAR_AGENT_ID
      || '',
    ).trim();
    if (avatarOnly && !avatarAgentId.startsWith('local-agent:')) {
      throw new Error('Avatar-only Electron dev requires NIMI_AVATAR_AGENT_ID with a Runtime local-agent ref.');
    }
    const electron = spawnTracked(electronBin, [
      ...desktopDevObservationArguments,
      `--user-data-dir=${profileRoot}`,
      'dist-electron/main.js',
    ], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NIMI_DESKTOP_ELECTRON_RENDERER_URL: rendererUrl,
        NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_RENDERER_URL: bundledAvatarRendererUrl,
        NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_DEV_ROOT: avatarRoot,
        NIMI_DESKTOP_ELECTRON_AVATAR_ONLY: avatarOnly ? '1' : '0',
        NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_AGENT_ID: avatarAgentId,
        NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_INSTANCE_ID:
          process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_INSTANCE_ID || '',
        NIMI_DESKTOP_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS: localAssetRoot,
        NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT: '1',
        NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE: windowsSourceLocalDevelopmentRuntime,
        NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_DESKTOP_EXECUTABLE: electronBin,
        NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_NATIVE_ENTRY: windowsSourceLocalDevelopmentNativeEntry,
        NIMI_REALM_URL: sourceLocalDevelopmentRealmUrl,
      },
    });
    const exitCode = await waitForExit(electron);
    await requestAllChildrenShutdown('SIGTERM');
    process.exit(exitCode ?? 0);
  } catch (error) {
    await requestAllChildrenShutdown('SIGTERM');
    const reasonCode = error && typeof error === 'object' && 'reasonCode' in error
      ? String(error.reasonCode)
      : 'desktop-dev-launch-failed';
    process.stderr.write(`${JSON.stringify({
      status: 'failed',
      reasonCode,
      actionHint: error && typeof error === 'object' && 'actionHint' in error ? String(error.actionHint) : 'inspect_desktop_dev_launch',
      message: error instanceof Error ? error.message : String(error || 'Desktop Electron dev failed'),
    })}\n`);
    process.exit(1);
  }
}

async function runMacOSDesktopDev() {
  try {
    process.env.NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT = '1';
    const workspaceSurfaceWatcher = spawnWorkspaceSurfaceWatcher();
    buildMacOSSourceLocalDevelopmentRuntime();
    await waitForWorkspaceSurfaces(workspaceSurfaceWatcher, 180_000);
    await buildElectronHostForDesktopDev();
    const electronBin = resolveWorkspaceElectronDevCarrier({
      platform: process.platform,
      architecture: process.arch,
      electronExecutable: require('electron'),
      existsSync,
    });
    const macOSProfileRoot = path.join(workspaceRoot, '.nimi', 'local', 'dev-profiles', 'macos-desktop');
    mkdirSync(macOSProfileRoot, { recursive: true });
    mkdirSync(localAssetRoot, { recursive: true });
    process.stdout.write(`${JSON.stringify({
      status: 'starting',
      carrier: electronBin,
      hostBundle: 'workspace-electron',
      rendererUrl,
      mainIteration: 'workspace_build',
      protectedRuntime: 'source-local-development',
    })}\n`);
    spawnRenderer();
    await waitForUrl(rendererUrl, 45_000);
    const electron = spawnTracked(electronBin, [
      ...desktopDevObservationArguments,
      `--user-data-dir=${macOSProfileRoot}`,
      'dist-electron/main.js',
    ], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NIMI_DESKTOP_ELECTRON_RENDERER_URL: rendererUrl,
        NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_RENDERER_URL: bundledAvatarRendererUrl,
        NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_DEV_ROOT: avatarRoot,
        NIMI_DESKTOP_ELECTRON_AVATAR_ONLY: avatarOnly ? '1' : '0',
        NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_AGENT_ID:
          process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_AGENT_ID
          || process.env.NIMI_AVATAR_AGENT_ID
          || '',
        NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_INSTANCE_ID:
          process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_INSTANCE_ID || '',
        NIMI_DESKTOP_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS: localAssetRoot,
        NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT: '1',
        NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE: macOSSourceLocalDevelopmentRuntime,
        NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_HOST_EXECUTABLE: electronBin,
        NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_NATIVE_ENTRY: macOSSourceLocalDevelopmentNativeEntry,
        NIMI_REALM_URL: sourceLocalDevelopmentRealmUrl,
      },
    });
    const exitCode = await waitForExit(electron);
    await requestAllChildrenShutdown('SIGTERM');
    process.exit(exitCode ?? 0);
  } catch (error) {
    await requestAllChildrenShutdown('SIGTERM');
    const reasonCode = error && typeof error === 'object' && 'reasonCode' in error
      ? String(error.reasonCode)
      : 'desktop-dev-launch-failed';
    process.stderr.write(`${JSON.stringify({
      status: 'failed',
      reasonCode,
      actionHint: error && typeof error === 'object' && 'actionHint' in error ? String(error.actionHint) : 'inspect_desktop_dev_launch',
      message: error instanceof Error ? error.message : String(error || 'Desktop Electron dev failed'),
    })}\n`);
    process.exit(1);
  }
}

function resolveSourceLocalDevelopmentRealmUrl(root) {
  const fallback = 'http://127.0.0.1:3002';
  const sourcePath = path.join(root, '.env');
  let raw = '';
  if (existsSync(sourcePath)) {
    const declarations = readFileSync(sourcePath, 'utf8')
      .split(/\r?\n/u)
      .map((line) => line.match(/^NIMI_REALM_URL=(.*)$/u))
      .filter(Boolean);
    if (declarations.length > 1) {
      throw Object.assign(new Error('source local development Realm URL is declared more than once'), {
        reasonCode: 'source-local-development-realm-url-invalid',
      });
    }
    raw = declarations[0]?.[1] ?? '';
  }
  if (!raw) return fallback;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw Object.assign(new Error('source local development Realm URL is invalid'), {
      reasonCode: 'source-local-development-realm-url-invalid',
    });
  }
  if (parsed.protocol !== 'http:'
    || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || parsed.port !== '3002'
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash) {
    throw Object.assign(new Error('source local development Realm URL must be local loopback HTTP on port 3002'), {
      reasonCode: 'source-local-development-realm-url-invalid',
    });
  }
  return fallback;
}

function buildWindowsSourceLocalDevelopmentRuntime() {
  const runtimeRoot = path.join(workspaceRoot, 'runtime');
  mkdirSync(path.dirname(windowsSourceLocalDevelopmentRuntime), { recursive: true });
  const build = spawnSync('go', [
    'build',
    '-tags',
    'nimi_windows_source_local_development',
    '-o',
    windowsSourceLocalDevelopmentRuntime,
    './cmd/nimi',
  ], {
    cwd: runtimeRoot,
    env: { ...process.env, CGO_ENABLED: '0' },
    stdio: 'inherit',
  });
  if (build.status !== 0) {
    throw new Error(`source local development Runtime build failed with status ${build.status ?? 'unknown'}`);
  }
}

function buildMacOSSourceLocalDevelopmentRuntime() {
  const runtimeRoot = path.join(workspaceRoot, 'runtime');
  mkdirSync(path.dirname(macOSSourceLocalDevelopmentRuntime), { recursive: true, mode: 0o700 });
  const build = spawnSync('go', [
    'build',
    '-tags',
    'nimi_macos_source_local_development',
    '-o',
    macOSSourceLocalDevelopmentRuntime,
    './cmd/nimi',
  ], {
    cwd: runtimeRoot,
    env: { ...process.env, CGO_ENABLED: '1' },
    stdio: 'inherit',
  });
  if (build.status !== 0) {
    throw new Error(`source local development Runtime build failed with status ${build.status ?? 'unknown'}`);
  }
}

function quoteCmdArg(value) {
  const raw = String(value);
  if (!/[\s"&|<>^]/.test(raw)) {
    return raw;
  }
  return `"${raw.replaceAll('"', '\\"')}"`;
}

async function buildElectronHostForDesktopDev() {
  const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const pnpmArgs = ['--dir', appRoot, 'run', 'build:electron:prepared'];
  const buildCommand = process.platform === 'win32' ? 'cmd.exe' : pnpmBin;
  const buildArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', [pnpmBin, ...pnpmArgs].map(quoteCmdArg).join(' ')]
    : pnpmArgs;
  const result = spawnSync(buildCommand, buildArgs, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`[run-electron-dev] failed to build Electron host: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`[run-electron-dev] Electron host build failed with status ${result.status ?? 'unknown'}`);
  }
}

function spawnWorkspaceSurfaceWatcher() {
  let launchError;
  let ready = false;
  const child = spawnTracked(process.execPath, [
    path.join(workspaceRoot, 'scripts', 'dev-prepare-watch.mjs'),
  ], {
    cwd: workspaceRoot,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: process.env,
  });
  child.once('error', (error) => {
    launchError = error;
  });
  child.on('message', (message) => {
    if (message?.schemaVersion === 1 && message?.type === 'nimi-dev-workspace-surfaces-ready') {
      ready = true;
    }
  });
  child.once('exit', (code, signal) => {
    if (shuttingDown || !ready) return;
    process.stderr.write(
      `[run-electron-dev] SDK/Kit watcher exited unexpectedly (${code ?? signal ?? 'unknown'})\n`,
    );
    void requestAllChildrenShutdown('SIGTERM').then(() => process.exit(1));
  });
  return { child, launchError: () => launchError, ready: () => ready };
}

async function waitForWorkspaceSurfaces(watcher, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let diagnostics = [];
  while (Date.now() < deadline) {
    const launchError = watcher.launchError();
    if (launchError) {
      throw new Error(`[run-electron-dev] failed to start SDK/Kit watcher: ${launchError.message}`);
    }
    if (watcher.child.exitCode !== null) {
      throw new Error(
        `[run-electron-dev] SDK/Kit watcher exited before readiness with status ${watcher.child.exitCode}`,
      );
    }
    const freshness = await inspectWorkspaceSurfaceFreshness(workspaceRoot);
    diagnostics = freshness.diagnostics;
    if (watcher.ready() && freshness.fresh) {
      process.stdout.write('[run-electron-dev] Desktop owns fresh SDK/Kit dist and source watching\n');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `[run-electron-dev] timed out waiting for Desktop-owned SDK/Kit dist (${diagnostics.join(', ')})`,
  );
}

function spawnRenderer() {
  return spawnTracked(process.execPath, [
    'scripts/ensure-dev-renderer-port.mjs',
    '--',
    'vite',
    '--host',
    '127.0.0.1',
    '--port',
    '1420',
    '--strictPort',
  ], {
    stdio: 'inherit',
    env: process.env,
  });
}

function spawnTracked(command, args, options) {
  const { cwd = appRoot, ...spawnOptions } = options;
  const child = spawn(command, args, {
    ...spawnOptions,
    cwd,
  });
  children.add(child);
  child.once('exit', () => {
    children.delete(child);
  });
  return child;
}

async function shutdownFromSignal(signal) {
  await requestAllChildrenShutdown(signal);
  process.exit(SIGNAL_EXIT_CODES.get(signal) ?? 1);
}

async function requestAllChildrenShutdown(signal) {
  shuttingDown = true;
  await Promise.all([...children].map((child) => requestProcessTreeShutdown(child, signal)));
}

async function requestProcessTreeShutdown(child, signal) {
  if (!child?.pid || child.exitCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/pid', String(child.pid), '/t'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill(signal);
  }
  const stopped = await waitForExitOrTimeout(child, 2_000);
  if (!stopped) {
    forceKillProcessTree(child);
    await waitForExitOrTimeout(child, 1_000);
  }
}

function forceKillProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  child.kill('SIGKILL');
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
  });
}

function waitForExitOrTimeout(child, timeoutMs) {
  if (child.exitCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off('exit', onExit);
    };
    child.once('exit', onExit);
  });
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) {
        return;
      }
      lastError = new Error(`renderer responded ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for desktop renderer at ${url}: ${lastError instanceof Error ? lastError.message : String(lastError || '')}`);
}
