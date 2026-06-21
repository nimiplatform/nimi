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
  assert.match(contactsModelSource, /const isSource = hasRealmSourceIdentity\(item, sourceRecord\)/);
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
  const exploreDataSource = readSource('../src/shell/renderer/features/explore/data/realm-explore-data.ts');
  const sourceRuntimeFlowSource = readSource('../src/shell/renderer/features/source-detail/data/realm-source-detail-data.ts');
  const profileDetailViewSource = readSource('../src/shell/renderer/features/relationship/profile-detail-view-content.tsx');
  const profileLocaleSource = [
    '../src/shell/renderer/locales/en/06-Profile.json',
    '../src/shell/renderer/locales/zh/06-Profile.json',
  ]
    .map(readSource)
    .join('\n');
  const handleIdentifierPath = path.join(import.meta.dirname, '../src/shell/renderer/features/source-detail/data/handle-identifier.ts');

  assert.doesNotMatch(socialProfileFlowSource, /startsWith\('~'\)/);
  assert.doesNotMatch(explorePanelSource, /handle\.startsWith\('~'\)/);
  assert.match(explorePanelSource, /const isSource = source\.isSource === true \|\| Boolean\(sourceRecord\)/);
  assert.doesNotMatch(exploreDataSource, /identity\.concept/);
  assert.equal(fs.existsSync(handleIdentifierPath), false);
  assert.doesNotMatch(sourceRuntimeFlowSource, /handle-identifier/);
  assert.doesNotMatch(sourceRuntimeFlowSource, /buildHandleLookupCandidates/);
  assert.doesNotMatch(profileDetailViewSource, /agentNoSummary/);
  assert.doesNotMatch(profileLocaleSource, /agentNoSummary/);
});

test('product-side source projections use CoreV1 archetype and pacing, not old source profile fields', () => {
  const sourceProjectionSurface = [
    '../src/shell/renderer/features/explore/data/realm-explore-data.ts',
    '../src/shell/renderer/features/explore/explore-cards.tsx',
    '../src/shell/renderer/features/explore/explore-persona-source-projection.ts',
    '../src/shell/renderer/features/explore/explore-persona-source-card.tsx',
    '../src/shell/renderer/features/home/post-card-projections.ts',
    '../src/shell/renderer/features/profile/profile-model.ts',
    '../src/shell/renderer/features/relationship/profile-detail-modal.tsx',
    '../src/shell/renderer/features/relationship/profile-private-state.ts',
    '../src/shell/renderer/features/source-detail/data/realm-source-detail-data.ts',
    '../src/shell/renderer/features/source-detail/source-detail-model.ts',
    '../src/shell/renderer/features/source-detail/source-detail-view.tsx',
  ]
    .map(readSource)
    .join('\n');
  const sourceLocaleSurface = [
    '../src/shell/renderer/locales/en/06-Profile.json',
    '../src/shell/renderer/locales/zh/06-Profile.json',
    '../src/shell/renderer/locales/en/15-World.json',
    '../src/shell/renderer/locales/zh/15-World.json',
  ]
    .map(readSource)
    .join('\n');
  const sourceDetailModelSource = readSource('../src/shell/renderer/features/source-detail/source-detail-model.ts');

  assert.match(sourceProjectionSurface, /personaStyle\.archetype/);
  assert.match(sourceProjectionSurface, /personaStyle\.pacing/);
  assert.match(sourceProjectionSurface, /visibility/);
  assert.match(sourceProjectionSurface, /sourceArchetype/);
  assert.match(sourceProjectionSurface, /sourcePacing/);
  assert.doesNotMatch(sourceProjectionSurface, /sourceProfile(?!Id)/);
  assert.doesNotMatch(sourceProjectionSurface, /accountVisibility/);
  assert.doesNotMatch(sourceProjectionSurface, /sourceOwnerWorldId|ownerWorldId/);
  assert.doesNotMatch(sourceProjectionSurface, /sourceCategory/);
  assert.doesNotMatch(sourceProjectionSurface, /sourceWakeStrategy/);
  assert.doesNotMatch(sourceProjectionSurface, /wakeStrategy/);
  assert.doesNotMatch(sourceProjectionSurface, /source\.category/);
  assert.doesNotMatch(sourceProjectionSurface, /sourceRecord\?\.category/);
  assert.doesNotMatch(sourceProjectionSurface, /raw\.category/);
  assert.doesNotMatch(sourceDetailModelSource, /:\s*'GENERAL'|:\s*'PASSIVE'|:\s*'COMMUNITY'/);
  assert.doesNotMatch(sourceLocaleSurface, /World\.createAgent|createAgent|wakeStrategy|agentDetails/);
});

test('Realm source detail loading rejects legacy @ and ~ prefixes', async () => {
  const sourceRuntimeFlowSource = readSource('../src/shell/renderer/features/source-detail/data/realm-source-detail-data.ts');
  const sourceDetailModelSource = readSource('../src/shell/renderer/features/source-detail/source-detail-model.ts');

  assert.match(sourceRuntimeFlowSource, /worldCoreControllerGetRealmPersona/);
  assert.match(sourceRuntimeFlowSource, /worldCoreControllerGetWorldCharacter/);
  assert.match(sourceRuntimeFlowSource, /worldCoreControllerGetWorldEntity/);
  assert.match(sourceRuntimeFlowSource, /WorldCharacterCore entity world mismatch/);
  assert.doesNotMatch(sourceRuntimeFlowSource, /AgentsService\.getAgent/);
  assert.doesNotMatch(sourceRuntimeFlowSource, /AgentsService\.getAgentByHandle/);
  assert.doesNotMatch(sourceRuntimeFlowSource, /fallbackId/);
  assert.doesNotMatch(sourceDetailModelSource, /raw\.displayName \|\| raw\.handle \|\| 'Unknown'/);
  assert.match(sourceDetailModelSource, /Source detail projection requires displayName from Realm Core/);
});
