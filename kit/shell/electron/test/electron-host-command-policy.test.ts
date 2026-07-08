import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  registerNimiElectronRuntimeBridge,
  type NimiElectronHostCommandPolicy,
  type RuntimeGrpcBridgeClient,
} from '../src/main/index.js';
import { installNimiElectronRuntimeBridge } from '../src/preload/index.js';
import {
  NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';
import {
  FakeIpcMain,
  STANDARD_COMMANDS,
  createInvokeEvent,
  invokeBridge,
  toBase64,
  withTempDir,
} from './electron-shell-test-utils.js';

const DENIED_COMMANDS = new Set<string>([
  NIMI_STANDARD_SHELL_COMMANDS['oauth.tokenExchange'],
  NIMI_STANDARD_SHELL_COMMANDS['auth.sessionLoad'],
  NIMI_STANDARD_SHELL_COMMANDS['auth.sessionSave'],
  NIMI_STANDARD_SHELL_COMMANDS['auth.sessionClear'],
  NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.start'],
  NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.stop'],
  NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.restart'],
  NIMI_STANDARD_SHELL_COMMANDS['config.set'],
  NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller'],
]);

function parentosFixturePolicy(): NimiElectronHostCommandPolicy {
  return ({ command }) => DENIED_COMMANDS.has(command)
    ? {
        allow: false,
        code: 'forbidden-renderer-access',
        reasonCode: 'parentos-electron-command-forbidden',
        actionHint: 'use_parentos_runtime_broker_or_host_owned_surface',
        details: { command },
      }
    : { allow: true };
}

function registerPolicyBridge(input: {
  readonly policy?: NimiElectronHostCommandPolicy;
  readonly fakeClient?: RuntimeGrpcBridgeClient;
  readonly tokenFetch?: () => Promise<Response>;
  readonly openExternalUrl?: (url: string) => Promise<void> | void;
  readonly commandHandlers?: Record<string, (input: { payload: Readonly<Record<string, unknown>> }) => unknown>;
} = {}): FakeIpcMain {
  const ipcMain = new FakeIpcMain();
  registerNimiElectronRuntimeBridge({
    appId: 'nimi.parentos',
    runtimeEndpoint: '127.0.0.1:46371',
    allowedOrigins: ['http://localhost:1430'],
    ipcMain,
    createGrpcClient: async () => input.fakeClient ?? {
      unary: async () => ({ responseBytes: Uint8Array.from([9, 8, 7]) }),
      serverStream: () => ({
        start: ({ onEnd }) => onEnd(),
        cancel: () => undefined,
      }),
      close: () => undefined,
    },
    commandPolicy: input.policy,
    standardShellHost: {
      openExternalUrl: input.openExternalUrl ?? (() => undefined),
      oauthTokenExchangeFetch: input.tokenFetch ?? (async () => new Response(JSON.stringify({
        access_token: 'token',
        token_type: 'Bearer',
      }), { status: 200, headers: { 'content-type': 'application/json' } })),
      openFileDialog: () => ({ canceled: true, paths: [] }),
      revealInOs: () => undefined,
      exportDirectory: () => path.join(process.cwd(), '.tmp-electron-policy-export'),
    },
    commandHandlers: input.commandHandlers,
  });
  return ipcMain;
}

describe('Electron host command policy', () => {
  it('denies token custody and blocked runtime host commands before their handlers run', async () => {
    let tokenExchangeCalls = 0;
    const ipcMain = registerPolicyBridge({
      policy: parentosFixturePolicy(),
      tokenFetch: async () => {
        tokenExchangeCalls += 1;
        return new Response('{}', { status: 200 });
      },
    });
    const { event } = createInvokeEvent();

    for (const command of DENIED_COMMANDS) {
      await expect(invokeBridge(ipcMain, event, {
        command,
        payload: command === NIMI_STANDARD_SHELL_COMMANDS['oauth.tokenExchange']
          ? {
              payload: {
                provider: 'CODEX',
                clientId: 'client-1',
                code: 'code-1',
                codeVerifier: 'verifier-1',
                redirectUri: 'http://127.0.0.1:4100/oauth/callback',
              },
            }
          : {},
      })).rejects.toMatchObject({
        code: 'forbidden-renderer-access',
        reasonCode: 'parentos-electron-command-forbidden',
        actionHint: 'use_parentos_runtime_broker_or_host_owned_surface',
        source: 'host',
        details: { command },
      });
    }
    expect(tokenExchangeCalls).toBe(0);
  });

  it('preserves host-owned policy denial source through the preload invoke bridge', async () => {
    let tokenExchangeCalls = 0;
    const ipcMain = registerPolicyBridge({
      policy: parentosFixturePolicy(),
      tokenFetch: async () => {
        tokenExchangeCalls += 1;
        return new Response('{}', { status: 200 });
      },
    });
    const { event } = createInvokeEvent();
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

    await expect(hook.invoke(NIMI_STANDARD_SHELL_COMMANDS['oauth.tokenExchange'], {
      payload: {
        provider: 'CODEX',
        clientId: 'client-1',
        code: 'code-1',
        codeVerifier: 'verifier-1',
        redirectUri: 'http://127.0.0.1:4100/oauth/callback',
      },
    })).rejects.toMatchObject({
      code: 'forbidden-renderer-access',
      reasonCode: 'parentos-electron-command-forbidden',
      actionHint: 'use_parentos_runtime_broker_or_host_owned_surface',
      source: 'host',
      envelope: {
        code: 'forbidden-renderer-access',
        reasonCode: 'parentos-electron-command-forbidden',
        source: 'host',
      },
      details: {
        command: NIMI_STANDARD_SHELL_COMMANDS['oauth.tokenExchange'],
        commandKind: 'standard',
      },
    });
    expect(tokenExchangeCalls).toBe(0);
  });

  it('allows admitted standard shell and runtime bridge commands to continue to host handlers', async () => {
    await withTempDir('command-policy', async (root) => {
      const selectedPath = path.join(root, 'selected.png');
      const revealPath = path.join(root, 'reveal.txt');
      const exportDir = path.join(root, 'exports');
      await mkdir(exportDir, { recursive: true });
      await writeFile(selectedPath, 'image bytes', 'utf8');
      await writeFile(revealPath, 'reveal bytes', 'utf8');

      const openedUrls: string[] = [];
      let unaryCalls = 0;
      let streamCanceled = false;
      const fakeClient: RuntimeGrpcBridgeClient = {
        unary: async () => {
          unaryCalls += 1;
          return { responseBytes: Uint8Array.from([1, 2, 3]) };
        },
        serverStream: () => ({
          start: ({ onEnd }) => onEnd(),
          cancel: () => {
            streamCanceled = true;
          },
        }),
        close: () => undefined,
      };
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.parentos',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => fakeClient,
        commandPolicy: parentosFixturePolicy(),
        standardShellHost: {
          openExternalUrl: (url) => {
            openedUrls.push(url);
          },
          openFileDialog: () => ({ canceled: false, paths: [selectedPath] }),
          revealInOs: () => undefined,
          exportDirectory: () => exportDir,
          standardDataRootBinding: {
            source: 'runtime-launch-projection',
            durableDataRoot: root,
            projectionRef: 'electron-command-policy-test',
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
        command: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
        payload: { kind: 'file', multiple: false },
      })).resolves.toEqual({ canceled: false, paths: [selectedPath] });

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal'],
        payload: { path: revealPath },
      })).resolves.toMatchObject({ revealed: true, path: revealPath });

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['export.saveFile'],
        payload: { filename: 'report.txt', dataBase64: Buffer.from('report').toString('base64') },
      })).resolves.toMatchObject({ filename: 'report.txt', byteSize: 6 });

      await expect(invokeBridge(ipcMain, event, {
        command: STANDARD_COMMANDS.unary,
        payload: {
          methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
          requestBytesBase64: toBase64(Uint8Array.from([4])),
        },
      })).resolves.toMatchObject({ responseBytesBase64: toBase64(Uint8Array.from([1, 2, 3])) });
      expect(unaryCalls).toBe(1);

      await expect(invokeBridge(ipcMain, event, {
        command: STANDARD_COMMANDS.stream_open,
        payload: {
          methodId: '/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents',
          streamId: 'policy-stream',
          requestBytesBase64: '',
        },
      })).resolves.toEqual({ streamId: 'policy-stream' });
      await expect(invokeBridge(ipcMain, event, {
        command: STANDARD_COMMANDS.stream_close,
        payload: { streamId: 'policy-stream' },
      })).resolves.toEqual({});
      expect(streamCanceled).toBe(false);
    });
  });

  it('classifies registered app-domain commands separately from unknown commands', async () => {
    const policyCalls: Array<{ command: string; commandKind: string; appId: string }> = [];
    const ipcMain = registerPolicyBridge({
      policy: (input) => {
        policyCalls.push(input);
        return { allow: true };
      },
      commandHandlers: {
        create_child: ({ payload }) => ({ reached: true, payload }),
      },
    });
    const { event } = createInvokeEvent();

    await expect(invokeBridge(ipcMain, event, {
      command: 'create_child',
      payload: { childId: 'child-1' },
    })).resolves.toEqual({
      reached: true,
      payload: { childId: 'child-1' },
    });
    await expect(invokeBridge(ipcMain, event, {
      command: 'missing_parentos_command',
      payload: {},
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'unsupported-electron-shell-command',
    });
    expect(policyCalls).toEqual([
      { command: 'create_child', commandKind: 'app-domain', appId: 'nimi.parentos' },
      { command: 'missing_parentos_command', commandKind: 'unknown', appId: 'nimi.parentos' },
    ]);
  });

  it('keeps capability sets scoped to standard commands while app-domain handlers remain policy-owned', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.parentos',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
      commandPolicy: () => ({ allow: true }),
      standardShellHost: {
        capabilitySetRef: NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        openFileDialog: () => ({ canceled: true, paths: [] }),
      },
      commandHandlers: {
        create_child: () => ({ reached: true }),
      },
    });
    const { event } = createInvokeEvent();

    await expect(invokeBridge(ipcMain, event, {
      command: 'create_child',
      payload: {},
    })).resolves.toEqual({ reached: true });

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
      payload: { kind: 'file' },
    })).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-capability-not-in-host-set',
      details: {
        command: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
        capabilitySetRef: NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
      },
    });
  });
});
