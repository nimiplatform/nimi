#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const code = `
import fs from 'node:fs';
import YAML from 'yaml';
import {
  parseNimiDesktopOpenIntentEnvelope,
  NimiDesktopOpenIntentParseError,
  parseNimiDesktopOpenRendererRequest,
} from './core/app/desktop-open.ts';

const vectors = YAML.parse(fs.readFileSync('../../.nimi/spec/platform/kernel/tables/desktop-open-intent-golden-vectors.yaml', 'utf8'));
const failures = [];
const acceptanceRejectedVectorIds = new Map([
  ['unsupported-v1.kind-open-agents-view-agent-center', 'agent-center-target-v1'],
  ['unsupported-v1.kind-open-agents-view-agent-center-local-agent-ref', 'agent-center-local-agent-ref-v1'],
  ['unsupported-v1.kind-open-settings-section-developer-tools', 'developer-tools-settings-target-v1'],
  ['unsupported-v1.kind-open-runtime-config-page-profiles-action-manage-profile', 'runtime-profiles-manage-profile-v1'],
  ['unsupported-v1.kind-open-runtime-config-page-advanced-action-inspect-runtime', 'runtime-advanced-inspect-runtime-v1'],
  ['unsupported-v1.kind-open-explore-section-worlds-product-intent-select-partner', 'invalid-explore-worlds-select-partner-pair'],
  ['unsupported-v1.kind-open-explore-section-activity-product-intent-discover-personas', 'invalid-explore-activity-discover-personas-pair'],
  ['failure.raw-url-payload', 'raw-url-payload'],
  ['failure.unknown-field', 'unknown-field-authorization'],
  ['failure.renderer-provided-source-app', 'renderer-provided-source-app'],
  ['failure.provider-model-credential-fields', 'provider-model-credential-fields'],
]);
const guardInvariants = new Set(acceptanceRejectedVectorIds.keys());
const rejectedVectorIds = new Set((vectors.rejected ?? []).map((vector) => vector.id));
for (const [rowId, vectorId] of acceptanceRejectedVectorIds) {
  if (!rejectedVectorIds.has(vectorId)) {
    failures.push(rowId + ' has no rejected golden vector id ' + vectorId);
  }
}
for (const vector of vectors.accepted ?? []) {
  try {
    parseNimiDesktopOpenIntentEnvelope(vector.envelope);
  } catch (error) {
    failures.push(vector.id + ' should parse but failed: ' + (error?.message ?? error));
  }
}
const rejectedPayloads = {
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
for (const vector of vectors.rejected ?? []) {
  const payload = rejectedPayloads[vector.id];
  if (!payload) {
    failures.push(vector.id + ' has no executable rejected payload');
    continue;
  }
  const parsePayload = vector.id === 'renderer-provided-source-app'
    ? parseNimiDesktopOpenRendererRequest
    : parseNimiDesktopOpenIntentEnvelope;
  try {
    parsePayload(payload);
    failures.push(vector.id + ' should reject but parsed');
  } catch (error) {
    if (!(error instanceof NimiDesktopOpenIntentParseError)) {
      failures.push(vector.id + ' rejected with non-parser error');
    } else if (error.reasonCode !== vector.reasonCode) {
      failures.push(vector.id + ' expected ' + vector.reasonCode + ' got ' + error.reasonCode);
    }
  }
}
if (failures.length) {
  console.error(failures.join('\\n'));
  process.exit(1);
}
console.log('desktop open parser golden vectors passed');
`;

function run(label, command, args) {
  console.log(`[desktop-open-parser-golden-vectors] ${label}`);
  const useWindowsCommandHost = process.platform === 'win32' && command === 'pnpm';
  const executable = useWindowsCommandHost
    ? (process.env.ComSpec || 'cmd.exe')
    : (process.platform === 'win32' && command === 'cargo' ? 'cargo.exe' : command);
  const commandArgs = useWindowsCommandHost
    ? ['/d', '/s', '/c', command, ...args]
    : args;
  const result = spawnSync(executable, commandArgs, { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('sdk parser vectors', 'pnpm', ['--dir', 'sdks/typescript', 'exec', 'tsx', '--eval', code]);
run('kit parser vectors', 'pnpm', [
  '--dir',
  'kit',
  'exec',
  'vitest',
  'run',
  '--config',
  'vitest.config.ts',
  'core/test/desktop-open.test.ts',
  '-t',
  'golden vector',
]);
run('desktop rust parser vectors', 'cargo', [
  'test',
  '--manifest-path',
  'apps/desktop/src-tauri/Cargo.toml',
  'desktop_open_intent_golden_vectors_match_platform_table',
  '--',
  '--nocapture',
]);
run('tauri host parser vectors', 'cargo', [
  'test',
  '--manifest-path',
  'kit/shell/tauri/Cargo.toml',
  'standard_desktop_open_golden_vectors_match_platform_table',
  '--',
  '--nocapture',
]);

console.log('desktop open parser golden vectors passed across sdk, kit, desktop rust, and tauri host');
