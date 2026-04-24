import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import * as externalAgentRuntime from '../src/runtime/external-agent';

const EXTERNAL_AGENT_UI_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-config-external-agent-access.tsx',
);
const externalAgentUiSource = readFileSync(EXTERNAL_AGENT_UI_PATH, 'utf8');

test('D-AUTH-010: external principal token runtime exports stay available', () => {
  assert.equal(typeof externalAgentRuntime.issueExternalAgentToken, 'function');
  assert.equal(typeof externalAgentRuntime.revokeExternalAgentToken, 'function');
  assert.equal(typeof externalAgentRuntime.listExternalAgentTokens, 'function');
  assert.equal(typeof externalAgentRuntime.getExternalAgentGatewayStatus, 'function');
});

test('D-AUTH-010: external principal token UI flow preserves required structure', () => {
  assert.match(externalAgentUiSource, /const status = await getExternalAgentGatewayStatus\(\);/);
  assert.match(externalAgentUiSource, /const rows = await listExternalAgentTokens\(\);/);
  assert.match(externalAgentUiSource, /setGatewayStatus\(\{/);
  assert.match(externalAgentUiSource, /enabled: Boolean\(status\.enabled\)/);
  assert.match(externalAgentUiSource, /setIssuedToken\(issued\.token\);/);
  assert.match(externalAgentUiSource, /await revokeExternalAgentToken\(resolvedTokenId\);/);
  assert.match(externalAgentUiSource, /setIssuedToken\(''\);/);
  assert.match(externalAgentUiSource, /const canIssue = gatewayStatus\.enabled && !gatewayStatus\.loading;/);
  assert.match(externalAgentUiSource, /const ttlIsPositiveInteger =/);
  assert.match(externalAgentUiSource, /ttlValidationMessage/);
  assert.match(externalAgentUiSource, /const \[showIssueForm, setShowIssueForm\] = useState\(false\);/);
  assert.match(externalAgentUiSource, /const filterTabs: Array<\{ key: TokenFilter; label: string \}> = \[/);
  assert.match(externalAgentUiSource, /disabled=\{busy \|\| !canIssue \|\| !ttlIsPositiveInteger\}/);
  assert.match(externalAgentUiSource, /disabled=\{!canIssue\}/);
  assert.match(externalAgentUiSource, /handleRevokeToken\(token\.tokenId\)/);
  assert.match(externalAgentUiSource, /noTokensInFilter/);
  assert.match(externalAgentUiSource, /noTokensIssuedHint/);
});
