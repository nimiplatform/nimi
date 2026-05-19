import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const desktopDir = path.resolve(import.meta.dirname, '..');
const repoDir = path.resolve(desktopDir, '../..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoDir, relativePath), 'utf8');
}

test('external agent gateway rejects dry-run verify and commit instead of dispatching renderer-local actions', () => {
  const serverSource = readDesktopFile('src-tauri/src/external_agent_gateway/server.rs');
  assert.match(serverSource, /EXTERNAL_AGENT_RUNTIME_DELEGATION_REQUIRED/);
  assert.match(serverSource, /StatusCode::GONE/);
  assert.doesNotMatch(serverSource, /\.emit\(/);
  assert.doesNotMatch(serverSource, /external-agent:\/\/action-request/);
  assert.doesNotMatch(serverSource, /EXTERNAL_AGENT_ACTION_REQUEST_EVENT/);
});

test('external agent renderer bridge does not subscribe to action request bypass events', () => {
  const runtimeBridgeSource = readDesktopFile('src/runtime/external-agent/index.ts');
  const shellBridgeSource = readDesktopFile('src/shell/renderer/bridge/runtime-bridge/external-agent.ts');
  const combinedSource = `${runtimeBridgeSource}\n${shellBridgeSource}`;

  assert.doesNotMatch(combinedSource, /external-agent:\/\/action-request/);
  assert.doesNotMatch(combinedSource, /listenTauri/);
  assert.doesNotMatch(combinedSource, /hookRuntime\.(dryRunAction|verifyAction|commitAction)/);
  assert.doesNotMatch(runtimeBridgeSource, /external_agent_sync_action_descriptors/);
});

test('external agent gateway status derives enabled from live server status', () => {
  const gatewaySource = readDesktopFile('src-tauri/src/external_agent_gateway/mod.rs');
  assert.match(gatewaySource, /enabled:\s*server_status\.enabled\(\)/);
  assert.match(gatewaySource, /reason_code:\s*server_status\.reason_code\(\)/);
  assert.doesNotMatch(gatewaySource, /enabled:\s*true/);
});

test('external agent gateway fails closed when product data is not ready', () => {
  const gatewaySource = readDesktopFile('src-tauri/src/external_agent_gateway/mod.rs');
  const tokenIssuerSource = readDesktopFile('src-tauri/src/external_agent_gateway/token_issuer.rs');
  const authSource = readDesktopFile('src-tauri/src/external_agent_gateway/auth.rs');
  const anonymousFixture = readDesktopFile('e2e/fixtures/profiles/boot.anonymous.login-screen.json');

  assert.match(gatewaySource, /EXTERNAL_AGENT_GATEWAY_PRODUCT_DATA_UNAVAILABLE/);
  assert.match(gatewaySource, /ExternalAgentServerStatus::Disabled/);
  assert.match(gatewaySource, /EXTERNAL_AGENT_GATEWAY_DISABLED/);
  assert.match(gatewaySource, /pub fn gateway_secret\(&self\) -> Result<&str, String>/);
  assert.doesNotMatch(gatewaySource, /panic!\("EXTERNAL_AGENT_GATEWAY_SECRET_INIT_FAILED/);
  assert.match(tokenIssuerSource, /let jws_secret = state\.gateway_secret\(\)\?;/);
  assert.match(tokenIssuerSource, /state\.gateway_secret\(\)\?;/);
  assert.match(authSource, /let jws_secret = state\.gateway_secret\(\)\?;/);
  assert.doesNotMatch(anonymousFixture, /"productControlRecord"/);
  assert.doesNotMatch(anonymousFixture, /"ready_for_use"/);
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
