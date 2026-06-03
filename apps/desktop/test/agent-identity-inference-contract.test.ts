import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

test('product-side profile and contacts models do not infer agent identity from handle prefixes', () => {
  const profileModelSource = readSource('../src/shell/renderer/features/profile/profile-model.ts');
  const contactsModelSource = readSource('../src/shell/renderer/features/relationship/relationship-model.ts');
  const friendLimitSource = readSource('../src/shell/renderer/features/relationship/agent-friend-limit.ts');

  assert.doesNotMatch(profileModelSource, /startsWith\('~'\)/);
  assert.doesNotMatch(contactsModelSource, /startsWith\('~'\)/);
  assert.doesNotMatch(friendLimitSource, /startsWith\('~'\)/);
  assert.match(profileModelSource, /isAgent:\s*raw\.isAgent === true/);
  assert.match(contactsModelSource, /const isAgent = item\.isAgent === true/);
  assert.match(contactsModelSource, /item\.tags\.map\(\(tag\) => String\(tag\)\)/);
  assert.doesNotMatch(contactsModelSource, /item\.tags\.map\(\(t\) => String\(t\)\)/);
});

test('product-side social and explore flows do not infer agent identity from handle prefixes', () => {
  const socialProfileFlowSource = readSource('../src/shell/renderer/features/social/data/social-snapshot.ts');
  const explorePanelSource = readSource('../src/shell/renderer/features/explore/explore-panel.tsx');
  const agentRuntimeFlowSource = readSource('../src/shell/renderer/features/agent-detail/data/realm-agent-detail-data.ts');
  const handleIdentifierPath = path.join(import.meta.dirname, '../src/shell/renderer/features/agent-detail/data/handle-identifier.ts');

  assert.doesNotMatch(socialProfileFlowSource, /startsWith\('~'\)/);
  assert.doesNotMatch(explorePanelSource, /handle\.startsWith\('~'\)/);
  assert.match(explorePanelSource, /const isAgent = source\.isAgent === true \|\| Boolean\(agent\) \|\| Boolean\(agentProfile\)/);
  assert.equal(fs.existsSync(handleIdentifierPath), false);
  assert.doesNotMatch(agentRuntimeFlowSource, /handle-identifier/);
  assert.doesNotMatch(agentRuntimeFlowSource, /buildHandleLookupCandidates/);
});

test('loadAgentDetails rejects legacy @ and ~ prefixes', async () => {
  const agentRuntimeFlowSource = readSource('../src/shell/renderer/features/agent-detail/data/realm-agent-detail-data.ts');

  assert.match(agentRuntimeFlowSource, /loadRealmAgentDetails/);
  assert.match(agentRuntimeFlowSource, /from '@nimiplatform\/sdk\/realm'/);
  assert.doesNotMatch(agentRuntimeFlowSource, /AgentsService\.getAgent/);
  assert.doesNotMatch(agentRuntimeFlowSource, /AgentsService\.getAgentByHandle/);
});
