import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentLifecycleStatus, type LocalAgentRecord } from '@nimiplatform/sdk/runtime/wire-types';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';
import { projectPartnerRecord, readPartnerDirectoryPage, isSameCharacter } from '../src/shell/renderer/features/agents/partner-directory-model.js';
import { openPartnerConversation } from '../src/shell/renderer/features/agents/partner-navigation.js';
import { captureHomeNavigationScope, createHomeNavigation, validateHomeDestination } from '../src/shell/renderer/app-shell/providers/home-navigation.js';

const record = (lifecycleStatus = AgentLifecycleStatus.ACTIVE): LocalAgentRecord => ({
  localAgentRef: 'local-agent:a', displayName: 'Same name', ownerUserId: 'account-a', runtimeSourceRef: 'source-a',
  lifecycleStatus, presentationProfileRevision: '0', createdAt: { seconds: '1792976400', nanos: 0 },
});

test('partner membership depends on owner inventory, not optional source readiness', () => {
  for (const state of [AgentLifecycleStatus.INITIALIZING, AgentLifecycleStatus.ACTIVE, AgentLifecycleStatus.SUSPENDED, AgentLifecycleStatus.TERMINATING]) {
    const row = projectPartnerRecord(record(state), 'account-a');
    assert.equal(row?.localAgentRef, 'local-agent:a');
    assert.equal(row?.sourceRef, null);
    assert.equal(row?.lifecycle, state);
  }
  assert.equal(projectPartnerRecord(record(AgentLifecycleStatus.TERMINATED), 'account-a'), null);
  assert.equal(projectPartnerRecord({ ...record(), sourceContextStatus: {} as NonNullable<LocalAgentRecord['sourceContextStatus']> }, 'account-a')?.sourceRef, null);
  assert.throws(() => projectPartnerRecord(record(), 'foreign-account'), /identity/);
});

test('the management read uses the protected all-lifecycle owner page without app conversations', async () => {
  let seen: unknown;
  const sdk = { withRuntimeProtectedScopes: async (scopes: string[], call: (options: object) => unknown) => {
    assert.deepEqual(scopes, ['runtime.agent.read']); return call({});
  }, accountProduct: () => ({ agents: { listAgents: async (request: unknown) => { seen = request; return { agents: [record(), record(AgentLifecycleStatus.SUSPENDED)], nextPageToken: 'next' }; } } }) } as unknown as DesktopRendererSdkPort;
  const page = await readPartnerDirectoryPage(sdk, 'account-a');
  assert.deepEqual(seen, { lifecycleFilter: AgentLifecycleStatus.UNSPECIFIED, pageSize: 50, pageToken: '' });
  assert.equal(page.items.length, 2);
  assert.equal(page.nextPageToken, 'next');
});

test('source associations survive version changes but never cross owner or World identity', () => {
  const source = { kind: 'personaCharacter' as const, id: 'p', worldId: 'w', ownerAccountId: 'creator', sourceHash: 'a'.repeat(64) };
  assert.equal(isSameCharacter(source, { ...source, sourceHash: 'b'.repeat(64) }), true);
  assert.equal(isSameCharacter(source, { ...source, ownerAccountId: 'different' }), false);
  assert.equal(isSameCharacter(source, { ...source, worldId: 'different' }), false);
});

test('only explicit chat opens the exact revalidated partner and a stale or paused target opens none', async () => {
  const calls: string[] = [];
  let current = true;
  let ownerRecord = record();
  const sdk = {
    withRuntimeProtectedScopes: async (_scopes: unknown, call: (options: object) => unknown) => call({}),
    accountProduct: () => ({ agents: { getAgent: async ({ agentId }: { agentId: string }) => { calls.push(agentId); return { agent: ownerRecord }; } } }),
    resolveDesktopAgentReference: async ({ localAgentRef }: { localAgentRef: string }) => { calls.push('resolve:' + localAgentRef); return { reference: { agentHandle: 'handle-a', displayName: 'Same name' } }; },
    conversation: () => ({ open: async ({ agentHandle }: { agentHandle: string }) => { calls.push('open:' + agentHandle); return { conversationAnchorId: 'anchor-a' }; } }),
  } as unknown as DesktopRendererSdkPort;
  const input = { sdk, accountId: 'account-a', localAgentRef: 'local-agent:a', isCurrent: () => current };
  assert.equal((await openPartnerConversation(input))?.conversationAnchorId, 'anchor-a');
  assert.deepEqual(calls, ['local-agent:a', 'resolve:local-agent:a', 'open:handle-a']);
  calls.length = 0; current = false;
  assert.equal(await openPartnerConversation(input), null);
  assert.deepEqual(calls, ['local-agent:a']);
  calls.length = 0; current = true; ownerRecord = record(AgentLifecycleStatus.SUSPENDED);
  await assert.rejects(openPartnerConversation(input), /unavailable/);
  assert.deepEqual(calls, ['local-agent:a']);
});

test('partner management has a navigation-only position with no conversation or foreign handle', () => {
  const target = { id: 'explore', exploreSection: 'partners', partner: { localAgentRef: 'local-agent:a', settingsSection: 'cognition' } };
  assert.equal(validateHomeDestination(target).partner?.settingsSection, 'cognition');
  assert.throws(() => validateHomeDestination({ ...target, partner: { ...target.partner, agentHandle: 'foreign' } }));
  assert.throws(() => validateHomeDestination({ ...target, exploreSection: 'worlds' }));
  assert.throws(() => validateHomeDestination({ id: 'explore', exploreSection: 'personas' }));
});

test('late partner actions cannot reclaim a page after switching sections or returning with Back', async () => {
  const navigation = createHomeNavigation();
  await navigation.push({ id: 'explore', exploreSection: 'partners', partner: { localAgentRef: 'local-agent:a' } });
  const pending = captureHomeNavigationScope(navigation);
  assert.equal(pending.isCurrent(), true);
  await navigation.push({ id: 'explore', exploreSection: 'partners', partner: { localAgentRef: 'local-agent:a', settingsSection: 'cognition' } });
  assert.equal(pending.isCurrent(), false);
  await navigation.back();
  assert.equal(pending.isCurrent(), false);
  pending.dispose();
});
