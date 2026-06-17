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
  assert.match(contactsModelSource, /const isSource = hasRealmSourceIdentity\(item, sourceProfile\)/);
  assert.match(contactsModelSource, /item\.tags\.map\(\(tag\) => String\(tag\)\)/);
  assert.doesNotMatch(contactsModelSource, /item\.tags\.map\(\(t\) => String\(t\)\)/);
});

test('product-side social and explore flows do not infer source identity from handle prefixes', () => {
  const socialProfileFlowSource = readSource('../src/shell/renderer/features/social/data/social-snapshot.ts');
  const explorePanelSource = [
    '../src/shell/renderer/features/explore/explore-panel.tsx',
    '../src/shell/renderer/features/explore/explore-persona-source-projection.ts',
  ]
    .map(readSource)
    .join('\n');
  const sourceRuntimeFlowSource = readSource('../src/shell/renderer/features/source-detail/data/realm-source-detail-data.ts');
  const handleIdentifierPath = path.join(import.meta.dirname, '../src/shell/renderer/features/source-detail/data/handle-identifier.ts');

  assert.doesNotMatch(socialProfileFlowSource, /startsWith\('~'\)/);
  assert.doesNotMatch(explorePanelSource, /handle\.startsWith\('~'\)/);
  assert.match(explorePanelSource, /const isSource = source\.isSource === true \|\| Boolean\(sourceRecord\) \|\| Boolean\(sourceProfile\)/);
  assert.equal(fs.existsSync(handleIdentifierPath), false);
  assert.doesNotMatch(sourceRuntimeFlowSource, /handle-identifier/);
  assert.doesNotMatch(sourceRuntimeFlowSource, /buildHandleLookupCandidates/);
});

test('Realm source detail loading rejects legacy @ and ~ prefixes', async () => {
  const sourceRuntimeFlowSource = readSource('../src/shell/renderer/features/source-detail/data/realm-source-detail-data.ts');

  assert.match(sourceRuntimeFlowSource, /worldCoreControllerGetRealmPersona/);
  assert.match(sourceRuntimeFlowSource, /worldCoreControllerGetWorldCharacter/);
  assert.doesNotMatch(sourceRuntimeFlowSource, /AgentsService\.getAgent/);
  assert.doesNotMatch(sourceRuntimeFlowSource, /AgentsService\.getAgentByHandle/);
});
