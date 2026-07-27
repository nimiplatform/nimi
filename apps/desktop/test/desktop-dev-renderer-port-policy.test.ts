import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  planRendererCommand,
  planRendererPortResolution,
} from '../scripts/dev-renderer-port-policy.mjs';
import { probeRendererHealth } from '../scripts/dev-renderer-health.mjs';

type RendererPortProcess = {
  pid: number;
  commandLine: string;
};

const desktopRoot = '/repo/apps/desktop';
const rendererPort = 1420;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function processFixture(overrides: Partial<RendererPortProcess> = {}): RendererPortProcess {
  return {
    pid: 42,
    commandLine: `/usr/local/bin/node /repo/apps/desktop/node_modules/.bin/vite --host 127.0.0.1 --port ${rendererPort} --strictPort`,
    ...overrides,
  };
}

test('healthy desktop renderer on the dev port is reused instead of killed', () => {
  const plan = planRendererPortResolution({
    desktopRoot,
    rendererPort,
    processes: [processFixture()],
    isRendererReachable: true,
  });

  assert.equal(plan.action, 'reuse');
  assert.deepEqual(plan.pidsToStop, []);
});

test('healthy Windows desktop renderer with quoted CLI arguments is reused', () => {
  const windowsDesktopRoot = 'D:\\workspace\\nimi\\apps\\desktop';
  const plan = planRendererPortResolution({
    desktopRoot: windowsDesktopRoot,
    rendererPort,
    processes: [processFixture({
      commandLine: 'node "D:\\workspace\\nimi\\apps\\desktop\\node_modules\\vite\\bin\\vite.js" '
        + '"--host" "127.0.0.1" "--port" "1420" "--strictPort"',
    })],
    isRendererReachable: true,
  });

  assert.equal(plan.action, 'reuse');
  assert.deepEqual(plan.pidsToStop, []);
});

test('unresponsive desktop renderer on the dev port is stopped before restart', () => {
  const plan = planRendererPortResolution({
    desktopRoot,
    rendererPort,
    processes: [processFixture()],
    isRendererReachable: false,
  });

  assert.equal(plan.action, 'restart');
  assert.deepEqual(plan.pidsToStop, [42]);
});

test('renderer health probe requires a successful transformed entry module', async () => {
  const requests: string[] = [];
  const healthy = await probeRendererHealth({
    baseUrl: 'http://127.0.0.1:1420',
    cacheKey: 'test',
    fetchImpl: async (url: string) => {
      requests.push(url);
      if (url.endsWith('/')) {
        return new Response('<!doctype html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response('export {};', {
        status: 200,
        headers: { 'content-type': 'text/javascript' },
      });
    },
  });

  assert.equal(healthy, true);
  assert.deepEqual(requests, [
    'http://127.0.0.1:1420/',
    'http://127.0.0.1:1420/main.tsx?nimi-renderer-health=test',
  ]);
});

test('renderer health probe rejects a root-only server with a dead transform worker', async () => {
  const healthy = await probeRendererHealth({
    baseUrl: 'http://127.0.0.1:1420',
    cacheKey: 'test',
    fetchImpl: async (url: string) => new Response(
      url.endsWith('/') ? '<!doctype html>' : 'The service is no longer running',
      {
        status: url.endsWith('/') ? 200 : 500,
        headers: { 'content-type': url.endsWith('/') ? 'text/html' : 'text/plain' },
      },
    ),
  });

  assert.equal(healthy, false);
});

test('renderer health probe rejects an HTML fallback for the entry path', async () => {
  const healthy = await probeRendererHealth({
    baseUrl: 'http://127.0.0.1:1420',
    cacheKey: 'test',
    fetchImpl: async () => new Response('<!doctype html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  });

  assert.equal(healthy, false);
});

test('non-desktop process on the dev port fails closed', () => {
  const plan = planRendererPortResolution({
    desktopRoot,
    rendererPort,
    processes: [processFixture({
      commandLine: '/usr/bin/python -m http.server 1420',
    })],
    isRendererReachable: true,
  });

  assert.equal(plan.action, 'fail');
  assert.match(plan.message, /not a recognized desktop renderer process/);
  assert.deepEqual(plan.pidsToStop, []);
});

test('dev renderer runner wraps delegated commands through cmd.exe on Windows', () => {
  const plan = planRendererCommand('vite', ['--host', '127.0.0.1', '--port', '1420'], {
    platform: 'win32',
  });

  assert.equal(plan.command, 'cmd.exe');
  assert.deepEqual(plan.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(plan.args[3], 'vite --host 127.0.0.1 --port 1420');
});

test('dev renderer runner keeps delegated commands direct on POSIX', () => {
  const plan = planRendererCommand('vite', ['--host', '127.0.0.1', '--port', '1420'], {
    platform: 'darwin',
  });

  assert.deepEqual(plan, {
    command: 'vite',
    args: ['--host', '127.0.0.1', '--port', '1420'],
  });
});

test('dev renderer runner treats SIGTERM as a successful Tauri handoff shutdown', {
  skip: process.platform === 'win32'
    ? 'Node child.kill(SIGTERM) terminates Windows child processes instead of delivering a JS signal handler.'
    : false,
}, async () => {
  const runner = spawn(process.execPath, [
    path.join(root, 'scripts/ensure-dev-renderer-port.mjs'),
    '--',
    process.execPath,
    '-e',
    'setInterval(() => undefined, 1000)',
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  runner.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  runner.stderr.on('data', (chunk) => {
    output += String(chunk);
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`runner did not enter dev renderer port policy path: ${output}`));
    }, 3000);
    const onData = () => {
      if (output.includes('[dev-renderer-port]')) {
        clearTimeout(timeout);
        runner.stdout.off('data', onData);
        runner.stderr.off('data', onData);
        resolve();
      }
    };
    runner.stdout.on('data', onData);
    runner.stderr.on('data', onData);
    onData();
    runner.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`runner exited before SIGTERM test: code=${String(code)} signal=${String(signal)} output=${output}`));
    });
  });

  runner.kill('SIGTERM');

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    runner.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });

  assert.deepEqual(exit, { code: 0, signal: null });
});
