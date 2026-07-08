import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  NimiDesktopOpenIntentParseError,
  composeNimiDesktopOpenIntentEnvelope,
  parseNimiDesktopOpenIntentEnvelope,
  parseNimiDesktopOpenRendererRequest,
  parseNimiDesktopOpenResult,
} from '../src/desktop-open.js';

type GoldenVectorTable = {
  readonly accepted?: readonly { readonly id: string; readonly envelope: unknown }[];
  readonly rejected?: readonly { readonly id: string; readonly reasonCode: string }[];
};

const goldenVectorPath = path.resolve(
  process.cwd(),
  '../.nimi/spec/platform/kernel/tables/desktop-open-intent-golden-vectors.yaml',
);

const rejectedGoldenPayloads: Record<string, unknown> = {
  'source-app-missing': { schemaVersion: 1, sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-1', intent: { kind: 'open-settings', section: 'profile' } },
  'unknown-field-authorization': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-2', authorization: 'secret', intent: { kind: 'open-settings', section: 'profile' } },
  'unknown-target': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-3', intent: { kind: 'open-developer-tools' } },
  'invalid-runtime-action-page-pair': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-4', intent: { kind: 'open-runtime-config', page: 'cloud', action: 'install-model' } },
  'invalid-explore-worlds-select-partner-pair': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-5', intent: { kind: 'open-explore', section: 'worlds', productIntent: 'select-partner' } },
  'invalid-explore-activity-discover-personas-pair': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-6', intent: { kind: 'open-explore', section: 'activity', productIntent: 'discover-personas' } },
  'invalid-source-host': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'unknown-shell', requestId: 'desktop-open-reject-7', intent: { kind: 'open-settings', section: 'profile' } },
  'invalid-request-id': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open--reject-7b', intent: { kind: 'open-settings', section: 'profile' } },
  'invalid-app-id': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-8', intent: { kind: 'open-apps', appId: 'Nimi.Bad' } },
  'invalid-query-too-long': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-9', intent: { kind: 'open-explore', section: 'personas', query: 'x'.repeat(161) } },
  'developer-tools-settings-target-v1': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-10', intent: { kind: 'open-settings', section: 'developer-tools' } },
  'agent-center-target-v1': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-11', intent: { kind: 'open-agents', view: 'agent-center' } },
  'agent-center-local-agent-ref-v1': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-14', intent: { kind: 'open-agents', view: 'agent-center', localAgentRef: 'agent-local-1' } },
  'runtime-profiles-manage-profile-v1': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-15', intent: { kind: 'open-runtime-config', page: 'profiles', action: 'manage-profile' } },
  'runtime-advanced-inspect-runtime-v1': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-16', intent: { kind: 'open-runtime-config', page: 'advanced', action: 'inspect-runtime' } },
  'os-scheme-url': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-12', intent: { kind: 'open-url', url: 'nimi-desktop://runtime-config/cloud' } },
  'raw-url-payload': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-13', url: 'http://127.0.0.1:1/v1/open-intent' },
  'renderer-provided-source-app': { sourceApp: 'nimi.spoof', intent: { kind: 'open-apps' } },
  'provider-model-credential-fields': { schemaVersion: 1, sourceApp: 'nimi.test', sourceHost: 'electron-standard-shell', requestId: 'desktop-open-reject-17', intent: { kind: 'open-runtime-config', page: 'models', action: 'install-model', providerApiKey: 'secret' } },
};

function readGoldenVectors(): GoldenVectorTable {
  return YAML.parse(fs.readFileSync(goldenVectorPath, 'utf8')) as GoldenVectorTable;
}

describe('kit core desktop-open', () => {
  it('reuses the SDK parser for renderer request validation', () => {
    expect(parseNimiDesktopOpenRendererRequest({
      requestId: 'desktop-open-20260708-kit',
      intent: { kind: 'open-explore', section: 'personas', productIntent: 'select-partner' },
    })).toEqual({
      requestId: 'desktop-open-20260708-kit',
      intent: { kind: 'open-explore', section: 'personas', productIntent: 'select-partner' },
    });

    expect(() => parseNimiDesktopOpenRendererRequest({
      sourceHost: 'electron-standard-shell',
      intent: { kind: 'open-apps' },
    })).toThrow(/unsupported field/u);
  });

  it('composes host-stamped envelopes without renderer-owned host metadata', () => {
    expect(composeNimiDesktopOpenIntentEnvelope({
      sourceApp: 'nimi.fixture',
      sourceHost: 'dev-fixture',
      requestId: 'desktop-open-20260708-kit-host',
      request: { intent: { kind: 'open-runtime-config', page: 'cloud', action: 'add-connector' } },
    })).toEqual({
      schemaVersion: 1,
      sourceApp: 'nimi.fixture',
      sourceHost: 'dev-fixture',
      requestId: 'desktop-open-20260708-kit-host',
      intent: { kind: 'open-runtime-config', page: 'cloud', action: 'add-connector' },
    });
  });

  it('rejects non-admitted result reason codes', () => {
    expect(() => parseNimiDesktopOpenResult({
      status: 'rejected',
      reasonCode: 'desktop-open-bridge-unavailable',
      actionHint: 'check_desktop_runtime_bridge',
    })).toThrow(/reasonCode is not admitted/u);
  });

  it('matches every Desktop Open golden vector id through the Kit parser contract', () => {
    const vectors = readGoldenVectors();

    for (const vector of vectors.accepted ?? []) {
      expect(parseNimiDesktopOpenIntentEnvelope(vector.envelope), vector.id).toEqual(vector.envelope);
    }

    for (const vector of vectors.rejected ?? []) {
      const payload = rejectedGoldenPayloads[vector.id];
      expect(payload, `${vector.id} has executable Kit coverage`).toBeDefined();
      const parsePayload = vector.id === 'renderer-provided-source-app'
        ? parseNimiDesktopOpenRendererRequest
        : parseNimiDesktopOpenIntentEnvelope;
      try {
        parsePayload(payload);
        throw new Error(`${vector.id} should reject but parsed`);
      } catch (error) {
        expect(error, `${vector.id} uses the Desktop Open parser error type`).toBeInstanceOf(NimiDesktopOpenIntentParseError);
        expect((error as NimiDesktopOpenIntentParseError).reasonCode, vector.id).toBe(vector.reasonCode);
      }
    }
  });
});
