import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import {
  createElectronCapabilityUnavailableError,
  createElectronExternalDaemonRequiredError,
  createElectronRuntimeBridgeCommandNames,
  getElectronStandardShellCapabilityIds,
  registerNimiElectronRuntimeBridge,
  type ElectronRuntimeBridgeUnaryRequest,
  type NimiElectronIpcMain,
  type RuntimeGrpcBridgeClient,
} from '../src/main/index.js';
import { installNimiElectronRuntimeBridge } from '../src/preload/index.js';
import { NIMI_STANDARD_SHELL_CAPABILITY_IDS, NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

class FakeIpcMain implements NimiElectronIpcMain {
  readonly handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown> | unknown>();

  handle(channel: string, listener: (event: unknown, payload: unknown) => Promise<unknown> | unknown): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  invoke(channel: string, event: unknown, payload: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`missing handler: ${channel}`);
    }
    return Promise.resolve(handler(event, payload));
  }
}

function createInvokeEvent(origin = 'http://localhost:1430') {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  return {
    event: {
      senderFrame: { origin },
      sender: {
        send: (channel: string, payload: unknown) => {
          sent.push({ channel, payload });
        },
      },
    },
    sent,
  };
}

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

async function withTempDir<T>(prefix: string, run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), `nimi-electron-shell-${prefix}-`));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withEnvVars<T>(
  vars: Readonly<Record<string, string | undefined>>,
  run: () => Promise<T>,
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (address && typeof address === 'object') {
          resolve(address.port);
          return;
        }
        reject(new Error('missing free port address'));
      });
    });
  });
}

async function waitForFetchOk(url: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await response.text();
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'fetch failed'));
}

async function invokeBridge(ipcMain: FakeIpcMain, event: unknown, message: unknown): Promise<unknown> {
  return unwrapBridgeResponse(await ipcMain.invoke('nimi:runtime:invoke', event, message));
}

function unwrapBridgeResponse(response: unknown): unknown {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('test bridge response must be an object');
  }
  const record = response as Record<string, unknown>;
  if (record.ok === true) {
    return record.value;
  }
  if (record.ok === false) {
    const errorRecord = record.error as Record<string, unknown>;
    const error = new Error(String(errorRecord?.message ?? 'bridge error')) as Error & Record<string, unknown>;
    Object.assign(error, errorRecord);
    throw error;
  }
  throw new Error('test bridge response missing ok discriminator');
}

const STANDARD_COMMANDS = createElectronRuntimeBridgeCommandNames();
const STANDARD_EVENT_NAMESPACE = 'nimi.shell.runtime';

describe('Electron standard shell source boundaries', () => {
  it('keeps the main entry split into capability-owned modules', async () => {
    const srcRoot = path.resolve(process.cwd(), 'shell/electron/src/main');
    const hostSource = await readFile(path.join(srcRoot, 'host.ts'), 'utf8');
    expect(hostSource.split(/\r?\n/u).length).toBeLessThan(500);

    for (const moduleFile of [
      'runtime.ts',
      'runtime-lifecycle.ts',
      'auth.ts',
      'oauth.ts',
      'shell-ui.ts',
      'diagnostics.ts',
      'data-storage.ts',
      'config.ts',
      'local-assets.ts',
      'local-agent.ts',
      'ai-profile.ts',
      'ai-config.ts',
      'avatar.ts',
      'platform-projection.ts',
      'errors.ts',
      'paths.ts',
    ]) {
      const source = await readFile(path.join(srcRoot, moduleFile), 'utf8');
      expect(source, moduleFile).not.toContain('./host.js');
      expect(source, moduleFile).toMatch(/\bexport\b/u);
    }
  });
});

describe('installNimiElectronRuntimeBridge', () => {
  it('exposes only a narrowed invoke/listen API through contextBridge', async () => {
    const exposed = new Map<string, unknown>();
    const ipcEvents = new Map<string, (event: unknown, payload: unknown) => void>();
    const result = installNimiElectronRuntimeBridge({
      contextBridge: {
        exposeInMainWorld: (key, api) => {
          exposed.set(key, api);
        },
      },
      ipcRenderer: {
        invoke: async (channel, payload) => ({
          ok: true,
          value: { channel, payload },
        }),
        on: (channel, listener) => {
          ipcEvents.set(channel, listener);
        },
        removeListener: (channel) => {
          ipcEvents.delete(channel);
        },
      },
    });

    expect(result).toEqual({
      apiKey: '__NIMI_ELECTRON_RUNTIME__',
      invokeChannel: 'nimi:runtime:invoke',
      listenChannelPrefix: 'nimi:runtime:event:',
    });
    const hook = exposed.get('__NIMI_ELECTRON_RUNTIME__') as {
      invoke: (command: string, payload?: unknown) => Promise<unknown>;
      listen: (event: string, handler: (event: { payload: unknown }) => void) => () => void;
      ipcRenderer?: unknown;
    };
    expect(Object.keys(hook).sort()).toEqual(['invoke', 'listen']);
    await expect(hook.invoke(STANDARD_COMMANDS.status, { ok: true })).resolves.toEqual({
      channel: 'nimi:runtime:invoke',
      payload: {
        command: STANDARD_COMMANDS.status,
        payload: { ok: true },
      },
    });

    const received: unknown[] = [];
    const unsubscribe = hook.listen(`${STANDARD_EVENT_NAMESPACE}:stream:abc`, (event) => {
      received.push(event.payload);
    });
    ipcEvents.get(`nimi:runtime:event:${STANDARD_EVENT_NAMESPACE}:stream:abc`)?.({}, { eventType: 'completed' });
    expect(received).toEqual([{ eventType: 'completed' }]);
    unsubscribe();
    expect(ipcEvents.has('nimi:runtime:event:runtime_bridge:stream:abc')).toBe(false);
  });

  it('rethrows serialized standard errors with the admitted envelope shape', async () => {
    const exposed = new Map<string, unknown>();
    installNimiElectronRuntimeBridge({
      contextBridge: {
        exposeInMainWorld: (key, api) => {
          exposed.set(key, api);
        },
      },
      ipcRenderer: {
        invoke: async () => ({
          ok: false,
          error: {
            name: 'NimiElectronShellHostError',
            message: 'Electron Runtime daemon is externally managed',
            code: 'external-daemon-required',
            reasonCode: 'electron-runtime-daemon-managed-externally',
            actionHint: 'start_runtime_daemon_outside_electron_or_use_tauri_host_lifecycle',
            source: 'electron',
            details: { command: STANDARD_COMMANDS.start },
            envelope: {
              code: 'external-daemon-required',
              reasonCode: 'electron-runtime-daemon-managed-externally',
              actionHint: 'start_runtime_daemon_outside_electron_or_use_tauri_host_lifecycle',
              source: 'electron',
              details: { command: STANDARD_COMMANDS.start },
            },
          },
        }),
        on: () => undefined,
        removeListener: () => undefined,
      },
    });
    const hook = exposed.get('__NIMI_ELECTRON_RUNTIME__') as {
      invoke: (command: string, payload?: unknown) => Promise<unknown>;
    };

    await expect(hook.invoke(STANDARD_COMMANDS.start, {})).rejects.toMatchObject({
      code: 'external-daemon-required',
      reasonCode: 'electron-runtime-daemon-managed-externally',
      actionHint: 'start_runtime_daemon_outside_electron_or_use_tauri_host_lifecycle',
      source: 'electron',
      envelope: {
        code: 'external-daemon-required',
        reasonCode: 'electron-runtime-daemon-managed-externally',
        source: 'electron',
      },
    });
  });
});

describe('Electron standard shell capability catalog', () => {
  it('exposes the admitted standard capability ids and command names', () => {
    expect(getElectronStandardShellCapabilityIds()).toEqual(NIMI_STANDARD_SHELL_CAPABILITY_IDS);
    expect(STANDARD_COMMANDS).toEqual({
      unary: NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'],
      stream_open: NIMI_STANDARD_SHELL_COMMANDS['runtime.streamOpen'],
      stream_close: NIMI_STANDARD_SHELL_COMMANDS['runtime.streamClose'],
      status: NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status'],
      start: NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.start'],
      stop: NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.stop'],
      restart: NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.restart'],
      config_get: NIMI_STANDARD_SHELL_COMMANDS['config.get'],
      config_set: NIMI_STANDARD_SHELL_COMMANDS['config.set'],
    });
  });

  it('uses the standard unavailable envelope for admitted but unimplemented commands', () => {
    const error = createElectronCapabilityUnavailableError(NIMI_STANDARD_SHELL_COMMANDS['ai-profile.get']);
    expect(error).toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-capability-unavailable',
      source: 'electron',
    });
    expect(error.envelope).toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-capability-unavailable',
      source: 'electron',
    });
  });
});

describe('registerNimiElectronRuntimeBridge', () => {
  it('proxies unary Runtime calls through raw gRPC bytes with app metadata', async () => {
    let capturedMethod = '';
    let capturedBytes = new Uint8Array();
    let capturedMetadata: Record<string, string> = {};
    const fakeClient: RuntimeGrpcBridgeClient = {
      unary: async (request) => {
        capturedMethod = request.methodId;
        capturedBytes = request.requestBytes;
        capturedMetadata = request.metadata;
        return {
          responseBytes: Uint8Array.from([4, 5, 6]),
          responseMetadata: { 'x-nimi-runtime-version': '0.5.0' },
        };
      },
      serverStream: () => {
        throw new Error('not used');
      },
      close: () => undefined,
    };
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => fakeClient,
      trustedRuntimeMetadataProvider: async () => ({
        protectedAccessToken: { tokenId: 'token-id', secret: 'token-secret' },
        appSession: { sessionId: 'session-id', sessionToken: 'session-token' },
      }),
    });
    const { event } = createInvokeEvent();
    const request: ElectronRuntimeBridgeUnaryRequest = {
      methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
      requestBytesBase64: toBase64(Uint8Array.from([1, 2, 3])),
      metadata: {
        protocolVersion: '1.0.0',
        extra: { 'x-nimi-custom': 'custom-value' },
      },
    };

    const response = await invokeBridge(ipcMain, event, {
      command: STANDARD_COMMANDS.unary,
      payload: request,
    }) as { responseBytesBase64: string; responseMetadata: Record<string, string> };

    expect(capturedMethod).toBe('/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth');
    expect([...capturedBytes]).toEqual([1, 2, 3]);
    expect(capturedMetadata).toMatchObject({
      'x-nimi-protocol-version': '1.0.0',
      'x-nimi-app-id': 'nimi.tester',
      'x-nimi-caller-kind': 'third-party-app',
      'x-nimi-access-token-id': 'token-id',
      'x-nimi-access-token-secret': 'token-secret',
      'x-nimi-session-id': 'session-id',
      'x-nimi-session-token': 'session-token',
    });
    expect(capturedMetadata['x-nimi-custom']).toBe('custom-value');
    expect([...fromBase64(response.responseBytesBase64)]).toEqual([4, 5, 6]);
    expect(response.responseMetadata['x-nimi-runtime-version']).toBe('0.5.0');
  });

  it('accepts SDK electron-ipc Runtime payloads passed through the preload invoke hook', async () => {
    let capturedMethod = '';
    let capturedBytes = new Uint8Array();
    const fakeClient: RuntimeGrpcBridgeClient = {
      unary: async (request) => {
        capturedMethod = request.methodId;
        capturedBytes = request.requestBytes;
        return {
          responseBytes: Uint8Array.from([7, 8, 9]),
        };
      },
      serverStream: () => {
        throw new Error('not used');
      },
      close: () => undefined,
    };
    const ipcMain = new FakeIpcMain();
    const { event } = createInvokeEvent();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => fakeClient,
    });
    const exposed = new Map<string, unknown>();
    installNimiElectronRuntimeBridge({
      contextBridge: {
        exposeInMainWorld: (key, api) => {
          exposed.set(key, api);
        },
      },
      ipcRenderer: {
        invoke: async (channel, payload) => ipcMain.invoke(channel, event, payload),
        on: () => undefined,
        removeListener: () => undefined,
      },
    });
    const hook = exposed.get('__NIMI_ELECTRON_RUNTIME__') as {
      invoke: (command: string, payload?: unknown) => Promise<unknown>;
    };

    const response = await hook.invoke(STANDARD_COMMANDS.unary, {
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
        requestBytesBase64: toBase64(Uint8Array.from([1, 2, 3])),
      },
    }) as { responseBytesBase64: string };

    expect(capturedMethod).toBe('/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth');
    expect([...capturedBytes]).toEqual([1, 2, 3]);
    expect([...fromBase64(response.responseBytesBase64)]).toEqual([7, 8, 9]);
  });

  it('fails closed for disallowed renderer origins and daemon lifecycle ownership', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent('https://evil.invalid').event, {
      command: STANDARD_COMMANDS.status,
      payload: {},
    })).rejects.toMatchObject({
      code: 'forbidden-renderer-access',
      reasonCode: 'electron-renderer-origin-not-allowed',
    });
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: STANDARD_COMMANDS.start,
      payload: {},
    })).rejects.toMatchObject({
      code: 'external-daemon-required',
      reasonCode: 'electron-runtime-daemon-managed-externally',
    });
    expect(createElectronExternalDaemonRequiredError(STANDARD_COMMANDS.restart).code).toBe('external-daemon-required');
    expect(createElectronExternalDaemonRequiredError(STANDARD_COMMANDS.restart).reasonCode).toBe('electron-runtime-daemon-managed-externally');
  });

  it('does not treat wildcard origins as an explicit renderer allowlist', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['*'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent('https://evil.invalid').event, {
      command: STANDARD_COMMANDS.status,
      payload: {},
    })).rejects.toMatchObject({
      code: 'forbidden-renderer-access',
      reasonCode: 'electron-renderer-origin-not-allowed',
    });
  });

  it('implements Runtime config read through a host-owned standard reader', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
      standardShellHost: {
        runtimeConfigGet: async () => ({
          path: 'D:/nimi/runtime/config.json',
          config: { schemaVersion: 1, grpcAddr: '127.0.0.1:46371' },
        }),
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['config.get'],
      payload: {},
    })).resolves.toEqual({
      path: 'D:/nimi/runtime/config.json',
      config: { schemaVersion: 1, grpcAddr: '127.0.0.1:46371' },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['config.set'],
      payload: { configJson: '{"schemaVersion":1}' },
    })).rejects.toMatchObject({
      code: 'external-daemon-required',
      reasonCode: 'electron-runtime-daemon-managed-externally',
    });
  });

  it('keeps auth session custody fail-closed under the external Runtime account service', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
    });

    for (const command of [
      NIMI_STANDARD_SHELL_COMMANDS['auth.sessionLoad'],
      NIMI_STANDARD_SHELL_COMMANDS['auth.sessionSave'],
      NIMI_STANDARD_SHELL_COMMANDS['auth.sessionClear'],
    ]) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command,
        payload: { accessToken: 'renderer-token' },
      })).rejects.toMatchObject({
        code: 'external-daemon-required',
        reasonCode: 'electron-runtime-account-custody-external',
        source: 'electron',
      });
    }
  });

  it('reports external daemon status from a real probe instead of hardcoded success', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => ({
        unary: async () => {
          throw new Error('daemon offline');
        },
        serverStream: () => {
          throw new Error('not used');
        },
        close: () => undefined,
      }),
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: STANDARD_COMMANDS.status,
      payload: {},
    })).resolves.toMatchObject({
      running: false,
      managed: false,
      launchMode: 'RUNTIME',
      grpcAddr: '127.0.0.1:46371',
      lastError: expect.stringContaining('daemon offline'),
    });
  });

  it('implements Electron runtime defaults from the standard shell environment contract', async () => {
    await withEnvVars({
      NIMI_REALM_URL: 'http://localhost',
      NIMI_REALM_JWKS_URL: undefined,
      NIMI_REALM_REVOCATION_URL: undefined,
      NIMI_REALM_JWT_ISSUER: undefined,
      NIMI_REALM_JWT_AUDIENCE: undefined,
      NIMI_REALTIME_URL: 'ws://localhost:3003',
      NIMI_ACCESS_TOKEN: 'electron-default-token',
      NIMI_TARGET_TYPE: 'local',
      NIMI_TARGET_ACCOUNT_ID: 'account-1',
      NIMI_AGENT_ID: 'agent-1',
      NIMI_WORLD_ID: 'world-1',
      NIMI_USER_CONFIRMED_UPLOAD: '1',
    }, async () => {
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.tester',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['runtime-defaults.get'],
        payload: {},
      })).resolves.toEqual({
        realm: {
          realmBaseUrl: 'http://localhost:3002',
          realtimeUrl: 'ws://localhost:3003',
          accessToken: 'electron-default-token',
          jwksUrl: 'http://localhost:3002/api/auth/jwks',
          revocationUrl: 'http://localhost:3002/api/auth/sessions/introspect',
          jwtIssuer: 'http://localhost:3002',
          jwtAudience: 'nimi-runtime',
        },
        runtime: {
          targetType: 'local',
          targetAccountId: 'account-1',
          agentId: 'agent-1',
          worldId: 'world-1',
          userConfirmedUpload: true,
        },
      });
    });
  });

  it('implements host-owned local-agent identity and trusted Runtime caller projection', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
      standardShellHost: {
        localAgentIdentity: {
          ownerUserId: ' owner-1 ',
          runtimeSourceRef: ' tester-runtime ',
        },
        runtimeTrustedCaller: {
          mode: 'local-developer-app',
        },
      },
    });
    const { event } = createInvokeEvent();

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-agent.identity'],
      payload: {},
    })).resolves.toEqual({
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'tester-runtime',
      localAgentRef: 'local-agent:owner-1:tester-runtime',
    });

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller'],
      payload: {},
    })).resolves.toEqual({
      appId: 'nimi.tester',
      appInstanceId: 'nimi.tester.local-developer',
      deviceId: 'local-developer-device',
      mode: 7,
      scopes: [],
    });

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller'],
      payload: { appId: 'renderer-spoof' },
    })).rejects.toMatchObject({
      code: 'forbidden-renderer-access',
      reasonCode: 'electron-renderer-local-agent-caller-field-forbidden',
    });
  });

  it('implements diagnostics renderer entry probe from the Electron host event', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
    });
    const event = {
      ...createInvokeEvent().event,
      senderFrame: {
        origin: 'http://localhost:1430',
        url: 'http://localhost:1430/#/settings',
      },
    };

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['diagnostics.rendererEntryProbe'],
      payload: { stage: 'renderer-bootstrap' },
    })).resolves.toEqual({
      ok: true,
      source: 'electron',
      appId: 'nimi.tester',
      stage: 'renderer-bootstrap',
      origin: 'http://localhost:1430',
      url: 'http://localhost:1430/#/settings',
      hasSender: true,
    });
  });

  it('implements OAuth external URL opening through a host-owned opener', async () => {
    const openedUrls: string[] = [];
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
      standardShellHost: {
        openExternalUrl: async (url) => {
          openedUrls.push(url);
        },
      },
    });
    const { event } = createInvokeEvent();

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl'],
      payload: { payload: { url: 'https://auth.example.test/authorize' } },
    })).resolves.toEqual({ opened: true });
    expect(openedUrls).toEqual(['https://auth.example.test/authorize']);

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl'],
      payload: { payload: { url: 'http://evil.example.test/authorize' } },
    })).rejects.toMatchObject({
      code: 'forbidden-renderer-access',
      reasonCode: 'electron-oauth-external-url-not-allowed',
    });
  });

  it('implements OAuth loopback callback listening for authorization codes', async () => {
    const port = await findFreePort();
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
    });

    const resultPromise = invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['oauth.listenForCode'],
      payload: {
        redirectUri: `http://127.0.0.1:${port}/oauth/callback`,
        timeoutMs: 5_000,
      },
    });
    await waitForFetchOk(`http://127.0.0.1:${port}/oauth/callback?code=code-123&state=state-456`);

    await expect(resultPromise).resolves.toMatchObject({
      callbackUrl: `http://localhost:${port}/oauth/callback?code=code-123&state=state-456`,
      code: 'code-123',
      state: 'state-456',
    });
  });

  it('implements OAuth token exchange through fixed provider endpoints', async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
      standardShellHost: {
        oauthTokenExchangeFetch: async (url, init) => {
          requests.push({ url, body: String(init.body ?? '') });
          return new Response(JSON.stringify({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'openid profile',
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      },
    });
    const { event } = createInvokeEvent();

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['oauth.tokenExchange'],
      payload: {
        payload: {
          provider: 'CODEX',
          clientId: 'client-1',
          code: 'code-1',
          codeVerifier: 'verifier-1',
          redirectUri: 'http://127.0.0.1:4100/oauth/callback',
        },
      },
    })).resolves.toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'openid profile',
    });
    expect(requests).toEqual([{
      url: 'https://auth.openai.com/oauth/token',
      body: 'grant_type=authorization_code&client_id=client-1&code=code-1&code_verifier=verifier-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A4100%2Foauth%2Fcallback',
    }]);

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['oauth.tokenExchange'],
      payload: {
        payload: {
          provider: 'https://evil.example.test/token',
          clientId: 'client-1',
          code: 'code-1',
          codeVerifier: 'verifier-1',
          redirectUri: 'http://127.0.0.1:4100/oauth/callback',
        },
      },
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'electron-oauth-token-provider-not-admitted',
    });
  });

  it('dispatches standard shell UI commands through host-owned callbacks', async () => {
    const calls: string[] = [];
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
      standardShellHost: {
        confirmDialog: async (payload, input) => {
          calls.push(`${input.command}:${payload.level || 'info'}`);
          return { confirmed: payload.title === 'Confirm' && payload.description === 'Proceed?' };
        },
        startWindowDrag: (input) => {
          calls.push(input.command);
        },
        focusMainWindow: (input) => {
          calls.push(input.command);
        },
      },
    });
    const { event } = createInvokeEvent();

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog'],
      payload: {
        payload: {
          title: 'Confirm',
          description: 'Proceed?',
          level: 'warning',
        },
      },
    })).resolves.toEqual({ confirmed: true });
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.startWindowDrag'],
      payload: {},
    })).resolves.toEqual({});
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.focusMainWindow'],
      payload: {},
    })).resolves.toEqual({});
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog'],
      payload: {
        title: 'Confirm',
        description: 'Proceed?',
        level: 'debug',
      },
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'electron-shell-ui-dialog-level-invalid',
    });

    expect(calls).toEqual([
      `${NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog']}:warning`,
      NIMI_STANDARD_SHELL_COMMANDS['shell-ui.startWindowDrag'],
      NIMI_STANDARD_SHELL_COMMANDS['shell-ui.focusMainWindow'],
    ]);
  });

  it('fails closed when standard shell UI callbacks are not installed', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
    });

    for (const command of [
      NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog'],
      NIMI_STANDARD_SHELL_COMMANDS['shell-ui.startWindowDrag'],
      NIMI_STANDARD_SHELL_COMMANDS['shell-ui.focusMainWindow'],
    ]) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command,
        payload: command === NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog']
          ? { title: 'Confirm', description: 'Proceed?' }
          : {},
      })).rejects.toMatchObject({
        code: 'capability-unavailable',
        reasonCode: 'electron-standard-capability-unavailable',
      });
    }
  });

  it('implements avatar asset resolution through the standard local asset roots', async () => {
    await withTempDir('avatar-asset', async (root) => {
      const assetRoot = path.join(root, 'avatar');
      await mkdir(assetRoot, { recursive: true });
      const assetPath = path.join(assetRoot, 'avatar.vrm');
      await writeFile(assetPath, 'avatar bytes', 'utf8');
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.tester',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          localAssetRoots: [assetRoot],
          resolveLocalAssetUrl: (filePath) => `nimi-shell-file://${encodeURIComponent(filePath)}`,
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['avatar.assetResolve'],
        payload: { path: assetPath },
      })).resolves.toEqual({
        path: assetPath,
        url: `nimi-shell-file://${encodeURIComponent(assetPath)}`,
      });
    });
  });

  it('implements AI Profile lookup through the standard factory catalog projection', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
    });
    const { event } = createInvokeEvent();

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['ai-profile.get'],
      payload: { alias: ' local-gpu ' },
    })).resolves.toMatchObject({
      alias: 'local-gpu',
      computePosture: 'cuda-capable',
      routingPolicy: 'local-first',
      materializationConfirmationRequired: true,
      capabilitySet: expect.arrayContaining(['image.generate']),
    });

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['ai-profile.get'],
      payload: { alias: 'missing' },
    })).rejects.toMatchObject({
      code: 'not-found',
      reasonCode: 'electron-ai-profile-alias-not-found',
    });
  });

  it('implements Platform projection lookup through the standard projection builders', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
    });
    const { event } = createInvokeEvent();
    const command = NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get'];

    await expect(invokeBridge(ipcMain, event, {
      command,
      payload: {
        projectionId: 'factory-profile-index',
      },
    })).resolves.toMatchObject({
      projectionId: 'factory-profile-index',
      record: {
        catalogVersion: 'v1',
        profiles: expect.arrayContaining([
          expect.objectContaining({ alias: 'local-gpu', deviceClass: 'gpu-recommended' }),
        ]),
      },
    });

    await expect(invokeBridge(ipcMain, event, {
      command,
      payload: {
        projectionId: 'apps-registry',
      },
    })).resolves.toMatchObject({
      projectionId: 'apps-registry',
      record: {
        catalogId: 'platform_nimi_app_registry',
        apps: expect.arrayContaining([
          expect.objectContaining({ appId: 'nimi.avatar', visibility: 'hidden-internal' }),
        ]),
      },
    });

    await expect(invokeBridge(ipcMain, event, {
      command,
      payload: {
        projectionId: 'apps-bridge',
        registryPath: '~/.nimi/apps/registry.json',
        packagesPath: '~/.nimi/apps/packages.json',
      },
    })).resolves.toMatchObject({
      projectionId: 'apps-bridge',
      record: {
        registryRows: expect.arrayContaining([
          expect.objectContaining({ appId: 'nimi.avatar', aiProfileSelectionRef: 'local-gpu' }),
        ]),
        releaseDescriptors: expect.arrayContaining([
          expect.objectContaining({ descriptorId: 'nimi.avatar.bundled-with-nimi' }),
        ]),
      },
    });

    await expect(invokeBridge(ipcMain, event, {
      command,
      payload: {
        projectionId: 'apps-packages',
      },
    })).resolves.toMatchObject({
      projectionId: 'apps-packages',
      record: {
        schemaVersion: 2,
        packages: [],
      },
    });

    await expect(invokeBridge(ipcMain, event, {
      command,
      payload: { projectionId: 'missing' },
    })).rejects.toMatchObject({
      code: 'not-found',
      reasonCode: 'electron-platform-projection-not-found',
    });
  });

  it('implements AI Config get/set through a host-owned standard store', async () => {
    const configs = new Map<string, unknown>();
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
      standardShellHost: {
        aiConfigStore: {
          get: ({ scopeRef }) => configs.get(scopeRef),
          set: ({ scopeRef, config }) => {
            configs.set(scopeRef, config);
            return config;
          },
        },
      },
    });
    const { event } = createInvokeEvent();

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['ai-config.get'],
      payload: { scopeRef: 'scope:test' },
    })).rejects.toMatchObject({
      code: 'not-found',
      reasonCode: 'electron-ai-config-scope-not-found',
    });

    const config = {
      schemaVersion: 1,
      scopeRef: 'scope:test',
      capabilities: {
        targetRefs: {
          'text.generate': { kind: 'local-runtime', readinessRef: 'execution:e2e' },
        },
      },
    };
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['ai-config.set'],
      payload: { scopeRef: 'scope:test', config },
    })).resolves.toEqual({ scopeRef: 'scope:test', config });
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['ai-config.get'],
      payload: { scopeRef: 'scope:test' },
    })).resolves.toEqual({ scopeRef: 'scope:test', config });

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['ai-config.set'],
      payload: { scopeRef: 'scope:test' },
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'electron-ai-config-value-required',
    });
  });

  it('implements standard data, storage, and local asset capabilities inside admitted host roots', async () => {
    await withTempDir('standard-roots', async (root) => {
      const dataRoot = path.join(root, 'data');
      const assetRoot = path.join(root, 'assets');
      await mkdir(dataRoot, { recursive: true });
      await mkdir(assetRoot, { recursive: true });
      const assetPath = path.join(assetRoot, 'preview.txt');
      await writeFile(assetPath, 'preview', 'utf8');
      const registeredAssets: string[] = [];
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.tester',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          dataRoot,
          localAssetRoots: [assetRoot],
          resolveLocalAssetUrl: async (filePath) => {
            registeredAssets.push(filePath);
            return `nimi-shell-file://${encodeURIComponent(filePath)}`;
          },
        },
      });
      const { event } = createInvokeEvent();

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve'],
        payload: { relativePath: 'settings/profile.json' },
      })).resolves.toMatchObject({
        path: path.join(dataRoot, 'settings', 'profile.json'),
      });

      const writeResult = await invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
        payload: {
          relativePath: 'settings/profile.json',
          value: { schemaVersion: 1, enabled: true },
        },
      }) as { path: string; value: Record<string, unknown> };
      expect(writeResult.path).toBe(path.join(dataRoot, 'settings', 'profile.json'));
      expect(JSON.parse(await readFile(writeResult.path, 'utf8'))).toEqual({ schemaVersion: 1, enabled: true });

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
        payload: { relativePath: 'settings/profile.json' },
      })).resolves.toEqual({
        path: path.join(dataRoot, 'settings', 'profile.json'),
        value: { schemaVersion: 1, enabled: true },
      });

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl'],
        payload: { path: assetPath },
      })).resolves.toEqual({
        path: assetPath,
        url: `nimi-shell-file://${encodeURIComponent(assetPath)}`,
      });
      expect(registeredAssets).toEqual([assetPath]);
    });
  });

  it('fails closed for Electron standard file capability path escapes and missing assets', async () => {
    await withTempDir('standard-negative', async (root) => {
      const dataRoot = path.join(root, 'data');
      const assetRoot = path.join(root, 'assets');
      await mkdir(dataRoot, { recursive: true });
      await mkdir(assetRoot, { recursive: true });
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.tester',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          dataRoot,
          localAssetRoots: [assetRoot],
          resolveLocalAssetUrl: (filePath) => `nimi-shell-file://${encodeURIComponent(filePath)}`,
        },
      });
      const { event } = createInvokeEvent();

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve'],
        payload: { relativePath: '../escape.json' },
      })).rejects.toMatchObject({
        code: 'invalid-path',
        reasonCode: 'electron-standard-path-escapes-root',
      });

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
        payload: { relativePath: 'bad.json', value: undefined },
      })).rejects.toMatchObject({
        code: 'invalid-payload',
        reasonCode: 'electron-standard-json-value-required',
      });

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl'],
        payload: { path: path.join(assetRoot, 'missing.txt') },
      })).rejects.toMatchObject({
        code: 'not-found',
        reasonCode: 'electron-standard-local-asset-not-found',
      });
    });
  });

  it('keeps Electron config mutation fail-closed while Runtime daemon ownership is external', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['config.set'],
      payload: { configJson: '{"schemaVersion":1}' },
    })).rejects.toMatchObject({
      code: 'external-daemon-required',
      reasonCode: 'electron-runtime-daemon-managed-externally',
    });
  });

  it('pins app identity and rejects renderer-supplied sensitive auth fields', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => ({
        unary: async () => ({ responseBytes: new Uint8Array() }),
        serverStream: () => {
          throw new Error('not used');
        },
        close: () => undefined,
      }),
    });

    const basePayload = {
      methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
      requestBytesBase64: '',
    };
    for (const payload of [
      { ...basePayload, authorization: 'Bearer renderer' },
      { ...basePayload, protectedAccessToken: { tokenId: 'renderer', secret: 'secret' } },
      { ...basePayload, appSession: { sessionId: 'renderer', sessionToken: 'secret' } },
      { ...basePayload, metadata: { appId: 'evil.app' } },
      { ...basePayload, metadata: { callerKind: 'desktop-host' } },
      { ...basePayload, metadata: { callerId: 'evil.caller' } },
      { ...basePayload, metadata: { participantId: 'evil.participant' } },
      { ...basePayload, metadata: { extra: { 'x-nimi-authorization': 'Bearer renderer' } } },
      { ...basePayload, metadata: { extra: { 'x-nimi-provider-api-key': 'secret' } } },
      { ...basePayload, metadata: { extra: { 'x-nimi-session-token': 'session-token' } } },
    ]) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: STANDARD_COMMANDS.unary,
        payload,
      })).rejects.toMatchObject({ code: 'forbidden-renderer-access' });
    }
  });

  it('accepts only strict base64 Runtime byte payloads', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => ({
        unary: async () => ({ responseBytes: new Uint8Array() }),
        serverStream: () => {
          throw new Error('not used');
        },
        close: () => undefined,
      }),
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: STANDARD_COMMANDS.unary,
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
        requestBytesBase64: 'not base64!',
      },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
  });

  it('dispatches app-owned Electron shell commands through the same narrowed bridge', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
      commandHandlers: {
        tester_run_history_load: async ({ payload, appId }) => ({
          appId,
          payload,
          recordsJson: '{}',
        }),
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: 'tester_run_history_load',
      payload: { storageRoot: 'D:/tester/data' },
    })).resolves.toEqual({
      appId: 'nimi.tester',
      payload: { storageRoot: 'D:/tester/data' },
      recordsJson: '{}',
    });
  });

  it('forwards server-stream chunks to the scoped renderer event channel and closes streams', async () => {
    let canceled = false;
    const fakeClient: RuntimeGrpcBridgeClient = {
      unary: () => {
        throw new Error('not used');
      },
      serverStream: () => ({
        cancel: () => {
          canceled = true;
        },
        start: ({ onData, onEnd }) => {
          onData(Uint8Array.from([9, 8, 7]));
          onEnd();
        },
      }),
      close: () => undefined,
    };
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => fakeClient,
    });
    const { event, sent } = createInvokeEvent();
    const openResponse = await invokeBridge(ipcMain, event, {
      command: STANDARD_COMMANDS.stream_open,
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents',
        streamId: 'stream-1',
        requestBytesBase64: toBase64(Uint8Array.from([1])),
      },
    }) as { streamId: string };

    expect(openResponse.streamId).toBe('stream-1');
    expect(sent).toEqual([
      {
        channel: `nimi:runtime:event:${STANDARD_EVENT_NAMESPACE}:stream:stream-1`,
        payload: {
          streamId: 'stream-1',
          eventType: 'next',
          payloadBytesBase64: toBase64(Uint8Array.from([9, 8, 7])),
        },
      },
      {
        channel: `nimi:runtime:event:${STANDARD_EVENT_NAMESPACE}:stream:stream-1`,
        payload: {
          streamId: 'stream-1',
          eventType: 'completed',
        },
      },
    ]);

    await invokeBridge(ipcMain, event, {
      command: STANDARD_COMMANDS.stream_close,
      payload: { streamId: 'stream-1' },
    });
    expect(canceled).toBe(false);
  });

  it('maps server-stream Runtime endpoint failures to the standard unavailable envelope', async () => {
    const fakeClient: RuntimeGrpcBridgeClient = {
      unary: () => {
        throw new Error('not used');
      },
      serverStream: () => ({
        cancel: () => undefined,
        start: ({ onError }) => {
          onError(new Error('daemon offline'));
        },
      }),
      close: () => undefined,
    };
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => fakeClient,
    });
    const { event, sent } = createInvokeEvent();

    const openResponse = await invokeBridge(ipcMain, event, {
      command: STANDARD_COMMANDS.stream_open,
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents',
        streamId: 'stream-unavailable',
        requestBytesBase64: '',
      },
    }) as { streamId: string };

    expect(openResponse.streamId).toBe('stream-unavailable');
    expect(sent).toEqual([
      {
        channel: `nimi:runtime:event:${STANDARD_EVENT_NAMESPACE}:stream:stream-unavailable`,
        payload: {
          streamId: 'stream-unavailable',
          eventType: 'error',
          error: expect.objectContaining({
            code: 'external-daemon-required',
            reasonCode: 'electron-runtime-endpoint-unavailable',
            source: 'electron',
          }),
        },
      },
    ]);
  });
});
