import { describe, expect, it } from 'vitest';
import {
  createElectronCapabilityUnavailableError,
  createElectronExternalDaemonRequiredError,
  createNimiElectronStandardApplicationMenuTemplate,
  exchangeElectronOauthTokenInHost,
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
} from './electron-shell-test-utils.js';

describe('registerNimiElectronRuntimeBridge', () => {
  it('does not project environment Realm authority or access tokens through Electron runtime defaults', async () => {
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
          realmBaseUrl: 'https://realm.nimi.ai',
          realtimeUrl: '',
          jwksUrl: 'https://realm.nimi.ai/api/auth/jwks',
          revocationUrl: 'https://realm.nimi.ai/api/auth/sessions/introspect',
          jwtIssuer: 'https://realm.nimi.ai',
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

  it('projects fixed local Realm authority for a host-owned local-development profile', async () => {
    await withEnvVars({
      NIMI_REALM_URL: 'https://realm.nimi.ai',
      NIMI_REALM_JWKS_URL: 'https://evil.example.test/jwks',
      NIMI_REALM_REVOCATION_URL: 'https://evil.example.test/introspect',
      NIMI_REALM_JWT_ISSUER: 'https://evil.example.test',
    }, async () => {
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.desktop',
        runtimeEndpoint: 'protected-desktop-control',
        runtimeDeploymentProfile: 'local-development',
        allowedOrigins: ['http://127.0.0.1:1420'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent('http://127.0.0.1:1420').event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['runtime-defaults.get'],
        payload: {},
      })).resolves.toEqual({
        realm: {
          realmBaseUrl: 'http://127.0.0.1:3002',
          realtimeUrl: '',
          jwksUrl: 'http://127.0.0.1:3002/api/auth/jwks',
          revocationUrl: 'http://127.0.0.1:3002/api/auth/sessions/introspect',
          jwtIssuer: 'http://127.0.0.1:3002',
          jwtAudience: 'nimi-runtime',
        },
        runtime: {
          targetType: '',
          targetAccountId: '',
          agentId: '',
          worldId: '',
          userConfirmedUpload: false,
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

  it('keeps fixed-provider OAuth token exchange inside the native host', async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const result = await exchangeElectronOauthTokenInHost({
      provider: 'CODEX',
      clientId: 'client-1',
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'http://127.0.0.1:4100/oauth/callback',
    }, async (url, init) => {
      requests.push({ url, body: init.body });
      return new Response(JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    expect(result).toMatchObject({
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
      },
    });
    const { event } = createInvokeEvent();

    await expect(invokeBridge(ipcMain, event, {
      command: 'nimi.shell.oauth.tokenExchange',
      payload: {
        payload: {
          provider: 'CODEX',
          clientId: 'client-1',
          code: 'code-1',
          codeVerifier: 'verifier-1',
          redirectUri: 'http://127.0.0.1:4100/oauth/callback',
        },
      },
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'unsupported-electron-shell-command',
    });
    expect(requests).toHaveLength(1);
  });

  it('propagates cancellation into the native-host OAuth token exchange request', async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const exchange = exchangeElectronOauthTokenInHost({
      provider: 'CODEX',
      clientId: 'client-1',
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'http://127.0.0.1:4100/oauth/callback',
    }, async (_url, init) => {
      observedSignal = init.signal;
      return new Promise<never>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    }, controller.signal);
    controller.abort(new DOMException('cancel token exchange', 'AbortError'));
    await expect(exchange).rejects.toMatchObject({ name: 'AbortError' });
    expect(observedSignal).toBe(controller.signal);
  });

  it('never projects token-exchange response bodies through native-host errors', async () => {
    const secret = 'managed-access-token-should-remain-host-private';
    const responses = [
      new Response(secret, { status: 200 }),
      new Response(JSON.stringify({ error_description: secret, ordinary: secret }), { status: 401 }),
    ];
    for (const response of responses) {
      let captured: unknown;
      try {
        await exchangeElectronOauthTokenInHost({
          provider: 'CODEX',
          clientId: 'client-1',
          code: 'code-1',
          codeVerifier: 'verifier-1',
          redirectUri: 'http://127.0.0.1:4100/oauth/callback',
        }, async () => response);
      } catch (error) {
        captured = error;
      }
      expect(captured).toMatchObject({
        reasonCode: response.ok
          ? 'electron-oauth-token-response-invalid-json'
          : 'electron-oauth-token-exchange-http-failed',
      });
      const projected = captured as { message?: string; details?: unknown };
      expect(`${projected.message ?? ''} ${JSON.stringify(projected.details ?? {})}`).not.toContain(secret);
    }
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
      payload: { projectionId: 'missing' },
    })).rejects.toMatchObject({
      code: 'not-found',
      reasonCode: 'electron-platform-projection-not-found',
    });
  });

});
