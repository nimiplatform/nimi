import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';
import type { PartnerDirectoryItem } from '../src/shell/renderer/features/agents/partner-directory-model.js';
import { readPartnerLastChat, selectGalleryPartners } from '../src/shell/renderer/features/agents/partner-gallery-model.js';

const persona = { kind: 'personaCharacter' as const, id: 'persona', worldId: 'world', ownerAccountId: 'owner', sourceHash: 'a'.repeat(64) };
const world = { kind: 'worldCharacter' as const, id: 'character', worldId: 'world', worldEntityRef: { kind: 'worldEntity' as const, worldId: 'world', entityId: 'entity' }, sourceHash: 'b'.repeat(64) };
const partner = (id: string, overrides: Partial<PartnerDirectoryItem> = {}): PartnerDirectoryItem => ({
  localAgentRef: `local-agent:${id}`, runtimeSourceRef: 'source-a', displayName: id, lifecycle: AgentLifecycleStatus.ACTIVE,
  createdAt: '2026-10-01T00:00:00.000Z', sourceRef: null, sourceReady: false, ...overrides,
});
const partners = [partner('unknown', { lifecycle: AgentLifecycleStatus.SUSPENDED }), partner('world', { sourceRef: world }),
  partner('mine', { sourceRef: persona }), partner('other', { sourceRef: { ...persona, ownerAccountId: 'someone-else' } })];

test('gallery filters use provenance and authorship without changing inventory membership', () => {
  const input = { partners, accountId: 'owner', sort: 'newest' as const, lastChats: new Map() };
  assert.deepEqual(selectGalleryPartners({ ...input, filter: 'all' }), partners);
  assert.deepEqual(selectGalleryPartners({ ...input, filter: 'world' }).map(p => p.displayName), ['world']);
  assert.deepEqual(selectGalleryPartners({ ...input, filter: 'created' }).map(p => p.displayName), ['mine']);
  assert.equal(partners.length, 4);
});

test('recent chats sort by confirmed messages, excluding unknown and empty histories', () => {
  const lastChats = new Map<string, number | null>([['local-agent:mine', 20], ['local-agent:world', 100], ['local-agent:unknown', null]]);
  assert.deepEqual(selectGalleryPartners({ partners, accountId: 'owner', filter: 'recent', sort: 'newest', lastChats }).map(p => p.displayName), ['world', 'mine']);
});

test('gallery sorting is stable for duplicate names and keeps unknown dates last', () => {
  const records = [partner('unknown', { createdAt: null }), partner('older'), partner('newer', { createdAt: '2026-10-20T00:00:00.000Z' })];
  const input = { partners: records, accountId: 'owner', filter: 'all' as const, lastChats: new Map() };
  assert.deepEqual(selectGalleryPartners({ ...input, sort: 'newest' }).map(p => p.displayName), ['newer', 'older', 'unknown']);
  assert.deepEqual(selectGalleryPartners({ ...input, sort: 'oldest' }).map(p => p.displayName), ['older', 'newer', 'unknown']);
  assert.equal(records[0]?.displayName, 'unknown');
  assert.deepEqual(selectGalleryPartners({ ...input, sort: 'name', partners: [partner('a', { displayName: 'Same' }), partner('b', { displayName: 'Same' })] }).map(p => p.localAgentRef), ['local-agent:a', 'local-agent:b']);
});

function historySdk(pages: { summaries: unknown[]; nextPageToken: string }[]) {
  const tokens: string[] = [];
  const sdk = {
    appId: () => 'nimi.desktop',
    withRuntimeProtectedScopes: async (scopes: string[], call: (options: object) => unknown) => {
      assert.deepEqual(scopes, ['runtime.agent.read']); return call({});
    },
    accountProduct: () => ({ agents: { listAgentConversationSummaries: async (request: { agentId: string; pageToken: string }) => {
      assert.equal(request.agentId, 'local-agent:a'); tokens.push(request.pageToken); return pages[Math.min(tokens.length - 1, pages.length - 1)];
    } } }),
    conversation: () => { throw new Error('Browsing must not open a conversation'); },
  } as unknown as DesktopRendererSdkPort;
  return { sdk, tokens };
}
const summary = (messageCount: number, seconds = '100') => ({
  anchor: { conversationAnchorId: 'anchor-a', agentId: 'local-agent:a', localAgentRef: 'local-agent:a' },
  transcriptMessageCount: messageCount, updatedAt: { seconds, nanos: 0 },
});

test('recent history skips empty anchors and follows the next page without opening a chat', async () => {
  const { sdk, tokens } = historySdk([{ summaries: [summary(0)], nextPageToken: 'next' }, { summaries: [summary(2)], nextPageToken: '' }]);
  assert.equal(await readPartnerLastChat(sdk, 'owner', partner('a')), 100_000);
  assert.deepEqual(tokens, ['', 'next']);
  assert.equal(await readPartnerLastChat(historySdk([{ summaries: [summary(0)], nextPageToken: '' }]).sdk, 'owner', partner('a')), null);
});

test('history failures stay failures rather than pretending there are no conversations', async () => {
  const { sdk } = historySdk([{ summaries: [], nextPageToken: 'same' }]);
  await assert.rejects(readPartnerLastChat(sdk, 'owner', partner('a')), /cursor/);
  const mismatched = { ...summary(2), anchor: { conversationAnchorId: 'anchor-a', agentId: 'local-agent:other', localAgentRef: 'local-agent:other' } };
  await assert.rejects(readPartnerLastChat(historySdk([{ summaries: [mismatched], nextPageToken: '' }]).sdk, 'owner', partner('a')), /identity mismatch/);
});
