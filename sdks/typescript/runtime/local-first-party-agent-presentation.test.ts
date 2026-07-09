import assert from 'node:assert/strict';
import test from 'node:test';

import * as runtimeSdk from './index';
import type {
  NimiLocalFirstPartyAgentPresentationClient,
  NimiLocalFirstPartyAgentPresentationClientInput,
} from './local-first-party-agent-presentation';

const ACCOUNT_CALLER = runtimeSdk.createNimiLocalFirstPartyRuntimeAccountCaller({
  appId: 'nimi.app',
  appInstanceId: 'nimi.app.instance',
  deviceId: 'device-1',
});

if (false) {
  const client: NimiLocalFirstPartyAgentPresentationClient =
    runtimeSdk.createNimiLocalFirstPartyAgentPresentationClient({
      mode: 'first-party-local-app',
      appId: 'nimi.app',
      accountCaller: ACCOUNT_CALLER,
    });
  // @ts-expect-error Narrow presentation capability does not expose Runtime.
  void client.runtime;
  // @ts-expect-error Narrow presentation capability does not expose account custody.
  void client.accountRuntime;
  // @ts-expect-error Narrow presentation capability does not expose AI.
  void client.ai;
  // @ts-expect-error Narrow presentation capability does not expose mixed Runtime streams.
  void client.streamScenario;

  const invalidInput: NimiLocalFirstPartyAgentPresentationClientInput = {
    mode: 'first-party-local-app',
    appId: 'nimi.app',
    accountCaller: ACCOUNT_CALLER,
    // @ts-expect-error Narrow construction does not admit caller-controlled transport.
    transport: { unary() {}, serverStream() {} },
  };
  void invalidInput;
}

test('local first-party public construction is presentation-only', () => {
  const exports = runtimeSdk as unknown as Record<string, unknown>;
  assert.equal(typeof exports.createNimiLocalFirstPartyAgentPresentationClient, 'function');
  assert.equal(exports.createNimiLocalFirstPartyRuntimePlatformClient, undefined);

  const client = runtimeSdk.createNimiLocalFirstPartyAgentPresentationClient({
    mode: 'first-party-local-app',
    appId: 'nimi.app',
    accountCaller: ACCOUNT_CALLER,
  });
  assert.deepEqual(Object.keys(client).sort(), [
    'getPresentationProfile',
    'mode',
    'patchPresentationProfile',
    'setPresentationProfile',
  ]);
  for (const forbidden of ['runtime', 'accountRuntime', 'domains', 'ai', 'streamScenario']) {
    assert.equal(forbidden in client, false, forbidden);
  }
});

test('presentation-only construction rejects caller-controlled transports and bridges', () => {
  const factory = (runtimeSdk as unknown as Record<string, unknown>)
    .createNimiLocalFirstPartyAgentPresentationClient as (input: unknown) => unknown;

  for (const forbidden of [
    { bridge: { unary() {}, serverStream() {} } },
    { transport: { unary() {}, serverStream() {} } },
    { authorization: 'Bearer forged' },
    { getRuntimeAccountAccessToken: async () => 'forged' },
    { subjectUserId: 'forged-user' },
    { metadata: { idempotencyKey: 'caller-key' } },
    { idempotencyKey: 'caller-key' },
    { callOptions: { metadata: { 'x-nimi-idempotency-key': 'caller-key' } } },
    { appVersion: 'caller-version' },
    { capabilities: ['runtime.agent.write'] },
    { tls: { enabled: true, bridge: { unary() {}, serverStream() {} } } },
  ]) {
    assert.throws(() => factory({
      mode: 'first-party-local-app',
      appId: 'nimi.app',
      accountCaller: ACCOUNT_CALLER,
      ...forbidden,
    }), /caller-controlled|native node-grpc|does not admit|TLS options/iu);
  }
});

test('presentation-only construction rejects malformed account caller snapshots with a typed error', () => {
  for (const accountCaller of [
    { ...ACCOUNT_CALLER, scopes: undefined },
    { ...ACCOUNT_CALLER, scopes: [' runtime.agent.write'] },
    { ...ACCOUNT_CALLER, launchHostId: 42 },
  ]) {
    assert.throws(() => runtimeSdk.createNimiLocalFirstPartyAgentPresentationClient({
      mode: 'first-party-local-app',
      appId: 'nimi.app',
      accountCaller: accountCaller as never,
    }), (error: unknown) =>
      (error as { readonly reasonCode?: string }).reasonCode === 'SDK_RUNTIME_ACCOUNT_CALLER_INVALID');
  }
});

test('presentation-only construction rejects remote plaintext before account access', () => {
  const factory = (runtimeSdk as unknown as Record<string, unknown>)
    .createNimiLocalFirstPartyAgentPresentationClient as (input: unknown) => unknown;
  assert.throws(() => factory({
    mode: 'first-party-local-app',
    appId: 'nimi.app',
    accountCaller: ACCOUNT_CALLER,
    endpoint: 'runtime.example.com:46371',
  }), (error: unknown) => {
    const shaped = error as { code?: string; actionHint?: string };
    return shaped.code === 'SDK_TRANSPORT_INVALID'
      && shaped.actionHint === 'enable_tls_or_use_loopback_for_runtime_bearer';
  });
});
