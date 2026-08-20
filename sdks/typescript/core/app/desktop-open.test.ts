import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NimiDesktopOpenIntentParseError,
  composeNimiDesktopOpenIntentEnvelope,
  parseNimiDesktopOpenIntentEnvelope,
  parseNimiDesktopOpenRendererRequest,
  parseNimiDesktopOpenResult,
  safeParseNimiDesktopOpenIntentEnvelope,
  type NimiDesktopOpenIntentEnvelope,
} from './index';

const acceptedVectors: readonly NimiDesktopOpenIntentEnvelope[] = [
  {
    schemaVersion: 1,
    sourceApp: 'nimi.zhiyu',
    sourceHost: 'desktop-electron-local-app-host',
    requestId: 'desktop-open-20260708-0001',
    intent: { kind: 'open-explore', section: 'personas', productIntent: 'select-partner' },
  },
  {
    schemaVersion: 1,
    sourceApp: 'nimi.test-launcher',
    sourceHost: 'electron-standard-shell',
    requestId: 'desktop-open-20260708-0009',
    intent: { kind: 'open-explore', section: 'worlds', productIntent: 'discover-worlds' },
  },
  {
    schemaVersion: 1,
    sourceApp: 'nimi.test-launcher',
    sourceHost: 'electron-standard-shell',
    requestId: 'desktop-open-20260708-0012',
    intent: { kind: 'open-explore', section: 'worlds' },
  },
  {
    schemaVersion: 1,
    sourceApp: 'nimi.test-launcher',
    sourceHost: 'tauri-standard-shell',
    requestId: 'desktop-open-20260708-0010',
    intent: { kind: 'open-explore', section: 'activity', productIntent: 'view-activity' },
  },
  {
    schemaVersion: 1,
    sourceApp: 'nimi.test-launcher',
    sourceHost: 'electron-standard-shell',
    requestId: 'desktop-open-20260708-0013',
    intent: { kind: 'open-explore', section: 'activity' },
  },
  {
    schemaVersion: 1,
    sourceApp: 'nimi.test-launcher',
    sourceHost: 'electron-standard-shell',
    requestId: 'desktop-open-20260708-0011',
    intent: { kind: 'open-explore', section: 'personas', productIntent: 'discover-personas' },
  },
  {
    schemaVersion: 1,
    sourceApp: 'nimi.test-launcher',
    sourceHost: 'electron-standard-shell',
    requestId: 'desktop-open-20260708-0014',
    intent: { kind: 'open-explore', section: 'personas' },
  },
  {
    schemaVersion: 1,
    sourceApp: 'nimi.test-launcher',
    sourceHost: 'electron-standard-shell',
    requestId: 'desktop-open-20260708-0002',
    intent: { kind: 'open-runtime-config', page: 'cloud', action: 'add-connector' },
  },
  {
    schemaVersion: 1,
    sourceApp: 'nimi.test-launcher',
    sourceHost: 'tauri-standard-shell',
    requestId: 'desktop-open-20260708-0003',
    intent: { kind: 'open-runtime-config', page: 'models', action: 'install-model' },
  },
  {
    schemaVersion: 1,
    sourceApp: 'nimi.test-launcher',
    sourceHost: 'electron-standard-shell',
    requestId: 'desktop-open-20260708-0004',
    intent: { kind: 'open-explore', section: 'personas', query: 'mentor' },
  },
  {
    schemaVersion: 1,
    sourceApp: 'nimi.test-launcher',
    sourceHost: 'electron-standard-shell',
    requestId: 'desktop-open-20260708-0005',
    intent: { kind: 'open-agents', view: 'inventory' },
  },
  {
    schemaVersion: 1,
    sourceApp: 'nimi.test-launcher',
    sourceHost: 'electron-standard-shell',
    requestId: 'desktop-open-20260708-0006',
    intent: { kind: 'open-apps' },
  },
  {
    schemaVersion: 1,
    sourceApp: 'nimi.test-launcher',
    sourceHost: 'electron-standard-shell',
    requestId: 'desktop-open-20260708-0007',
    intent: { kind: 'open-apps', appId: 'nimi.example' },
  },
  {
    schemaVersion: 1,
    sourceApp: 'nimi.example',
    sourceHost: 'electron-standard-shell',
    requestId: 'desktop-open-20260708-0015',
    intent: { kind: 'open-apps', appId: 'nimi.example', section: 'ai-models' },
  },
  {
    schemaVersion: 1,
    sourceApp: 'nimi.test-launcher',
    sourceHost: 'electron-standard-shell',
    requestId: 'desktop-open-20260708-0008',
    intent: { kind: 'open-settings', section: 'profile' },
  },
];
describe('Desktop Open Intent SDK parser', () => {
  it('accepts admitted golden envelopes', () => {
    for (const vector of acceptedVectors) {
      assert.deepEqual(parseNimiDesktopOpenIntentEnvelope(vector), vector);
    }
  });

  it('uses the canonical Nimi app id grammar for sourceApp and appId', () => {
    assert.deepEqual(
      parseNimiDesktopOpenIntentEnvelope({
        ...acceptedVectors[0],
        sourceApp: '1p.nimi9',
        intent: { kind: 'open-apps', appId: '9app.plugin-2' },
      }),
      {
        ...acceptedVectors[0],
        sourceApp: '1p.nimi9',
        intent: { kind: 'open-apps', appId: '9app.plugin-2' },
      },
    );
    assertRejects(
      { ...acceptedVectors[0], sourceApp: 'nimi.bad-' },
      'desktop-open-intent-invalid',
    );
    assertRejects(
      { ...acceptedVectors[0], intent: { kind: 'open-apps', appId: 'nimi..bad' } },
      'desktop-open-intent-invalid',
    );
  });

  it('admits only the exact App AI models section with an appId', () => {
    assert.deepEqual(
      parseNimiDesktopOpenIntentEnvelope({
        ...acceptedVectors[0],
        intent: { kind: 'open-apps', appId: 'nimi.example', section: 'ai-models' },
      }).intent,
      { kind: 'open-apps', appId: 'nimi.example', section: 'ai-models' },
    );
    assertRejects(
      { ...acceptedVectors[0], intent: { kind: 'open-apps', section: 'ai-models' } },
      'desktop-open-intent-invalid',
    );
    assertRejects(
      { ...acceptedVectors[0], intent: { kind: 'open-apps', appId: 'nimi.example', section: 'access' } },
      'desktop-open-target-unsupported',
    );
  });

  it('counts query length by Unicode scalar values', () => {
    const admittedQuery = '😀'.repeat(160);
    assert.deepEqual(
      parseNimiDesktopOpenIntentEnvelope({
        ...acceptedVectors[0],
        intent: { kind: 'open-explore', section: 'personas', query: admittedQuery },
      }).intent,
      { kind: 'open-explore', section: 'personas', query: admittedQuery },
    );

    assertRejects(
      {
        ...acceptedVectors[0],
        intent: { kind: 'open-explore', section: 'personas', query: '😀'.repeat(161) },
      },
      'desktop-open-intent-invalid',
    );
  });

  it('rejects malformed envelopes with stable reason codes', () => {
    assertRejects(
      { ...acceptedVectors[0], sourceApp: '' },
      'desktop-open-intent-invalid',
    );
    assertRejects(
      { ...acceptedVectors[0], sourceHost: 'browser-window' },
      'desktop-open-intent-invalid',
    );
    assertRejects(
      { ...acceptedVectors[0], authorization: 'Bearer token' },
      'desktop-open-intent-invalid',
    );
    assertRejects(
      { ...acceptedVectors[0], requestId: 'bad id' },
      'desktop-open-intent-invalid',
    );
    assertRejects(
      { ...acceptedVectors[0], intent: { kind: 'open-apps', appId: '../escape' } },
      'desktop-open-intent-invalid',
    );
    assertRejects(
      {
        ...acceptedVectors[0],
        intent: {
          kind: 'open-explore',
          section: 'personas',
          query: 'x'.repeat(161),
        },
      },
      'desktop-open-intent-invalid',
    );
    assertRejects(
      { kind: 'open-url', url: 'nimi://explore/personas' },
      'desktop-open-intent-invalid',
    );
  });

  it('rejects unsupported target/productIntent combinations', () => {
    assertRejects(
      {
        ...acceptedVectors[0],
        intent: { kind: 'open-explore', section: 'worlds', productIntent: 'select-partner' },
      },
      'desktop-open-target-unsupported',
    );
    assertRejects(
      {
        ...acceptedVectors[0],
        intent: { kind: 'open-explore', section: 'activity', productIntent: 'discover-personas' },
      },
      'desktop-open-target-unsupported',
    );
    assertRejects(
      {
        ...acceptedVectors[0],
        intent: { kind: 'open-runtime-config', page: 'models', action: 'add-connector' },
      },
      'desktop-open-target-unsupported',
    );
    assertRejects(
      {
        ...acceptedVectors[0],
        intent: { kind: 'open-settings', section: 'developer-tools' },
      },
      'desktop-open-target-unsupported',
    );
    assertRejects(
      {
        ...acceptedVectors[0],
        intent: { kind: 'open-agents', view: 'agent-center' },
      },
      'desktop-open-target-unsupported',
    );
  });

  it('validates renderer-owned payload without accepting host-owned metadata', () => {
    assert.deepEqual(
      parseNimiDesktopOpenRendererRequest({
        requestId: 'desktop-open-20260708-renderer',
        intent: { kind: 'open-explore', section: 'personas', productIntent: 'select-partner' },
      }),
      {
        requestId: 'desktop-open-20260708-renderer',
        intent: { kind: 'open-explore', section: 'personas', productIntent: 'select-partner' },
      },
    );

    assert.deepEqual(
      parseNimiDesktopOpenRendererRequest({
        intent: { kind: 'open-apps', appId: 'nimi.example' },
      }),
      {
        intent: { kind: 'open-apps', appId: 'nimi.example' },
      },
    );

    assertRejectsRendererRequest(
      {
        sourceHost: 'electron-standard-shell',
        intent: { kind: 'open-apps' },
      },
      'desktop-open-intent-invalid',
    );
  });

  it('composes a full envelope only from host-owned metadata', () => {
    assert.deepEqual(
      composeNimiDesktopOpenIntentEnvelope({
        sourceApp: 'nimi.fixture',
        sourceHost: 'dev-fixture',
        requestId: 'desktop-open-20260708-host',
        request: { intent: { kind: 'open-settings', section: 'profile' } },
      }),
      {
        schemaVersion: 1,
        sourceApp: 'nimi.fixture',
        sourceHost: 'dev-fixture',
        requestId: 'desktop-open-20260708-host',
        intent: { kind: 'open-settings', section: 'profile' },
      },
    );
  });

  it('parses Desktop Open result envelopes without admitting undefined reason codes', () => {
    assert.deepEqual(
      parseNimiDesktopOpenResult({
        status: 'accepted',
        confirmation: 'desktop-accepted',
        bridgeId: 'desktop-open-20260708-bridge',
        requestId: 'desktop-open-20260708-result',
        appliedTarget: 'open-apps',
      }),
      {
        status: 'accepted',
        confirmation: 'desktop-accepted',
        bridgeId: 'desktop-open-20260708-bridge',
        requestId: 'desktop-open-20260708-result',
        appliedTarget: 'open-apps',
      },
    );
    assert.deepEqual(
      parseNimiDesktopOpenResult({
        status: 'rejected',
        reasonCode: 'desktop-open-desktop-not-running',
        actionHint: 'open_desktop_first',
      }),
      {
        status: 'rejected',
        reasonCode: 'desktop-open-desktop-not-running',
        actionHint: 'open_desktop_first',
      },
    );
    assert.throws(
      () => parseNimiDesktopOpenResult({
        status: 'rejected',
        reasonCode: 'desktop-open-bridge-unavailable',
        actionHint: 'check_desktop_runtime_bridge',
      }),
      (error) => error instanceof NimiDesktopOpenIntentParseError
        && error.reasonCode === 'desktop-open-intent-invalid',
    );
  });
});

function assertRejects(value: unknown, reasonCode: 'desktop-open-intent-invalid' | 'desktop-open-target-unsupported'): void {
  const parsed = safeParseNimiDesktopOpenIntentEnvelope(value);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.reasonCode, reasonCode);
  }
  assert.throws(
    () => parseNimiDesktopOpenIntentEnvelope(value),
    (error) => error instanceof NimiDesktopOpenIntentParseError && error.reasonCode === reasonCode,
  );
}

function assertRejectsRendererRequest(
  value: unknown,
  reasonCode: 'desktop-open-intent-invalid' | 'desktop-open-target-unsupported',
): void {
  assert.throws(
    () => parseNimiDesktopOpenRendererRequest(value),
    (error) => error instanceof NimiDesktopOpenIntentParseError && error.reasonCode === reasonCode,
  );
}
