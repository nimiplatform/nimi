import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  createElectronCapabilityUnavailableError,
  createElectronExternalDaemonRequiredError,
  createNimiElectronStandardApplicationMenuTemplate,
  createNimiElectronFileAIConfigStore,
  getElectronStandardShellCapabilityIds,
  registerNimiElectronRuntimeBridge,
  type ElectronRuntimeBridgeTrustedMetadataProvider,
  type ElectronRuntimeBridgeUnaryRequest,
  type RuntimeGrpcBridgeClient,
} from '../src/main/index.js';
import { installNimiElectronRuntimeBridge } from '../src/preload/index.js';
import {
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_CAPABILITIES,
  NIMI_STANDARD_SHELL_CAPABILITY_IDS,
  NIMI_STANDARD_SHELL_CAPABILITY_SETS,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';
import {
  FakeIpcMain,
  STANDARD_COMMANDS,
  STANDARD_EVENT_NAMESPACE,
  createInvokeEvent,
  fetchOkText,
  findFreePort,
  fromBase64,
  invokeBridge,
  toBase64,
  withEnvVars,
  withTempDir,
} from './electron-shell-test-utils.js';

describe('registerNimiElectronRuntimeBridge', () => {
  it('does not project environment access tokens through Electron runtime defaults', async () => {
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
        allowAllStandardShellCommands: true,
        localAgentIdentity: {
          ownerUserId: ' owner-1 ',
          runtimeSourceRef: ' tester-runtime ',
          localAgentRef: ' local-agent:opaque-tester-runtime ',
        },
        runtimeTrustedCaller: {
          mode: 'local-first-party-app',
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
      localAgentRef: 'local-agent:opaque-tester-runtime',
    });

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller'],
      payload: {},
    })).resolves.toEqual({
      appId: 'nimi.tester',
      appInstanceId: 'nimi.tester.local-first-party',
      deviceId: 'local-first-party-device',
      mode: 1,
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

  it('rejects app-authored localAgentRef values derived from owner and runtime source identity', async () => {
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
        allowAllStandardShellCommands: true,
        localAgentIdentity: {
          ownerUserId: 'owner-1',
          runtimeSourceRef: 'tester-runtime',
          localAgentRef: 'local-agent:owner-1:tester-runtime',
        },
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-agent.identity'],
      payload: {},
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'electron-local-agent-ref-derived-from-runtime-source',
      actionHint: 'provide_runtime_owned_opaque_local_agent_ref',
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
        allowAllStandardShellCommands: true,
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

  it('rejects OAuth external URLs that target Desktop Open reserved loopback routes', async () => {
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
        allowAllStandardShellCommands: true,
        openExternalUrl: async (url) => {
          openedUrls.push(url);
        },
      },
    });
    const { event } = createInvokeEvent();
    const reservedUrls = [
      'http://127.0.0.1:4500/v1/open-intent',
      'http://[::1]:4500/v1/open-intent',
      'http://127.0.0.1:4500/%76%31/%6f%70%65%6e%2d%69%6e%74%65%6e%74',
      'http://127.0.0.1:4500/v1/open-intent/',
      'http://127.0.0.1:4500/v1/open-intent?x=1#fragment',
      'http://127.0.0.1:4500/V1/Open-Intent',
      'http://127.0.0.1:4500/__nimi_desktop_launch__/runtime-config/cloud',
      'http://127.0.0.1:4500/desktop-open/%2e%2e/v1/open-intent',
    ];

    for (const url of reservedUrls) {
      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl'],
        payload: { payload: { url } },
      })).rejects.toMatchObject({
        code: 'forbidden-renderer-access',
        reasonCode: 'electron-oauth-external-url-not-allowed',
      });
    }
    expect(openedUrls).toEqual([]);
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
    const callbackPage = await fetchOkText(`http://127.0.0.1:${port}/oauth/callback?code=code-123&state=state-456`);
    expect(callbackPage).toContain('Authentication Complete!');
    expect(callbackPage).toContain('setTimeout(function(){window.close();}, 3000);');

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
        allowAllStandardShellCommands: true,
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
        allowAllStandardShellCommands: true,
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
        allowAllStandardShellCommands: true,
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

  it('provides a file-backed AI Config store for standard shell hosts', async () => {
    await withTempDir('ai-config-store', async (root) => {
      const store = createNimiElectronFileAIConfigStore({ dataRoot: root });
      const scopeRef = 'app:nimi.zhiyu:zhiyu-agent-home';
      const config = {
        scopeRef: {
          kind: 'app',
          ownerId: 'nimi.zhiyu',
          surfaceId: 'zhiyu-agent-home',
        },
        capabilities: {
          targetRefs: {
            'text.generate': { kind: 'local-runtime', profileBindingId: 'local-runtime:text' },
          },
          selectedParams: {},
        },
        profileOrigin: null,
      };
      const encoded = Buffer.from(scopeRef, 'utf8').toString('base64url');

      await expect(store.get({ scopeRef })).resolves.toBeUndefined();
      await expect(store.set({ scopeRef, config })).resolves.toEqual(config);
      await expect(store.get({ scopeRef })).resolves.toEqual(config);
      await expect(readFile(path.join(root, 'ai-config', `${encoded}.json`), 'utf8')).resolves.toContain(scopeRef);
    });
  });
});
