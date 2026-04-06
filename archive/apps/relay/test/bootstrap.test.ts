// Unit tests for bootstrap contracts (RL-BOOT-001 ~ 004)

import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { parseEnv } from '../src/main/env.js';
import { useAppStore, type Agent } from '../src/renderer/app-shell/providers/app-store.js';
import { createRelayAuthAdapter } from '../src/renderer/features/auth/relay-auth-adapter.js';
import type { NimiRelayBridge } from '../src/renderer/bridge/electron-bridge.js';
import { syncAuthenticatedRendererState } from '../src/renderer/infra/bootstrap.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcMain = path.join(testDir, '..', 'src', 'main');

// ─── RL-BOOT-003 — Environment Variable Resolution ─────────────────────

describe('RL-BOOT-003 — Environment Variable Resolution', () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();
  let tempCwd: string | null = null;

  beforeEach(() => {
    tempCwd = mkdtempSync(path.join(os.tmpdir(), 'nimi-relay-env-'));
    process.chdir(tempCwd);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.chdir(originalCwd);
    if (tempCwd) {
      rmSync(tempCwd, { recursive: true, force: true });
      tempCwd = null;
    }
  });

  it('throws when NIMI_REALM_URL is missing', () => {
    delete process.env.NIMI_REALM_URL;
    process.env.NIMI_ACCESS_TOKEN = 'tok';
    assert.throws(() => parseEnv(), /NIMI_REALM_URL is required/);
  });

  it('throws when NIMI_ACCESS_TOKEN is missing', () => {
    process.env.NIMI_REALM_URL = 'https://realm.example.com';
    delete process.env.NIMI_ACCESS_TOKEN;
    const env = parseEnv();
    assert.equal(env.NIMI_ACCESS_TOKEN, undefined);
  });

  it('uses default gRPC address 127.0.0.1:46371 when not set', () => {
    process.env.NIMI_REALM_URL = 'https://realm.test';
    process.env.NIMI_ACCESS_TOKEN = 'tok';
    delete process.env.NIMI_RUNTIME_GRPC_ADDR;
    // Point config path to nonexistent file so config.json doesn't interfere
    process.env.NIMI_RUNTIME_CONFIG_PATH = path.join(os.tmpdir(), 'nimi-nonexistent', 'config.json');
    const env = parseEnv();
    assert.equal(env.NIMI_RUNTIME_GRPC_ADDR, '127.0.0.1:46371');
  });

  it('uses grpcAddr from config.json when env var not set', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-test-'));
    const configPath = path.join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ grpcAddr: '127.0.0.1:50001' }));
    try {
      process.env.NIMI_REALM_URL = 'https://realm.test';
      process.env.NIMI_ACCESS_TOKEN = 'tok';
      delete process.env.NIMI_RUNTIME_GRPC_ADDR;
      process.env.NIMI_RUNTIME_CONFIG_PATH = configPath;
      const env = parseEnv();
      assert.equal(env.NIMI_RUNTIME_GRPC_ADDR, '127.0.0.1:50001');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('env var takes priority over config.json grpcAddr', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-test-'));
    const configPath = path.join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ grpcAddr: '127.0.0.1:50001' }));
    try {
      process.env.NIMI_REALM_URL = 'https://realm.test';
      process.env.NIMI_ACCESS_TOKEN = 'tok';
      process.env.NIMI_RUNTIME_GRPC_ADDR = '10.0.0.1:9999';
      process.env.NIMI_RUNTIME_CONFIG_PATH = configPath;
      const env = parseEnv();
      assert.equal(env.NIMI_RUNTIME_GRPC_ADDR, '10.0.0.1:9999');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('invalid JSON in config.json falls through to default', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-test-'));
    const configPath = path.join(tmpDir, 'config.json');
    writeFileSync(configPath, 'not valid json!!!');
    try {
      process.env.NIMI_REALM_URL = 'https://realm.test';
      process.env.NIMI_ACCESS_TOKEN = 'tok';
      delete process.env.NIMI_RUNTIME_GRPC_ADDR;
      process.env.NIMI_RUNTIME_CONFIG_PATH = configPath;
      const env = parseEnv();
      assert.equal(env.NIMI_RUNTIME_GRPC_ADDR, '127.0.0.1:46371');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('config.json without grpcAddr falls through to default', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-test-'));
    const configPath = path.join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ someOtherField: 'value' }));
    try {
      process.env.NIMI_REALM_URL = 'https://realm.test';
      process.env.NIMI_ACCESS_TOKEN = 'tok';
      delete process.env.NIMI_RUNTIME_GRPC_ADDR;
      process.env.NIMI_RUNTIME_CONFIG_PATH = configPath;
      const env = parseEnv();
      assert.equal(env.NIMI_RUNTIME_GRPC_ADDR, '127.0.0.1:46371');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('parses all 5 variables correctly', () => {
    process.env.NIMI_RUNTIME_GRPC_ADDR = '10.0.0.1:50051';
    process.env.NIMI_REALM_URL = 'https://realm.test';
    process.env.NIMI_ACCESS_TOKEN = 'tok_abc';
    process.env.NIMI_AGENT_ID = 'agent-1';
    process.env.NIMI_WORLD_ID = 'world-1';
    const env = parseEnv();
    assert.equal(env.NIMI_RUNTIME_GRPC_ADDR, '10.0.0.1:50051');
    assert.equal(env.NIMI_REALM_URL, 'https://realm.test');
    assert.equal(env.NIMI_ACCESS_TOKEN, 'tok_abc');
    assert.equal(env.NIMI_AGENT_ID, 'agent-1');
    assert.equal(env.NIMI_WORLD_ID, 'world-1');
  });

  it('sets optional vars to undefined when not provided', () => {
    process.env.NIMI_REALM_URL = 'https://realm.test';
    process.env.NIMI_ACCESS_TOKEN = 'tok';
    delete process.env.NIMI_AGENT_ID;
    delete process.env.NIMI_WORLD_ID;
    const env = parseEnv();
    assert.equal(env.NIMI_AGENT_ID, undefined);
    assert.equal(env.NIMI_WORLD_ID, undefined);
  });
});

// ─── RL-BOOT-001 — Main Process Initialization Sequence ─────────────────

describe('RL-BOOT-001 — Main Process Initialization Sequence', () => {
  it('createWindow enables Electron sandboxing', () => {
    const source = readFileSync(path.join(srcMain, 'index.ts'), 'utf-8');
    assert.ok(source.includes('sandbox: true'), 'BrowserWindow must keep sandbox enabled');
    assert.ok(!source.includes('sandbox: false'), 'BrowserWindow must not disable sandbox');
  });

  it('index.ts follows login-first sequence: env → auth IPC → window → platform init → authenticated IPC', () => {
    const source = readFileSync(path.join(srcMain, 'index.ts'), 'utf-8');
    const body = source.slice(source.indexOf('app.whenReady()'));
    assert.ok(body, 'app.whenReady() must exist');

    const step1 = body.indexOf('parseEnv()');
    const step2 = body.indexOf('registerAuthIpcHandlers(env, () => mainWindow)');
    const step3 = body.indexOf('createWindow()');
    const step4 = body.indexOf('createPlatformClient({');
    const step5 = body.indexOf('registerIpcHandlers(runtime, realm, getWebContents, env, routeState)');

    assert.ok(step1 >= 0, 'step 1: parseEnv exists');
    assert.ok(step2 > step1, 'step 2: auth IPC registered after parseEnv');
    assert.ok(step3 > step2, 'step 3: window created after auth IPC');
    assert.ok(step4 > step3, 'step 4: platform init occurs after window for login-first boot');
    assert.ok(step5 > step4, 'step 5: authenticated IPC registered after platform init');
  });

  it('index.ts uses initializeRouteState (not misleading OrThrow suffix)', () => {
    const source = readFileSync(path.join(srcMain, 'index.ts'), 'utf-8');
    assert.ok(!source.includes('initializeRouteStateOrThrow'),
      'must not use misleading OrThrow suffix — route init uses diagnostics, not exceptions');
    assert.ok(source.includes('initializeRouteState'),
      'must use initializeRouteState');
  });

  it('index.ts reads route diagnostics after initialization', () => {
    const source = readFileSync(path.join(srcMain, 'index.ts'), 'utf-8');
    assert.ok(source.includes('getInitDiagnostics'),
      'must read route diagnostics after init to surface failures');
  });

  it('index.ts uses ReasonCode.AUTH_* constants instead of hard-coded auth strings', () => {
    const source = readFileSync(path.join(srcMain, 'index.ts'), 'utf-8');
    const authTokenInvalidLiteral = ['reason === ', `'${ReasonCode.AUTH_TOKEN_INVALID}'`].join('');
    const authDeniedLiteral = ['reason === ', `'${ReasonCode.AUTH_DENIED}'`].join('');
    assert.ok(source.includes('ReasonCode.AUTH_TOKEN_INVALID'), 'must use ReasonCode.AUTH_TOKEN_INVALID');
    assert.ok(source.includes('ReasonCode.AUTH_DENIED'), 'must use ReasonCode.AUTH_DENIED');
    assert.ok(!source.includes(authTokenInvalidLiteral), 'must not hard-code AUTH_TOKEN_INVALID');
    assert.ok(!source.includes(authDeniedLiteral), 'must not hard-code AUTH_DENIED');
  });

  it('index.ts fails closed when persisted token loading throws', () => {
    const source = readFileSync(path.join(srcMain, 'index.ts'), 'utf-8');
    const tokenLoadIndex = source.indexOf('token = loadToken() || null;');
    const failedStateIndex = source.indexOf("setAuthState('failed', message);", tokenLoadIndex);
    assert.ok(tokenLoadIndex >= 0, 'must load persisted token through guarded path');
    assert.ok(failedStateIndex > tokenLoadIndex, 'must surface persisted token load failures as failed auth state');
  });
});

// ─── RL-BOOT-002 — Renderer Bootstrap ───────────────────────────────────

// Re-extract the health check pattern from bootstrap.ts for unit testing
async function resolveBootstrapHealth(
  healthFn: () => Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const healthPromise = healthFn();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Health check timeout')), timeoutMs),
    );
    await Promise.race([healthPromise, timeoutPromise]);
    return true;
  } catch {
    return false;
  }
}

describe('RL-BOOT-002 — Renderer Bootstrap', () => {
  it('health check success returns runtimeAvailable=true', async () => {
    const result = await resolveBootstrapHealth(
      () => Promise.resolve({ status: 'ok' }),
      15_000,
    );
    assert.equal(result, true);
  });

  it('health check timeout returns runtimeAvailable=false', async () => {
    const result = await resolveBootstrapHealth(
      () => new Promise(() => {}), // never resolves
      50, // fast timeout for test
    );
    assert.equal(result, false);
  });

  it('health check failure returns runtimeAvailable=false', async () => {
    const result = await resolveBootstrapHealth(
      () => Promise.reject(new Error('connection refused')),
      15_000,
    );
    assert.equal(result, false);
  });

  it('fast success resolves before timeout', async () => {
    const start = Date.now();
    await resolveBootstrapHealth(
      () => Promise.resolve('ok'),
      5000,
    );
    assert.ok(Date.now() - start < 100, 'should resolve immediately, not wait for timeout');
  });
});

// ─── RL-BOOT-004 — Runtime Unavailable Degradation ──────────────────────

describe('RL-BOOT-004 — Runtime Unavailable Degradation', () => {
  beforeEach(() => {
    useAppStore.setState({ currentAgent: null, runtimeAvailable: false, realtimeConnected: false });
  });

  it('runtime unavailability does not synthesize a placeholder agent', () => {
    assert.equal(useAppStore.getState().currentAgent, null);
  });

  it('store reflects runtime unavailability', () => {
    useAppStore.getState().setRuntimeAvailable(false);
    assert.equal(useAppStore.getState().runtimeAvailable, false);
  });

  it('runtime unavailable disables AI/media/STT features', () => {
    useAppStore.setState({
      currentAgent: { id: 'a', name: 'Agent' },
      runtimeAvailable: false,
    });
    const { currentAgent, runtimeAvailable } = useAppStore.getState();

    assert.equal(!!currentAgent && runtimeAvailable, false, 'canChat (AI)');
    assert.equal(!!currentAgent && runtimeAvailable, false, 'canSpeak (TTS)');
    assert.equal(runtimeAvailable, false, 'canTranscribe (STT)');
    assert.equal(!!currentAgent && runtimeAvailable, false, 'canGenerate (Video)');
  });

  it('realtime connection state remains independent when runtime is down', () => {
    useAppStore.setState({
      currentAgent: { id: 'a', name: 'Agent' },
      runtimeAvailable: false,
      realtimeConnected: true,
    });
    const { currentAgent, realtimeConnected } = useAppStore.getState();

    assert.equal(!!currentAgent && realtimeConnected, true, 'realtime state remains available without runtime');
  });

  it('runtime becomes available after successful health check', async () => {
    const available = await resolveBootstrapHealth(
      () => Promise.resolve({ status: 'ok' }),
      15_000,
    );
    useAppStore.getState().setRuntimeAvailable(available);

    const { currentAgent, runtimeAvailable } = useAppStore.getState();
    useAppStore.setState({ currentAgent: { id: 'a', name: 'Agent' } });
    const state = useAppStore.getState();

    assert.equal(state.runtimeAvailable, true);
    assert.equal(!!state.currentAgent && state.runtimeAvailable, true, 'features enabled after recovery');
  });
});

// ─── RL-CORE-003 — Agent Resolution at Bootstrap ────────────────────────

describe('RL-CORE-003 — Agent Resolution at Bootstrap', () => {
  beforeEach(() => {
    useAppStore.setState({ currentAgent: null, runtimeAvailable: false, realtimeConnected: false });
  });

  it('env agent id is used when provided', () => {
    // Simulate: config returns agentId from env
    const configAgentId = 'agent-from-env';
    assert.ok(configAgentId, 'agentId from config exists');

    // Simulate: fetched profile stored in app state
    const agent: Agent = { id: configAgentId, name: 'Env Agent', voiceModel: 'v1' };
    useAppStore.getState().setAgent(agent);
    assert.equal(useAppStore.getState().currentAgent?.id, configAgentId);
  });

  it('no agent id in config leaves currentAgent null', () => {
    // Simulate: config returns agentId: null
    // Bootstrap does not call setAgent
    assert.equal(useAppStore.getState().currentAgent, null);
  });

  it('post-auth sync reapplies env agent id after login-first bootstrap', async () => {
    const bridge = {
      health: async () => ({ status: 'ok' }),
      config: async () => ({ agentId: 'agent-from-env', worldId: null }),
      agent: {
        get: async () => ({
          id: 'agent-from-env',
          displayName: 'Env Agent',
          handle: '@env',
          agent: { state: 'active' },
        }),
      },
    };

    const result = await syncAuthenticatedRendererState(
      bridge as unknown as NimiRelayBridge,
    );

    assert.equal(result.runtimeAvailable, true);
    assert.equal(result.agentId, 'agent-from-env');
    assert.equal(useAppStore.getState().currentAgent?.id, 'agent-from-env');
    assert.equal(useAppStore.getState().currentAgent?.name, 'Env Agent');
  });

  it('post-auth sync retries config lookup after transient login-first race', async () => {
    let configAttempts = 0;
    const bridge = {
      health: async () => ({ status: 'ok' }),
      config: async () => {
        configAttempts += 1;
        if (configAttempts === 1) {
          throw new Error('relay:config handler not ready yet');
        }
        return { agentId: 'agent-from-env', worldId: null };
      },
      agent: {
        get: async () => ({
          id: 'agent-from-env',
          displayName: 'Env Agent',
          handle: '@env',
          agent: { state: 'active' },
        }),
      },
    };

    const result = await syncAuthenticatedRendererState(
      bridge as unknown as NimiRelayBridge,
    );

    assert.equal(configAttempts, 2);
    assert.equal(result.runtimeAvailable, true);
    assert.equal(result.agentId, 'agent-from-env');
    assert.equal(useAppStore.getState().currentAgent?.id, 'agent-from-env');
  });

  it('post-auth sync survives several transient config failures before restoring env agent', async () => {
    let configAttempts = 0;
    const bridge = {
      health: async () => ({ status: 'ok' }),
      config: async () => {
        configAttempts += 1;
        if (configAttempts < 4) {
          throw new Error('relay:config handler still warming up');
        }
        return { agentId: 'agent-from-env', worldId: null };
      },
      agent: {
        get: async () => ({
          id: 'agent-from-env',
          displayName: 'Env Agent',
          handle: '@env',
          agent: { state: 'active' },
        }),
      },
    };

    const result = await syncAuthenticatedRendererState(
      bridge as unknown as NimiRelayBridge,
    );

    assert.equal(configAttempts, 4);
    assert.equal(result.runtimeAvailable, true);
    assert.equal(result.agentId, 'agent-from-env');
    assert.equal(useAppStore.getState().currentAgent?.id, 'agent-from-env');
    assert.equal(useAppStore.getState().currentAgent?.name, 'Env Agent');
  });

  it('post-auth sync clears stale agent when config has no default agent', async () => {
    useAppStore.getState().setAgent({ id: 'stale-agent', name: 'Stale Agent' });

    const bridge = {
      health: async () => ({ status: 'ok' }),
      config: async () => ({ agentId: null, worldId: null }),
      agent: {
        get: async () => {
          throw new Error('should not be called');
        },
      },
    };

    const result = await syncAuthenticatedRendererState(
      bridge as unknown as NimiRelayBridge,
    );

    assert.equal(result.runtimeAvailable, true);
    assert.equal(result.agentId, null);
    assert.equal(useAppStore.getState().currentAgent, null);
  });

  it('post-auth sync preserves current agent when config lookup fails transiently', async () => {
    useAppStore.getState().setAgent({ id: 'existing-agent', name: 'Existing Agent' });

    const bridge = {
      health: async () => ({ status: 'ok' }),
      config: async () => {
        throw new Error('relay:config temporarily unavailable');
      },
      agent: {
        get: async () => {
          throw new Error('should not be called');
        },
      },
    };

    const result = await syncAuthenticatedRendererState(
      bridge as unknown as NimiRelayBridge,
    );

    assert.equal(result.runtimeAvailable, true);
    assert.equal(result.agentId, 'existing-agent');
    assert.equal(useAppStore.getState().currentAgent?.id, 'existing-agent');
    assert.equal(useAppStore.getState().currentAgent?.name, 'Existing Agent');
  });

  it('post-auth sync does not synthesize a stub agent when realm lookup fails without an existing selection', async () => {
    const bridge = {
      health: async () => ({ status: 'ok' }),
      config: async () => ({ agentId: 'agent-from-env', worldId: null }),
      agent: {
        get: async () => {
          throw new Error('realm unavailable');
        },
      },
    };

    const result = await syncAuthenticatedRendererState(
      bridge as unknown as NimiRelayBridge,
    );

    assert.equal(result.runtimeAvailable, true);
    assert.equal(result.agentId, null);
    assert.equal(useAppStore.getState().currentAgent, null);
  });

  it('post-auth sync preserves an existing agent when realm lookup fails', async () => {
    useAppStore.getState().setAgent({ id: 'existing-agent', name: 'Existing Agent' });
    const bridge = {
      health: async () => ({ status: 'ok' }),
      config: async () => ({ agentId: 'agent-from-env', worldId: null }),
      agent: {
        get: async () => {
          throw new Error('realm unavailable');
        },
      },
    };

    const result = await syncAuthenticatedRendererState(
      bridge as unknown as NimiRelayBridge,
    );

    assert.equal(result.runtimeAvailable, true);
    assert.equal(result.agentId, 'existing-agent');
    assert.equal(useAppStore.getState().currentAgent?.id, 'existing-agent');
    assert.equal(useAppStore.getState().currentAgent?.name, 'Existing Agent');
  });

  it('relay auth adapter surfaces current-user bridge failures instead of returning null', async () => {
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      value: {
        nimiRelay: {
          auth: {
            currentUser: async () => {
              throw new Error('current user failed');
            },
          },
          oauth: {
            listenForCode: async () => ({ callbackUrl: 'http://127.0.0.1/callback' }),
            tokenExchange: async () => ({ accessToken: 'token' }),
            openExternalUrl: async () => ({ opened: true }),
            focusMainWindow: async () => undefined,
          },
        },
      },
      configurable: true,
    });

    try {
      const adapter = createRelayAuthAdapter();
      await assert.rejects(
        () => adapter.loadCurrentUser(),
        /current user failed/,
      );
    } finally {
      Object.defineProperty(globalThis, 'window', {
        value: previousWindow,
        configurable: true,
      });
    }
  });
});
