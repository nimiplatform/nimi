import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadAgentDetails } from '../src/runtime/data-sync/flows/agent-runtime-flow';
import { searchUserByIdentifier } from '../src/runtime/data-sync/flows/social-flow';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

test('product-side profile and contacts models do not infer agent identity from handle prefixes', () => {
  const profileModelSource = readSource('../src/shell/renderer/features/profile/profile-model.ts');
  const contactsModelSource = readSource('../src/shell/renderer/features/contacts/contacts-model.ts');
  const friendLimitSource = readSource('../src/shell/renderer/features/contacts/agent-friend-limit.ts');

  assert.doesNotMatch(profileModelSource, /startsWith\('~'\)/);
  assert.doesNotMatch(contactsModelSource, /startsWith\('~'\)/);
  assert.doesNotMatch(friendLimitSource, /startsWith\('~'\)/);
  assert.match(profileModelSource, /isAgent:\s*raw\.isAgent === true/);
  assert.match(contactsModelSource, /const isAgent = item\.isAgent === true/);
});

test('product-side social and explore flows do not infer agent identity from handle prefixes', () => {
  const socialProfileFlowSource = readSource('../src/runtime/data-sync/flows/profile-flow-social.ts');
  const explorePanelSource = readSource('../src/shell/renderer/features/explore/explore-panel.tsx');
  const agentRuntimeFlowSource = readSource('../src/runtime/data-sync/flows/agent-runtime-flow.ts');
  const socialFlowSource = readSource('../src/runtime/data-sync/flows/social-flow.ts');
  const handleIdentifierPath = path.join(import.meta.dirname, '../src/runtime/data-sync/flows/handle-identifier.ts');

  assert.doesNotMatch(socialProfileFlowSource, /startsWith\('~'\)/);
  assert.doesNotMatch(explorePanelSource, /handle\.startsWith\('~'\)/);
  assert.match(explorePanelSource, /const isAgent = source\.isAgent === true \|\| Boolean\(agent\) \|\| Boolean\(agentProfile\)/);
  assert.equal(fs.existsSync(handleIdentifierPath), false);
  assert.doesNotMatch(agentRuntimeFlowSource, /handle-identifier/);
  assert.doesNotMatch(socialFlowSource, /handle-identifier/);
  assert.doesNotMatch(agentRuntimeFlowSource, /buildHandleLookupCandidates/);
  assert.doesNotMatch(socialFlowSource, /buildHandleLookupCandidates/);
});

test('loadAgentDetails and searchUserByIdentifier reject legacy @ and ~ prefixes', async () => {
  const callApi = async () => {
    throw new Error('UNEXPECTED_API_CALL');
  };
  const emitDataSyncError = () => {};
  const isFriend = () => false;

  await assert.rejects(
    () => loadAgentDetails(callApi as never, emitDataSyncError, '@legacy'),
    /HANDLE_PREFIX_UNSUPPORTED/,
  );
  await assert.rejects(
    () => loadAgentDetails(callApi as never, emitDataSyncError, '~legacy'),
    /HANDLE_PREFIX_UNSUPPORTED/,
  );
  await assert.rejects(
    () => searchUserByIdentifier(callApi as never, '@legacy', isFriend),
    /HANDLE_PREFIX_UNSUPPORTED/,
  );
  await assert.rejects(
    () => searchUserByIdentifier(callApi as never, '~legacy', isFriend),
    /HANDLE_PREFIX_UNSUPPORTED/,
  );
});
