import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  NimiManagedConnectorCredentialAcquisitionHostInput,
} from '@nimiplatform/sdk/runtime';

import {
  createConnectorOAuthController,
} from '../src/shell/renderer/features/runtime-config/runtime-config-connector-oauth-session.js';
import {
  normalizeConnectorV11,
} from '../src/shell/renderer/features/runtime-config/runtime-config-state-types.js';

const CONNECTOR = normalizeConnectorV11({
  id: 'connector-codex',
  label: 'Codex account',
  vendor: 'openai',
  provider: 'openai_codex',
  authMode: 'oauth_managed',
  providerAuthProfile: 'openai_codex',
  endpoint: 'https://chatgpt.com/backend-api/codex',
  scope: 'user',
  hasCredential: false,
  isDraft: true,
});

type FakeHost = {
  readonly pendingCalls: readonly NimiManagedConnectorCredentialAcquisitionHostInput[];
  readonly resolveNext: (connectorId?: string) => void;
  readonly host: {
    acquireManagedConnectorCredential(input: NimiManagedConnectorCredentialAcquisitionHostInput): Promise<unknown>;
  };
};

function createFakeHost(): FakeHost {
  const pendingCalls: NimiManagedConnectorCredentialAcquisitionHostInput[] = [];
  let resolver: ((value: unknown) => void) | null = null;
  return {
    pendingCalls,
    resolveNext(connectorId = 'conn-realized') {
      resolver?.({
        profileId: 'openai_codex',
        providerAuthProfile: 'openai_codex',
        connectorId,
      });
    },
    host: {
      acquireManagedConnectorCredential(input) {
        pendingCalls.push(input);
        return new Promise((resolve) => {
          resolver = resolve;
        });
      },
    },
  };
}

test('a stale OAuth completion after invalidation never reaches onAcquired', async () => {
  const fake = createFakeHost();
  const acquired: string[] = [];
  const controller = createConnectorOAuthController({
    host: fake.host,
    findConnector: () => CONNECTOR,
    onAcquired: (result) => {
      acquired.push(result.connectorId);
    },
  });

  const inFlight = controller.start(CONNECTOR);
  assert.equal(controller.getState().busy, true);
  controller.invalidate('page switched');
  assert.equal(controller.getState().busy, false);

  fake.resolveNext('conn-stale');
  await inFlight;
  assert.deepEqual(acquired, []);
});

test('a connector snapshot change mid-flight rejects the completion', async () => {
  const fake = createFakeHost();
  const acquired: string[] = [];
  const changed = { ...CONNECTOR, label: 'renamed mid-flight' };
  const controller = createConnectorOAuthController({
    host: fake.host,
    findConnector: () => changed,
    onAcquired: (result) => {
      acquired.push(result.connectorId);
    },
  });

  const inFlight = controller.start(CONNECTOR);
  fake.resolveNext('conn-stale');
  await inFlight;
  assert.deepEqual(acquired, []);
});

test('a current completion reports exactly once with pending state in between', async () => {
  const fake = createFakeHost();
  const acquired: string[] = [];
  const pendingSeen: string[] = [];
  const controller = createConnectorOAuthController({
    host: fake.host,
    findConnector: () => CONNECTOR,
    onAcquired: (result) => {
      acquired.push(result.connectorId);
    },
  });
  controller.subscribe(() => {
    const pending = controller.getState().pending;
    if (pending) pendingSeen.push(pending.userCode);
  });

  const inFlight = controller.start(CONNECTOR);
  const call = fake.pendingCalls[0]!;
  call.onPending?.({ userCode: 'ABCD-1234', verificationUrl: 'https://example.test', expiresInSeconds: 600, pollIntervalSeconds: 2 });
  assert.deepEqual(pendingSeen, ['ABCD-1234']);
  fake.resolveNext('conn-real');
  await inFlight;
  assert.deepEqual(acquired, ['conn-real']);
  assert.equal(controller.getState().busy, false);
  assert.equal(controller.getState().pending, null);
});

test('dispose blocks a later completion from writing', async () => {
  const fake = createFakeHost();
  const acquired: string[] = [];
  const controller = createConnectorOAuthController({
    host: fake.host,
    findConnector: () => CONNECTOR,
    onAcquired: (result) => {
      acquired.push(result.connectorId);
    },
  });
  const inFlight = controller.start(CONNECTOR);
  controller.dispose();
  fake.resolveNext('conn-after-close');
  await inFlight;
  assert.deepEqual(acquired, []);
});
