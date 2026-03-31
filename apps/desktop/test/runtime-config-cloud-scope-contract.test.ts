import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const cloudPageSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-page-cloud.tsx');
const e2eIdsSource = readWorkspaceFile('src/shell/renderer/testability/e2e-ids.ts');
const e2eSelectorsSource = readWorkspaceFile('e2e/helpers/selectors.mjs');

test('runtime config cloud scope contract: anonymous drafts default to machine-global connectors', () => {
  assert.match(
    cloudPageSource,
    /scope: authStatus === 'authenticated' \? 'user' as const : 'machine-global' as const,/,
  );
});

test('runtime config cloud scope contract: runtime-system connectors stay read-only while machine-global remains editable', () => {
  assert.match(cloudPageSource, /const isRuntimeSystem = connectorScope === 'runtime-system';/);
  assert.match(cloudPageSource, /const isMachineGlobal = connectorScope === 'machine-global';/);
  assert.match(cloudPageSource, /const isSystemOwned = isRuntimeSystem;/);
  assert.match(cloudPageSource, /disabled=\{isRuntimeSystem\}/);
  assert.match(
    cloudPageSource,
    /managedMachineGlobal', \{ defaultValue: 'Shared across accounts on this machine' \}\)/,
  );
});

test('runtime config cloud scope contract: connector scope badges expose stable test ids', () => {
  assert.match(
    e2eIdsSource,
    /runtimeConnectorScopeBadge: \(connectorId: string\) => `runtime-connector-scope-badge:\$\{connectorId\}`,/,
  );
  assert.match(
    e2eSelectorsSource,
    /runtimeConnectorScopeBadge: \(connectorId\) => `runtime-connector-scope-badge:\$\{connectorId\}`,/,
  );
  assert.match(cloudPageSource, /data-testid=\{E2E_IDS\.runtimeConnectorScopeBadge\(connector\.id\)\}/);
  assert.match(cloudPageSource, /runtimeConfig\.cloud\.machineGlobal/);
  assert.match(cloudPageSource, /runtimeConfig\.cloud\.runtimeSystem/);
});
