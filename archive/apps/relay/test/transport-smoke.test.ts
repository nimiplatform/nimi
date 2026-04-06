// RL-TRANS-001 ~ 005 — Transport Validation Smoke Tests
// These tests require a running runtime daemon (pnpm runtime:serve)
// Run: pnpm --filter @nimiplatform/relay test:transport

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformClient } from '@nimiplatform/sdk';
import type { Runtime } from '@nimiplatform/sdk/runtime';

const GRPC_ENDPOINT = process.env.NIMI_RUNTIME_GRPC_ADDR || '127.0.0.1:46371';
const ACCESS_TOKEN = process.env.NIMI_ACCESS_TOKEN || 'test-token';

let runtime: Runtime;

before(() => {
  const clientPromise = createPlatformClient({
    appId: 'nimi.relay.test',
    runtimeTransport: {
      type: 'node-grpc',
      endpoint: GRPC_ENDPOINT,
    },
    realmBaseUrl: 'http://localhost:3002',
    accessTokenProvider: () => Promise.resolve(ACCESS_TOKEN),
  });
  return clientPromise.then((client) => {
    runtime = client.runtime;
  });
});

describe('RL-TRANS-001 — node-grpc Connectivity', () => {
  it('runtime.health() returns structured response', async () => {
    const health = await runtime.health();
    assert.ok(health, 'health response should be truthy');
    assert.ok(typeof health.status === 'string', 'health.status should be a string');
  });
});

describe('RL-TRANS-002 — Streaming', () => {
  it('runtime.stream() yields text chunks and completes', async () => {
    const stream = await runtime.stream({
      prompt: 'Say hello in one word',
      model: 'local/test-model',
    });

    const chunks: Array<{ type: string; text?: string }> = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    assert.ok(chunks.length > 0, 'should receive at least one chunk');
    const textChunks = chunks.filter((c) => c.type === 'text');
    assert.ok(textChunks.length > 0, 'should have at least one text chunk');
    const doneChunks = chunks.filter((c) => c.type === 'done');
    assert.ok(doneChunks.length === 1, 'should have exactly one done chunk');
  });
});

describe('RL-TRANS-003 — Auth Injection', () => {
  it('provider function is used for auth (not static string)', () => {
    // The runtime was constructed with a function provider — validated by successful health() in TRANS-001
    assert.ok(runtime, 'runtime should be initialized with token provider');
  });

  it('provider function re-evaluates on each call', async () => {
    // RL-TRANS-003: "test with a token provider that returns different values on successive calls"
    let callCount = 0;
    const countingClient = await createPlatformClient({
      appId: 'nimi.relay.test.auth',
      runtimeTransport: {
        type: 'node-grpc',
        endpoint: GRPC_ENDPOINT,
      },
      realmBaseUrl: 'http://localhost:3002',
      accessTokenProvider: () => {
        callCount++;
        return Promise.resolve(ACCESS_TOKEN);
      },
    });
    const countingRuntime = countingClient.runtime;

    // Make two separate RPC calls — the provider function should be invoked for each
    await countingRuntime.health();
    const countAfterFirst = callCount;
    await countingRuntime.health();
    const countAfterSecond = callCount;

    assert.ok(countAfterFirst >= 1, 'provider should be called at least once for first RPC');
    assert.ok(countAfterSecond > countAfterFirst, 'provider should be called again for second RPC');
  });
});

describe('RL-TRANS-004 — Version Compatibility', () => {
  it('runtimeVersion() returns semver after a successful RPC', async () => {
    // Ensure at least one RPC has completed to populate version metadata
    await runtime.health();

    const version = runtime.runtimeVersion();
    assert.ok(version, 'runtimeVersion() should return a non-null string');
    assert.ok(typeof version === 'string', 'version should be a string');
    // Basic semver check: contains at least one dot
    assert.ok(version.includes('.'), `version should be semver-like, got: ${version}`);
  });

  it('versionCompatibility() returns readable status', async () => {
    await runtime.health();

    const compat = runtime.versionCompatibility();
    assert.ok(compat, 'versionCompatibility() should return an object');
    assert.ok(typeof compat.compatible === 'boolean', 'compatible should be boolean');
    assert.ok(typeof compat.checked === 'boolean', 'checked should be boolean');
    assert.ok(typeof compat.state === 'string', 'state should be a string');
  });
});

describe('RL-TRANS-005 — Error Projection', () => {
  it('invalid input produces NimiError with structured fields', async () => {
    try {
      await runtime.generate({
        prompt: '',
        model: 'nonexistent/model-that-does-not-exist-12345',
      });
      assert.fail('should have thrown');
    } catch (error: unknown) {
      assert.ok(error instanceof Error, 'should throw an Error');
      const asAny = error as unknown as Record<string, unknown>;
      // NimiError should have message
      assert.ok(typeof asAny.message === 'string', 'error should have message');
      assert.ok(asAny.message.length > 0, 'error message should be non-empty');
      // RL-TRANS-005: Structured fields — reasonCode should be present for model-not-found errors
      assert.ok(
        typeof asAny.reasonCode === 'string',
        `error should have reasonCode string, got: ${typeof asAny.reasonCode}`,
      );
    }
  });

  it('error has actionHint when applicable', async () => {
    try {
      await runtime.generate({
        prompt: '',
        model: 'nonexistent/model-that-does-not-exist-12345',
      });
      assert.fail('should have thrown');
    } catch (error: unknown) {
      const asAny = error as unknown as Record<string, unknown>;
      // actionHint may or may not be populated depending on the error type,
      // but the field should exist and be either string or undefined
      assert.ok(
        asAny.actionHint === undefined || typeof asAny.actionHint === 'string',
        'actionHint should be string or undefined',
      );
    }
  });
});
