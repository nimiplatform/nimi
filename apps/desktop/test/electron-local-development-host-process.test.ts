import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  assertLocalDevelopmentRendererOriginAvailable,
  probeLocalDevelopmentRenderer,
  resolveLocalDevelopmentPackageScriptInvocation,
  spawnPosixOwnerGuardedProcess,
  terminateLocalDevelopmentProcessTree,
} from '../src-electron/local-development-host-process.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Desktop local-development process ownership', () => {
  it('probes the rendered page after a same-origin framework locale redirect', async () => {
    const requests: string[] = [];
    const server = createHttpServer((request, response) => {
      requests.push(request.url!);
      if (request.url === '/') response.writeHead(307, { location: '/en/' }).end();
      else response.writeHead(200).end('<html>App</html>');
    });
    await listen(server, 0);
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try {
      assert.equal(await probeLocalDevelopmentRenderer(`http://127.0.0.1:${address.port}`), true);
      assert.deepEqual(requests, ['/', '/en/']);
    } finally {
      server.closeAllConnections();
      await close(server);
    }
  });

  it('does not probe a redirect outside the supervised renderer origin', async () => {
    let outsideRequests = 0;
    const outside = createHttpServer((_request, response) => {
      outsideRequests += 1;
      response.writeHead(200).end();
    });
    await listen(outside, 0);
    const outsideAddress = outside.address();
    assert.ok(outsideAddress && typeof outsideAddress !== 'string');
    const server = createHttpServer((_request, response) => {
      response.writeHead(302, { location: `http://127.0.0.1:${outsideAddress.port}/` }).end();
    });
    await listen(server, 0);
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try {
      assert.equal(await probeLocalDevelopmentRenderer(`http://127.0.0.1:${address.port}`), false);
      assert.equal(outsideRequests, 0);
    } finally {
      server.closeAllConnections();
      outside.closeAllConnections();
      await close(server);
      await close(outside);
    }
  });

  it('keeps a looping or failing redirected page unready', async () => {
    let loop = true;
    const server = createHttpServer((request, response) => {
      if (request.url === '/' || loop) response.writeHead(308, { location: '/en/' }).end();
      else response.writeHead(503).end();
    });
    await listen(server, 0);
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      assert.equal(await probeLocalDevelopmentRenderer(origin), false);
      loop = false;
      assert.equal(await probeLocalDevelopmentRenderer(origin), false);
    } finally {
      server.closeAllConnections();
      await close(server);
    }
  });

  it('rejects a renderer origin whose strict port is already occupied', async () => {
    const server = createServer();
    await listen(server, 0);
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try {
      await assert.rejects(
        assertLocalDevelopmentRendererOriginAvailable(`http://127.0.0.1:${address.port}`),
        /local-development-dev-server-port-in-use/u,
      );
    } finally {
      await close(server);
    }
    await assert.doesNotReject(
      assertLocalDevelopmentRendererOriginAvailable(`http://127.0.0.1:${address.port}`),
    );
  });

  it('uses the guarded Windows shell invocation expected by the renderer contract', () => {
    assert.deepEqual(resolveLocalDevelopmentPackageScriptInvocation('dev:renderer', 'win32'), {
      command: 'corepack.cmd pnpm run dev:renderer',
      args: [],
      shell: true,
    });
  });

  it('terminates the guarded process tree when the Desktop owner pipe closes', {
    skip: process.platform !== 'win32',
    timeout: 20_000,
  }, async (context) => {
    const port = await reservePort();
    const targetSource = [
      "const { createServer } = require('node:net');",
      `createServer().listen(${port}, '127.0.0.1');`,
      'setInterval(() => {}, 1000);',
    ].join('');
    const invocation = Buffer.from(JSON.stringify({
      command: process.execPath,
      args: ['-e', targetSource],
      shell: false,
    }), 'utf8').toString('base64url');
    const guardian = spawn(process.execPath, [
      path.join(appRoot, 'scripts', 'local-development-process-guardian.mjs'),
      invocation,
    ], {
      cwd: appRoot,
      detached: true,
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    context.after(() => {
      if (!guardian.pid || guardian.exitCode !== null) return;
      spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), [
        '/pid', String(guardian.pid), '/t', '/f',
      ], { windowsHide: true, stdio: 'ignore' });
    });

    await waitForPort(port, true);
    guardian.stdin.end();
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      guardian.once('error', reject);
      guardian.once('exit', resolve);
    });
    assert.equal(exitCode, 0);
    await waitForPort(port, false);
  });

  const posix = { skip: process.platform === 'win32', timeout: 20_000 };

  it('ends a POSIX tool process and its children when the Desktop owner pipe closes', posix, async (context) => {
    const port = await reservePort();
    const child = spawnPosixOwnerGuardedProcess(nodeTarget(port, { spawnChild: true }), appRoot, process.env);
    context.after(() => killGroup(child.pid));
    await waitForPort(port, true);
    const exited = exitOf(child);
    child.stdin.end();
    assert.deepEqual(await exited, { code: null, signal: 'SIGTERM' });
    await waitForPort(port, false);
    await waitForGroupGone(child.pid!, 8_000);
  });

  it('kills a POSIX tool process that ignores the stop request once the grace ends', posix, async (context) => {
    const port = await reservePort();
    const child = spawnPosixOwnerGuardedProcess(nodeTarget(port, { ignoreTerm: true }), appRoot, process.env);
    context.after(() => killGroup(child.pid));
    await waitForPort(port, true);
    const started = Date.now();
    const exited = exitOf(child);
    child.stdin.end();
    assert.deepEqual(await exited, { code: null, signal: 'SIGKILL' });
    assert.ok(Date.now() - started >= 4_000, 'the owner-loss grace is honoured before SIGKILL');
    await waitForGroupGone(child.pid!, 3_000);
  });

  it('keeps the POSIX target as the direct child so its own exit status is reported', posix, async () => {
    const child = spawnPosixOwnerGuardedProcess({ command: process.execPath, args: ['-e', 'process.exit(7)'] }, appRoot, process.env);
    assert.deepEqual(await exitOf(child), { code: 7, signal: null });
  });

  it('an ordinary Desktop stop still ends the POSIX target within the stop budget', posix, async (context) => {
    const port = await reservePort();
    const child = spawnPosixOwnerGuardedProcess(nodeTarget(port, {}), appRoot, process.env);
    context.after(() => killGroup(child.pid));
    await waitForPort(port, true);
    await terminateLocalDevelopmentProcessTree(child);
    await waitForPort(port, false);
    await waitForGroupGone(child.pid!, 8_000);
  });
});

function nodeTarget(port: number, options: { readonly ignoreTerm?: boolean; readonly spawnChild?: boolean }) {
  const source = [
    "const { createServer } = require('node:net');",
    options.ignoreTerm ? "process.on('SIGTERM', () => {});" : '',
    options.spawnChild ? "require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });" : '',
    `createServer().listen(${port}, '127.0.0.1');`,
    'setInterval(() => {}, 1000);',
  ].join('');
  return { command: process.execPath, args: ['-e', source] };
}

function exitOf(child: ReturnType<typeof spawn>): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function killGroup(pid: number | undefined): void {
  if (!pid) return;
  try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
}

async function waitForGroupGone(pgid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(-pgid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`process group ${pgid} still has members`);
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await listen(server, 0);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await close(server);
  return address.port;
}

async function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function waitForPort(port: number, expectedOpen: boolean): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await portOpen(port) === expectedOpen) return;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`port ${port} did not become ${expectedOpen ? 'open' : 'closed'}`);
}

async function portOpen(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
