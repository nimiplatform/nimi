#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  requireWindowsDevSignedFiles,
  requireWindowsDevSigningIdentity,
} from '../../../scripts/lib/windows-dev-signing.mjs';
import {
  resolveDesktopDevObservationArguments,
  resolvePersistentDesktopDevProfile,
  resolveSignedDesktopDevCarrier,
} from './lib/electron-dev-carrier.mjs';

const require = createRequire(import.meta.url);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, '..');
const avatarRoot = path.resolve(appRoot, '../avatar');
const workspaceRoot = path.resolve(appRoot, '../..');
const sdkDistRoot = path.join(workspaceRoot, 'sdks', 'typescript', 'dist');
const rendererUrl = process.env.NIMI_DESKTOP_ELECTRON_RENDERER_URL || 'http://127.0.0.1:1420';
const bundledAvatarRendererUrl = process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_RENDERER_URL
  || 'http://127.0.0.1:1427';
const avatarOnly = process.argv.includes('--avatar-only');
const unknownArgument = process.argv.slice(2).find((value) => value !== '--avatar-only');
if (unknownArgument) throw new Error(`Unsupported Desktop Electron dev argument: ${unknownArgument}`);
const electronVersion = String(require('electron/package.json').version || '').trim();
const electronBin = resolveSignedDesktopDevCarrier({
  platform: process.platform,
  architecture: process.arch,
  electronVersion,
  workspaceRoot,
  existsSync,
});
const profileRoot = resolvePersistentDesktopDevProfile(workspaceRoot);
const localAssetRoot = path.join(profileRoot, 'local-assets');
const children = new Set();
const SIGNAL_EXIT_CODES = new Map([
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
]);
const REQUIRED_SDK_DIST_FILES = [
  'index.js',
  'runtime/index.js',
  'runtime/generated.js',
  'realm/index.js',
  'realm/generated.js',
  'types/index.js',
  'core/ai/index.js',
  'core/app/index.js',
  'core/contracts/index.js',
  'core/testing/index.js',
  'features/conversation/index.js',
  'features/knowledge-context/index.js',
  'features/memory-context/index.js',
  'features/generation/index.js',
  'features/workflow/index.js',
  'features/evaluation/index.js',
  'features/toolkits/index.js',
];

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
    ensureSdkDistForDesktopDev();
    const signingIdentity = requireWindowsDevSigningIdentity({ cwd: workspaceRoot });
    requireWindowsDevSignedFiles([electronBin], signingIdentity.certificateSha256, { cwd: workspaceRoot });
    mkdirSync(localAssetRoot, { recursive: true });
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
      ...resolveDesktopDevObservationArguments(),
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
      },
    });
    const exitCode = await waitForExit(electron);
    await requestAllChildrenShutdown('SIGTERM');
    process.exit(exitCode ?? 0);
  } catch (error) {
    await requestAllChildrenShutdown('SIGTERM');
    console.error(error instanceof Error ? error.message : String(error || 'Desktop Electron dev failed'));
    process.exit(1);
  }
}

async function runMacOSDesktopDev() {
  try {
    ensureSdkDistForDesktopDev();
    const electronBin = resolveSignedDesktopDevCarrier({
      platform: process.platform,
      architecture: process.arch,
      electronVersion,
      workspaceRoot,
      existsSync,
    });
    const macOSProfileRoot = path.join(workspaceRoot, '.nimi', 'local', 'dev-profiles', 'macos-desktop');
    mkdirSync(macOSProfileRoot, { recursive: true });
    spawnRenderer();
    await waitForUrl('http://127.0.0.1:1420', 45_000);
    const electron = spawnTracked(electronBin, [
      ...resolveDesktopDevObservationArguments(),
      `--user-data-dir=${macOSProfileRoot}`,
    ], {
      stdio: 'inherit',
      env: {
        HOME: process.env.HOME,
        LANG: process.env.LANG || 'en_US.UTF-8',
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        TMPDIR: process.env.TMPDIR || '/private/tmp',
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

function quoteCmdArg(value) {
  const raw = String(value);
  if (!/[\s"&|<>^]/.test(raw)) {
    return raw;
  }
  return `"${raw.replaceAll('"', '\\"')}"`;
}

function isSdkDistReadyForDesktopDev() {
  if (process.env.NIMI_DESKTOP_DEV_REBUILD_SDK === '1') {
    return false;
  }
  return REQUIRED_SDK_DIST_FILES.every((relativePath) =>
    existsSync(path.join(sdkDistRoot, ...relativePath.split('/'))));
}

function ensureSdkDistForDesktopDev() {
  if (isSdkDistReadyForDesktopDev()) {
    return;
  }
  const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const pnpmArgs = ['--dir', workspaceRoot, '--filter', '@nimiplatform/sdk', 'build'];
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
    throw new Error(`[run-electron-dev] failed to start SDK dist build: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`[run-electron-dev] SDK dist build failed with status ${result.status ?? 'unknown'}`);
  }
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
