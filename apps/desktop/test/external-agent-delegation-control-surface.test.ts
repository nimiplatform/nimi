import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const desktopDir = path.resolve(import.meta.dirname, '..');
const repoDir = path.resolve(desktopDir, '../..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoDir, relativePath), 'utf8');
}

test('desktop does not keep a Tauri External Agent gateway or token ledger', () => {
  assert.equal(existsSync(path.join(desktopDir, 'src-tauri/src/external_agent_gateway')), false);

  const bootstrapSource = readDesktopFile('src-tauri/src/main_parts/app_bootstrap.rs');
  const mainSource = readDesktopFile('src-tauri/src/main.rs');

  assert.doesNotMatch(bootstrapSource, /external_agent_gateway/);
  assert.doesNotMatch(bootstrapSource, /external_agent_issue_token/);
  assert.doesNotMatch(bootstrapSource, /external_agent_revoke_token/);
  assert.doesNotMatch(bootstrapSource, /external_agent_list_tokens/);
  assert.doesNotMatch(bootstrapSource, /external_agent_gateway_status/);
  assert.doesNotMatch(mainSource, /mod external_agent_gateway/);
});

test('external agent renderer bridge does not subscribe to action request bypass events', () => {
  assert.equal(
    existsSync(path.join(desktopDir, 'src/runtime/external-agent/index.ts')),
    false,
  );
  assert.equal(
    existsSync(path.join(desktopDir, 'src/shell/renderer/bridge/runtime-bridge/external-agent.ts')),
    false,
  );

  const desktopSource = readRepoFile('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-external-agent-access.tsx');
  assert.doesNotMatch(desktopSource, /external-agent:\/\/action-request/);
  assert.doesNotMatch(desktopSource, /listenTauri/);
  assert.doesNotMatch(desktopSource, /hookRuntime\.(dryRunAction|verifyAction|commitAction)/);
});

test('external agent gateway status is Runtime-owned and fail-closed until registry exists', () => {
  const runtimeServiceSource = readRepoFile('runtime/internal/services/externalagent/service.go');
  const runtimeServerSource = readRepoFile('runtime/internal/grpcserver/server.go');

  assert.match(runtimeServiceSource, /GetExternalAgentGatewayStatus/);
  assert.match(runtimeServiceSource, /Enabled:\s*false/);
  assert.match(runtimeServiceSource, /EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY/);
  assert.match(runtimeServerSource, /RegisterRuntimeExternalAgentServiceServer/);
});

test('delegated capability panel preserves gateway firewall and runtime diagnostics fields', () => {
  const panelSource = readDesktopFile('src/shell/renderer/features/runtime-config/runtime-config-delegated-capability-panel.tsx');
  for (const field of [
    'gatewayEvidenceId',
    'firewallInputId',
    'firewallVerdict',
    'runtimeDecision',
    'reasonCode',
  ]) {
    assert.match(panelSource, new RegExp(field));
  }
});

test('delegated capability panel does not seed Runtime provider profile truth', () => {
  const panelSource = readDesktopFile('src/shell/renderer/features/runtime-config/runtime-config-delegated-capability-panel.tsx');
  assert.doesNotMatch(panelSource, /providerProfileId:\s*'local-mcp'/);
  assert.doesNotMatch(panelSource, /transportRef:\s*'runtime-transport:\/\/local-mcp'/);
  assert.doesNotMatch(panelSource, /command:\s*'nimi-local-mcp'/);
  assert.doesNotMatch(panelSource, /toolName:\s*'tool_name'/);
  assert.match(panelSource, /const canSaveProvider = Boolean/);
});

test('delegated capability Desktop service delegates Runtime control-plane composition to SDK', () => {
  const serviceSource = readDesktopFile('src/shell/renderer/features/runtime-config/runtime-config-delegated-capability-service.ts');
  assert.match(serviceSource, /createHostRuntimeAgentDelegatedCapabilitySurface/);
  assert.doesNotMatch(serviceSource, /createRuntimeProtectedScopeHelper/);
  assert.doesNotMatch(serviceSource, /buildRuntimeAgentRequestContext/);
  assert.doesNotMatch(serviceSource, /runtime\.agent\.getDelegatedControlSurfaceSnapshot/);
  assert.doesNotMatch(serviceSource, /runtime\.agent\.upsertDelegatedProviderProfile/);
  assert.doesNotMatch(serviceSource, /runtime\.agent\.submitDelegatedApprovalDecision/);
});

test('delegated diagnostic rpc maps audit evidence fields without dropping runtime proof ids', () => {
  const serviceSource = readRepoFile('runtime/internal/services/runtimeagent/delegated_control_surface_rpc.go');
  for (const field of [
    'GatewayEvidenceId',
    'FirewallInputId',
    'FirewallVerdict',
    'RuntimeDecision',
    'ReasonCode',
  ]) {
    assert.match(serviceSource, new RegExp(field));
  }
});
