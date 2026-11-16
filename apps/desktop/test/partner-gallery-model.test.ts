import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';
import type { PartnerDirectoryItem } from '../src/shell/renderer/features/agents/partner-directory-model.js';
import { readPartnerLastChat } from '../src/shell/renderer/features/agents/partner-gallery-model.js';

const partner = (id: string, overrides: Partial<PartnerDirectoryItem> = {}): PartnerDirectoryItem => ({
  localAgentRef: `local-agent:${id}`, runtimeSourceRef: 'source-a', displayName: id, lifecycle: AgentLifecycleStatus.ACTIVE,
  createdAt: '2026-10-01T00:00:00.000Z', sourceRef: null, sourceReady: false, ...overrides,
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
