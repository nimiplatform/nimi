import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  planRendererCommand,
  planRendererPortResolution,
} from '../scripts/dev-renderer-port-policy.mjs';

type RendererPortProcess = {
  pid: number;
  commandLine: string;
};

const desktopRoot = '/repo/apps/desktop';
const rendererPort = 1420;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const rendererRunnerSource = fs.readFileSync(
  path.join(root, 'scripts/ensure-dev-renderer-port.mjs'),
  'utf8',
);

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

test('dev:renderer delegates port ownership and Vite launch to one runner process', () => {
  const script = packageJson.scripts?.['dev:renderer'] || '';

  assert.match(script, /^node scripts\/ensure-dev-renderer-port\.mjs -- vite /);
  assert.doesNotMatch(script, /&&\s*vite/);
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

test('dev renderer runner lets Ctrl-C reach the delegated renderer before forced cleanup', () => {
  assert.match(rendererRunnerSource, /function requestRendererShutdown\(child, signal\)/);
  assert.match(rendererRunnerSource, /const signalForceKillGraceMs = 1500/);
  assert.match(rendererRunnerSource, /function forceKillRendererProcessTree\(child\)/);
  assert.match(rendererRunnerSource, /taskkill\.exe/);
  assert.match(rendererRunnerSource, /requestRendererShutdown\(activeRendererChild, signal\)/);
  assert.match(rendererRunnerSource, /if \(signal !== 'SIGINT'\)/);
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
