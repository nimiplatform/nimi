import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const invokeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/invoke.ts'),
  'utf8',
);

const phase1CriticalCodes = [
  'AI_PROVIDER_TIMEOUT',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_PROVIDER_RATE_LIMITED',
  'AI_PROVIDER_INTERNAL',
  'AI_PROVIDER_ENDPOINT_FORBIDDEN',
  'AI_PROVIDER_AUTH_FAILED',
  'AI_STREAM_BROKEN',
  'AI_CONNECTOR_CREDENTIAL_MISSING',
  'AI_CONNECTOR_DISABLED',
  'AI_CONNECTOR_NOT_FOUND',
  'AI_CONNECTOR_INVALID',
  'AI_CONNECTOR_IMMUTABLE',
  'AI_CONNECTOR_LIMIT_EXCEEDED',
  'AI_MODEL_NOT_FOUND',
  'AI_MODALITY_NOT_SUPPORTED',
  'AI_MODEL_PROVIDER_MISMATCH',
  'AI_MEDIA_IDEMPOTENCY_CONFLICT',
  'AI_MEDIA_JOB_NOT_FOUND',
  'AI_MEDIA_SPEC_INVALID',
  'AI_MEDIA_OPTION_UNSUPPORTED',
  'AI_MEDIA_JOB_NOT_CANCELLABLE',
  'AI_LOCAL_MODEL_UNAVAILABLE',
  'AI_LOCAL_MODEL_PROFILE_MISSING',
  'AI_LOCAL_ASSET_ALREADY_INSTALLED',
  'AI_LOCAL_ENDPOINT_REQUIRED',
  'AI_LOCAL_TEMPLATE_NOT_FOUND',
  'AI_LOCAL_MANIFEST_INVALID',
  'AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED',
  'AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED',
  'AI_LOCAL_SPEECH_ENV_INIT_FAILED',
  'AI_LOCAL_SPEECH_HOST_INIT_FAILED',
  'AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED',
  'AI_LOCAL_SPEECH_BUNDLE_DEGRADED',
  'AUTH_TOKEN_INVALID',
  'SESSION_EXPIRED',
  'APP_MODE_DOMAIN_FORBIDDEN',
  'APP_MODE_SCOPE_FORBIDDEN',
  'APP_MODE_MANIFEST_INVALID',
  'RUNTIME_UNAVAILABLE',
  'RUNTIME_BRIDGE_DAEMON_UNAVAILABLE',
];

for (const code of phase1CriticalCodes) {
  test(`D-ERR-007: Phase 1 ReasonCode '${code}' is mapped in BRIDGE_ERROR_CODE_MAP`, () => {
    assert.ok(
      invokeSource.includes(code),
      `BRIDGE_ERROR_CODE_MAP must contain '${code}'`,
    );
  });
}

test('D-ERR-007: Phase 2 codes excluded (GRANT_*, WORKFLOW_*, APP_MESSAGE_*, SCRIPT_*)', () => {
  const phase2Patterns = ['GRANT_', 'WORKFLOW_', 'APP_MESSAGE_', 'SCRIPT_'];
  for (const prefix of phase2Patterns) {
    const mapSection = invokeSource.match(/BRIDGE_ERROR_CODE_MAP[^}]+}/s)?.[0] || '';
    assert.ok(
      !mapSection.includes(prefix),
      `BRIDGE_ERROR_CODE_MAP should not include Phase 2 prefix '${prefix}'`,
    );
  }
});
