import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopMacOSRuntimeServiceHost } from '../src-electron/macos-runtime-service.js';

const names = { status: 'status', start: 'start', restart: 'restart' };

test('a newly installed service without a BTM record attempts native registration', async () => {
  const operations: string[] = [];
  const host = createDesktopMacOSRuntimeServiceHost({
    invoke: async () => { throw new Error('service is not approved yet'); },
  }, {
    registration: async (operation) => { operations.push(operation); return operation === 'status' ? 3 : 2; },
    socketExists: () => false,
    showApproval: async () => false,
    runtimeEndpoint: 'protected-desktop-control',
  });
  assert.equal(await host.prepare(names), false);
  assert.deepEqual(operations, ['status', 'register']);
});

test('opening settings stops bootstrap until the native approval state changes', async () => {
  const operations: string[] = [];
  let registrationStatus = 2;
  let prompts = 0;
  const host = createDesktopMacOSRuntimeServiceHost({
    invoke: async () => {
      assert.equal(registrationStatus, 1, 'protected Runtime is queried only after approval');
      return { running: true };
    },
  }, {
    registration: async (operation) => { operations.push(operation); return registrationStatus; },
    socketExists: () => true,
    showApproval: async () => { prompts += 1; return true; },
    runtimeEndpoint: 'protected-desktop-control',
  });
  assert.equal(await host.prepare(names), false);
  assert.deepEqual(operations, ['status', 'open-settings']);
  registrationStatus = 1;
  assert.equal(await host.prepare(names), true);
  assert.equal(prompts, 1);
});

test('pending administrator approval remains unavailable and does not repeatedly register', async () => {
  const operations: string[] = [];
  let registrationStatus = 0;
  const host = createDesktopMacOSRuntimeServiceHost({
    invoke: async () => { throw new Error('protected Runtime must not be called before approval'); },
  }, {
    registration: async (operation) => {
      operations.push(operation);
      if (operation === 'register') registrationStatus = 2;
      return registrationStatus;
    },
    socketExists: () => false,
    showApproval: async () => false,
    runtimeEndpoint: 'protected-desktop-control',
  });
  await host.prepare(names);
  assert.deepEqual(await host.invoke('status', names), {
    running: false, managed: true, launchMode: 'RELEASE',
    grpcAddr: 'protected-desktop-control', lastError: 'runtime-service-approval-required',
  });
  await host.invoke('start', names);
  assert.deepEqual(operations, ['status', 'register', 'status', 'status']);
});

test('an explicit start repairs an enabled registration whose update removed the socket', async () => {
  const operations: string[] = [];
  const ownerResult = { running: false, lastError: 'runtime-starting' };
  const host = createDesktopMacOSRuntimeServiceHost({
    invoke: async (command) => { operations.push(`runtime:${command}`); return ownerResult; },
  }, {
    registration: async (operation) => { operations.push(operation); return operation === 'unregister' ? 0 : 1; },
    socketExists: () => false,
    showApproval: async () => { throw new Error('already approved'); },
    runtimeEndpoint: 'protected-desktop-control',
  });
  assert.equal(await host.invoke('start', names), ownerResult);
  assert.deepEqual(operations, ['status', 'unregister', 'register', 'runtime:start']);
});

test('an update retries the temporary disabled BTM disposition after successful unregister', async () => {
  const operations: string[] = [];
  let status = 1;
  let attempts = 0;
  const host = createDesktopMacOSRuntimeServiceHost({ invoke: async () => ({ running: true }) }, {
    registration: async (operation) => {
      operations.push(operation);
      if (operation === 'unregister') status = 0;
      if (operation === 'register') {
        if (attempts++ === 0) throw new Error('runtime-service-unavailable');
        status = 1;
      }
      return status;
    },
    socketExists: () => false,
    showApproval: async () => { throw new Error('existing approval remains valid'); },
    runtimeEndpoint: 'protected-desktop-control',
  });
  assert.equal(await host.prepare(names), true);
  assert.deepEqual(operations, ['status', 'unregister', 'register', 'status', 'register']);
});

test('an update does not retry a trust failure as temporary registration state', async () => {
  const operations: string[] = [];
  const host = createDesktopMacOSRuntimeServiceHost({ invoke: async () => ({ running: false }) }, {
    registration: async (operation) => {
      operations.push(operation);
      if (operation === 'register') throw new Error('runtime-service-untrusted');
      return operation === 'unregister' ? 0 : 1;
    },
    socketExists: () => false,
    showApproval: async () => false,
    runtimeEndpoint: 'protected-desktop-control',
  });
  await assert.rejects(host.prepare(names), /runtime-service-untrusted/);
  assert.deepEqual(operations, ['status', 'unregister', 'register']);
});

test('bootstrap waits for protected Runtime running after registration', async () => {
  const commands: string[] = [];
  const host = createDesktopMacOSRuntimeServiceHost({
    invoke: async (command) => {
      commands.push(command);
      return { running: command === names.status };
    },
  }, {
    registration: async () => 1,
    socketExists: () => true,
    showApproval: async () => { throw new Error('already approved'); },
    runtimeEndpoint: 'protected-desktop-control',
  });
  assert.equal(await host.prepare(names), true);
  assert.deepEqual(commands, ['start', 'status']);
});

test('bootstrap propagates a protected Runtime failure instead of admitting the registered service', async () => {
  const host = createDesktopMacOSRuntimeServiceHost({
    invoke: async () => { throw new Error('runtime-service-untrusted'); },
  }, {
    registration: async () => 1,
    socketExists: () => true,
    showApproval: async () => false,
    runtimeEndpoint: 'protected-desktop-control',
  });
  await assert.rejects(host.prepare(names), /runtime-service-untrusted/);
});

test('a running installation is not reregistered and uninstall errors propagate', async () => {
  const operations: string[] = [];
  const host = createDesktopMacOSRuntimeServiceHost({ invoke: async () => ({ running: true }) }, {
    registration: async (operation) => { operations.push(operation); return 1; },
    socketExists: () => true,
    showApproval: async () => false,
    runtimeEndpoint: 'protected-desktop-control',
  });
  await host.prepare(names);
  assert.deepEqual(operations, ['status']);
  await assert.rejects(host.unregister(), /could not be unregistered/);
});
