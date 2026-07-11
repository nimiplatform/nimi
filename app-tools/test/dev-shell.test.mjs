import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runDevShell } from '../scripts/dev-shell.mjs';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-dev-shell-'));
  const project = path.join(root, 'project');
  const descriptorPath = path.join(root, 'presence.v1.json');
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, 'nimi.app.yaml'), 'app_id: acme.widget\n');
  writeFileSync(descriptorPath, `${JSON.stringify({
    schemaVersion: 1,
    desktopAppId: 'nimi.desktop',
    desktopPid: process.pid,
    endpoint: 'http://127.0.0.1:49111',
    startedAt: '2026-07-12T00:00:00.000Z',
    lastHeartbeatAt: '2026-07-12T00:00:01.000Z',
  }, null, 2)}\n`);
  return { root, project, descriptorPath };
}

function response(payload) {
  return { status: 200, async json() { return payload; } };
}

function runStatus(state = 'running') {
  return {
    schemaVersion: 1,
    runId: 'dev-run-public-selector',
    state,
    appId: 'acme.widget',
    displayName: 'Acme Widget',
    canonicalProjectRoot: 'C:\\project',
    shell: 'electron',
    rendererOrigin: 'http://127.0.0.1:1466',
    message: state === 'running' ? 'Supervised electron host is running' : 'Development run stopped',
    retryable: state === 'runtime-unavailable',
    hostGeneration: state === 'running' ? 1 : 0,
    logSequence: 0,
    logs: [],
  };
}

test('official dev launcher sends only project intent and keeps technical material out of the CLI', {
  skip: process.platform !== 'win32',
}, async () => {
  const input = fixture();
  const requests = [];
  const controller = new AbortController();
  controller.abort();
  try {
    const fetch = async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      if (url.endsWith('/v1/start')) return response({ status: 'ok', run: runStatus() });
      if (url.endsWith('/v1/cancel')) return response({ status: 'ok', run: runStatus('stopped') });
      throw new Error(`unexpected route: ${url}`);
    };
    await runDevShell(input.project, {
      shell: 'electron',
      descriptorPath: input.descriptorPath,
      now: () => Date.parse('2026-07-12T00:00:02.000Z'),
      fetch,
      signal: controller.signal,
      installSignalHandlers: false,
      output: { write() {} },
      errorOutput: { write() {} },
    });
    assert.deepEqual(requests[0].body, {
      schemaVersion: 1,
      appId: 'acme.widget',
      projectRoot: await import('node:fs/promises').then(({ realpath }) => realpath(input.project)),
      shell: 'electron',
    });
    assert.deepEqual(Object.keys(requests[0].init.headers), ['Content-Type']);
    assert.equal(JSON.stringify(requests).match(/token|ticket|session|credential|runtimeEndpoint/gi), null);
    assert.equal(requests.at(-1).url.endsWith('/v1/cancel'), true);
  } finally {
    rmSync(input.root, { recursive: true, force: true });
  }
});

test('official dev launcher stays attached while Desktop recovers a Runtime restart', {
  skip: process.platform !== 'win32',
}, async () => {
  const input = fixture();
  const controller = new AbortController();
  let statusRequests = 0;
  try {
    const fetch = async (url) => {
      if (url.endsWith('/v1/start')) {
        return response({
          status: 'ok',
          run: {
            ...runStatus('runtime-unavailable'),
            reasonCode: 'runtime-service-unavailable',
            message: 'Runtime is restarting',
          },
        });
      }
      if (url.endsWith('/v1/status')) {
        statusRequests += 1;
        controller.abort();
        return response({ status: 'ok', run: runStatus('running') });
      }
      if (url.endsWith('/v1/cancel')) return response({ status: 'ok', run: runStatus('stopped') });
      throw new Error(`unexpected route: ${url}`);
    };
    await runDevShell(input.project, {
      shell: 'electron',
      descriptorPath: input.descriptorPath,
      now: () => Date.parse('2026-07-12T00:00:02.000Z'),
      fetch,
      signal: controller.signal,
      installSignalHandlers: false,
      output: { write() {} },
      errorOutput: { write() {} },
    });
    assert.equal(statusRequests, 1);
  } finally {
    rmSync(input.root, { recursive: true, force: true });
  }
});

test('official dev launcher rejects stale or non-loopback Desktop presence before any request', {
  skip: process.platform !== 'win32',
}, async () => {
  const input = fixture();
  let called = false;
  try {
    await assert.rejects(
      runDevShell(input.project, {
        shell: 'tauri',
        descriptorPath: input.descriptorPath,
        now: () => Date.parse('2026-07-12T00:01:00.000Z'),
        fetch: async () => { called = true; },
        installSignalHandlers: false,
      }),
      (error) => error?.reasonCode === 'local-development-desktop-not-running',
    );
    assert.equal(called, false);
  } finally {
    rmSync(input.root, { recursive: true, force: true });
  }
});
