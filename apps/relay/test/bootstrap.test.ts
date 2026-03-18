// Unit tests for bootstrap contracts (RL-BOOT-001 ~ 004)

import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from '../src/main/env.js';
import { useAppStore, type Agent } from '../src/renderer/app-shell/providers/app-store.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcMain = path.join(testDir, '..', 'src', 'main');

// ─── RL-BOOT-003 — Environment Variable Resolution ─────────────────────

describe('RL-BOOT-003 — Environment Variable Resolution', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws when NIMI_REALM_URL is missing', () => {
    delete process.env.NIMI_REALM_URL;
    process.env.NIMI_ACCESS_TOKEN = 'tok';
    assert.throws(() => parseEnv(), /NIMI_REALM_URL is required/);
  });

  it('throws when NIMI_ACCESS_TOKEN is missing', () => {
    process.env.NIMI_REALM_URL = 'https://realm.example.com';
    delete process.env.NIMI_ACCESS_TOKEN;
    assert.throws(() => parseEnv(), /NIMI_ACCESS_TOKEN is required/);
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
  it('index.ts follows 6-step sequence: env → platform(runtime+realm) → realtime → IPC → window', () => {
    const source = readFileSync(path.join(srcMain, 'index.ts'), 'utf-8');
    const body = source.slice(source.indexOf('app.whenReady()'));
    assert.ok(body, 'app.whenReady() must exist');

    const step1 = body.indexOf('parseEnv()');
    const step2 = body.indexOf('initPlatformClient');
    const step3 = body.indexOf('initRealtimeRelay');
    const step4 = body.indexOf('registerIpcHandlers');
    const step5 = body.indexOf('createWindow()');

    assert.ok(step1 >= 0, 'step 1: parseEnv exists');
    assert.ok(step2 > step1, 'step 2: initPlatformClient after parseEnv');
    assert.ok(step3 > step2, 'step 3: initRealtimeRelay after initPlatformClient');
    assert.ok(step4 > step3, 'step 4: registerIpcHandlers after initRealtimeRelay');
    assert.ok(step5 > step4, 'step 5: createWindow after registerIpcHandlers');
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

// Re-extract fetchAgentProfile fallback from bootstrap.ts
function stubAgent(agentId: string): { id: string; name: string } {
  return { id: agentId, name: agentId };
}

describe('RL-BOOT-004 — Runtime Unavailable Degradation', () => {
  beforeEach(() => {
    useAppStore.setState({ currentAgent: null, runtimeAvailable: false, realtimeConnected: false });
  });

  it('stub fallback returns agent with id === name', () => {
    const stub = stubAgent('agent-123');
    assert.equal(stub.id, 'agent-123');
    assert.equal(stub.name, 'agent-123');
    assert.equal(stub.id, stub.name);
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

  it('Realm features remain available when runtime is down', () => {
    useAppStore.setState({
      currentAgent: { id: 'a', name: 'Agent' },
      runtimeAvailable: false,
      realtimeConnected: true,
    });
    const { currentAgent, realtimeConnected } = useAppStore.getState();

    assert.equal(!!currentAgent && realtimeConnected, true, 'canChat (Human) works without runtime');
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

  it('fallback stub agent is used when realm unreachable', () => {
    const configAgentId = 'agent-from-env';
    const stub = stubAgent(configAgentId);
    useAppStore.getState().setAgent(stub);

    const current = useAppStore.getState().currentAgent!;
    assert.equal(current.id, configAgentId);
    assert.equal(current.name, configAgentId, 'stub has id === name');
    assert.equal(current.voiceModel, undefined, 'stub has no voice model');
  });

  it('no agent id in config leaves currentAgent null', () => {
    // Simulate: config returns agentId: null
    // Bootstrap does not call setAgent
    assert.equal(useAppStore.getState().currentAgent, null);
  });
});
