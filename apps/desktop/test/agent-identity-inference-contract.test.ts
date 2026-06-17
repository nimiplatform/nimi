import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

test('product-side profile and contacts models do not infer source identity from handle prefixes', () => {
  const profileModelSource = readSource('../src/shell/renderer/features/profile/profile-model.ts');
  const contactsModelSource = readSource('../src/shell/renderer/features/relationship/relationship-model.ts');
  const legacyLimitPath = ['agent', 'friend', 'limit'].join('-');
  const friendLimitPath = path.join(import.meta.dirname, `../src/shell/renderer/features/relationship/${legacyLimitPath}.ts`);

  assert.doesNotMatch(profileModelSource, /startsWith\('~'\)/);
  assert.doesNotMatch(contactsModelSource, /startsWith\('~'\)/);
  assert.equal(fs.existsSync(friendLimitPath), false);
  assert.match(profileModelSource, /function hasRealmSourceIdentity/);
  assert.match(profileModelSource, /isSource:\s*hasRealmSourceIdentity\(raw\)/);
  assert.match(contactsModelSource, /function hasRealmSourceIdentity/);
  assert.match(contactsModelSource, /const isSource = hasRealmSourceIdentity\(item, agentProfile\)/);
  assert.match(contactsModelSource, /item\.tags\.map\(\(tag\) => String\(tag\)\)/);
  assert.doesNotMatch(contactsModelSource, /item\.tags\.map\(\(t\) => String\(t\)\)/);
});

test('product-side social and explore flows do not infer agent identity from handle prefixes', () => {
  const socialProfileFlowSource = readSource('../src/shell/renderer/features/social/data/social-snapshot.ts');
  const explorePanelSource = [
    '../src/shell/renderer/features/explore/explore-panel.tsx',
    '../src/shell/renderer/features/explore/explore-agent-projection.ts',
  ]
    .map(readSource)
    .join('\n');
  const agentRuntimeFlowSource = readSource('../src/shell/renderer/features/agent-detail/data/realm-source-detail-data.ts');
  const handleIdentifierPath = path.join(import.meta.dirname, '../src/shell/renderer/features/agent-detail/data/handle-identifier.ts');

  assert.doesNotMatch(socialProfileFlowSource, /startsWith\('~'\)/);
  assert.doesNotMatch(explorePanelSource, /handle\.startsWith\('~'\)/);
  assert.match(explorePanelSource, /const isSource = source\.isSource === true \|\| Boolean\(agent\) \|\| Boolean\(agentProfile\)/);
  assert.equal(fs.existsSync(handleIdentifierPath), false);
  assert.doesNotMatch(agentRuntimeFlowSource, /handle-identifier/);
  assert.doesNotMatch(agentRuntimeFlowSource, /buildHandleLookupCandidates/);
});

test('Realm source detail loading rejects legacy @ and ~ prefixes', async () => {
  const agentRuntimeFlowSource = readSource('../src/shell/renderer/features/agent-detail/data/realm-source-detail-data.ts');

  assert.match(agentRuntimeFlowSource, /worldCoreControllerGetRealmPersona/);
  assert.match(agentRuntimeFlowSource, /worldCoreControllerGetWorldCharacter/);
  assert.doesNotMatch(agentRuntimeFlowSource, /AgentsService\.getAgent/);
  assert.doesNotMatch(agentRuntimeFlowSource, /AgentsService\.getAgentByHandle/);
});
