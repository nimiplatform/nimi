import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { createNimiRuntimeExternalAgentAccessSurface } from '@nimiplatform/sdk/runtime';

const EXTERNAL_AGENT_UI_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-config-external-agent-access.tsx',
);
const EXTERNAL_AGENT_TOKEN_TABLE_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-config-external-agent-token-table.tsx',
);
const EXTERNAL_AGENT_ISSUE_TOKEN_FORM_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-config-external-agent-issue-token-form.tsx',
);
const externalAgentUiSource = [
  EXTERNAL_AGENT_UI_PATH,
  EXTERNAL_AGENT_ISSUE_TOKEN_FORM_PATH,
]
  .map((filePath) => readFileSync(filePath, 'utf8'))
  .join('\n');
const externalAgentTokenTableSource = readFileSync(EXTERNAL_AGENT_TOKEN_TABLE_PATH, 'utf8');

test('D-AUTH-010: external principal token SDK Runtime surface stays available', () => {
  assert.equal(typeof createNimiRuntimeExternalAgentAccessSurface, 'function');
});

test('D-AUTH-010: external principal token UI flow preserves required structure', () => {
  assert.match(externalAgentUiSource, /createNimiRuntimeExternalAgentAccessSurface/);
  assert.match(externalAgentUiSource, /const status = await externalAgentAccess\.getGatewayStatus\(\);/);
  assert.match(externalAgentUiSource, /const rows = await externalAgentAccess\.listTokens\(\);/);
  assert.match(externalAgentUiSource, /setGatewayStatus\(\{/);
  assert.match(externalAgentUiSource, /enabled: Boolean\(status\.enabled\)/);
  assert.match(externalAgentUiSource, /setIssuedToken\(issued\.token\);/);
  assert.match(externalAgentUiSource, /await externalAgentAccess\.revokeToken\(resolvedTokenId\);/);
  assert.match(externalAgentUiSource, /setIssuedToken\(''\);/);
  assert.match(externalAgentUiSource, /const canIssue = gatewayStatus\.enabled\s*&& !gatewayStatus\.loading\s*&& \(gatewayStatus\.actionCount \?\? 0\) > 0;/);
  assert.match(externalAgentUiSource, /const ttlIsPositiveInteger =/);
  assert.match(externalAgentUiSource, /ttlValidationMessage/);
  assert.match(externalAgentUiSource, /const \[showIssueForm, setShowIssueForm\] = useState\(false\);/);
  assert.match(externalAgentUiSource, /const filterTabs: Array<\{ key: TokenFilter; label: string \}> = \[/);
  assert.match(externalAgentUiSource, /disabled=\{(?:props\.)?busy \|\| !(?:props\.)?canIssue \|\| !(?:props\.)?ttlIsPositiveInteger\}/);
  assert.match(externalAgentUiSource, /disabled=\{!canIssue\}/);
  assert.match(externalAgentTokenTableSource, /props\.onRevokeToken\(\)/);
  assert.match(externalAgentTokenTableSource, /noTokensInFilter/);
  assert.match(externalAgentTokenTableSource, /noTokensIssuedHint/);
});
