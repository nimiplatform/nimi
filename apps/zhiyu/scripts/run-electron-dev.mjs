import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, '..');
const rendererUrl = process.env.NIMI_ZHIYU_ELECTRON_RENDERER_URL || 'http://127.0.0.1:1472';
const viteBin = path.join(appRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const electronBin = require('electron');
const children = new Set();
const SIGNAL_EXIT_CODES = new Map([
  ['SIGINT', 130],
  ['SIGTERM', 143],
]);

for (const signal of SIGNAL_EXIT_CODES.keys()) {
  process.on(signal, () => shutdownFromSignal(signal));
}

try {
  ensureRendererPortAvailable();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error || 'Electron dev failed'));
  process.exit(1);
}

const renderer = spawnRenderer();

try {
  await waitForUrl(rendererUrl, 45_000);
  const electron = spawnTracked(electronBin, ['dist-electron/main.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NIMI_ZHIYU_ELECTRON_RENDERER_URL: rendererUrl,
    },
  });
  const exitCode = await waitForExit(electron);
  await requestAllChildrenShutdown('SIGTERM');
  process.exit(exitCode ?? 0);
} catch (error) {
  await requestAllChildrenShutdown('SIGTERM');
  console.error(error instanceof Error ? error.message : String(error || 'Electron dev failed'));
  process.exit(1);
}

function ensureRendererPortAvailable() {
  const result = spawnSync(process.execPath, ['scripts/ensure-dev-renderer-port.mjs'], {
    cwd: appRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`[run-electron-dev] failed to start renderer port preflight: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`[run-electron-dev] renderer port preflight failed with status ${result.status ?? 'unknown'}`);
  }
}

function spawnRenderer() {
  return spawnTracked(process.execPath, [
    viteBin,
    '--host',
    '127.0.0.1',
    '--port',
    '1472',
    '--strictPort',
  ], {
    stdio: 'inherit',
    env: process.env,
  });
}

function spawnTracked(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    cwd: appRoot,
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
    spawn('taskkill.exe', ['/pid', String(child.pid), '/t'], { stdio: 'ignore' });
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
    spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
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
  throw new Error(`Timed out waiting for zhiyu renderer at ${url}: ${lastError instanceof Error ? lastError.message : String(lastError || '')}`);
}
