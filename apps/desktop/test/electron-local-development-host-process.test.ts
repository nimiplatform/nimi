import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  assertLocalDevelopmentRendererOriginAvailable,
  resolveLocalDevelopmentPackageScriptInvocation,
} from '../src-electron/local-development-host-process.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Desktop local-development process ownership', () => {
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
});

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
