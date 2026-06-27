import { spawn } from 'node:child_process';

const rendererUrl = process.env.NIMI_TESTER_ELECTRON_RENDERER_URL || 'http://127.0.0.1:1468';

const renderer = spawnPnpm(['run', 'dev:renderer'], {
  stdio: 'inherit',
  env: process.env,
});

try {
  await waitForUrl(rendererUrl, 45_000);
  const electron = spawnPnpm(['exec', 'electron', 'dist-electron/main.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NIMI_TESTER_ELECTRON_RENDERER_URL: rendererUrl,
    },
  });
  const exitCode = await waitForExit(electron);
  renderer.kill();
  process.exit(exitCode ?? 0);
} catch (error) {
  renderer.kill();
  console.error(error instanceof Error ? error.message : String(error || 'Electron dev failed'));
  process.exit(1);
}

function spawnPnpm(args, options) {
  if (process.platform === 'win32') {
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'corepack.cmd', 'pnpm', ...args], options);
  }
  return spawn('corepack', ['pnpm', ...args], options);
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
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
  throw new Error(`Timed out waiting for tester renderer at ${url}: ${lastError instanceof Error ? lastError.message : String(lastError || '')}`);
}
