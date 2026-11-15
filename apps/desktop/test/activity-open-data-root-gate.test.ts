import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { registerNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/main';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { createDesktopDataRootOperationGate } from '../src-electron/data-root-operation-gate.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test('an activity source starts after queued maintenance without waiting for its own Open', async () => {
  const gate = createDesktopDataRootOperationGate();
  const occupied = deferred<void>();
  const reading = gate.runShared(() => occupied.promise);
  const opening = deferred<void>();
  const resolveSource = deferred<void>();
  const canceled = deferred<never>();
  const order: string[] = [];
  type IpcMain = Parameters<typeof registerNimiElectronRuntimeBridge>[0]['ipcMain'];
  type Handler = Parameters<IpcMain['handle']>[1];
  const handlers = new Map<string, Handler>();
  const ipcMain: IpcMain = {
    handle: (channel, handler) => { handlers.set(channel, handler); },
    removeHandler: channel => { handlers.delete(channel); },
  };
  const bridge = registerNimiElectronRuntimeBridge({
    appId: 'acme.widget', runtimeEndpoint: '127.0.0.1:46371',
    allowedOrigins: ['http://localhost:1430'], ipcMain,
    createGrpcClient: async () => { throw new Error('Unexpected Runtime transport'); },
    standardShellHost: {
      allowAllStandardShellCommands: true,
      runDataRootOperation: operation => gate.runShared(operation),
      localAppHost: {
        activityOpen: async () => {
          opening.resolve(undefined);
          return Promise.race([canceled.promise, (async () => {
            await resolveSource.promise;
            await gate.runShared(async () => { order.push('source-started'); });
            return { outcome: 'opened', reason: 'opened' };
          })()]);
        },
      } as never,
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const event = { senderFrame: { origin: 'http://localhost:1430' }, sender: Object.assign(new EventEmitter(), { id: 1, send() {} }) };
  const result = Promise.resolve(handlers.get('nimi:runtime:invoke')!(event, {
    command: NIMI_STANDARD_SHELL_COMMANDS['local-app.activityOpen'], payload: { activityId: 'activity-selected' },
  })).then(response => {
    const envelope = response as { ok: boolean; value?: unknown; error?: unknown };
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    return envelope.value;
  });
  try {
    await opening.promise;
    const maintenance = gate.runExclusive(async () => { order.push('maintenance'); });
    resolveSource.resolve(undefined);
    await Promise.resolve();
    assert.deepEqual(order, [], 'the source still waits for the earlier shared operation and maintenance');
    occupied.resolve(undefined);
    assert.deepEqual(await Promise.race([result, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Activity Open retained the root gate')), 1_000);
    })]), { outcome: 'opened', reason: 'opened' });
    await Promise.all([reading, maintenance]);
    assert.deepEqual(order, ['maintenance', 'source-started']);
  } finally {
    if (timer) clearTimeout(timer);
    canceled.reject(new Error('Test disposed'));
    occupied.resolve(undefined); resolveSource.resolve(undefined);
    await result.catch(() => undefined);
    bridge.unregister();
  }
});
