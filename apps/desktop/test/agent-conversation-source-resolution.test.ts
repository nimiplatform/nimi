import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveActiveConversationSourceRef,
  resolveAgentTargetSnapshotForSourceRef,
  resolveAgentTargetSourceRef,
} from '../src/shell/renderer/features/agents/agent-conversation-source-resolution';
import type { LocalAgentListItem } from '../src/shell/renderer/features/agents/local-agent-list-model';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';

function characterSourceRef(id: string, hash: string) {
  return {
    kind: 'worldCharacter' as const,
    id,
    worldId: 'world-1',
    worldEntityRef: { kind: 'worldEntity' as const, worldId: 'world-1', entityId: id },
    sourceHash: hash,
  };
}

function localAgent(id: string, sourceRef: ReturnType<typeof characterSourceRef>): LocalAgentListItem {
  return {
    localAgentRef: `local-agent:${id}`,
    ownerUserId: 'owner-1',
    runtimeSourceRef: `runtime-source:${id}`,
    displayName: id,
    sourceRef,
    sourceKey: `key:${id}`,
  };
}

function createSdkStub(input: {
  summariesByLocalAgentRef: Record<string, Array<{ conversationAnchorId: string }>>;
}) {
  return {
    appId: () => 'nimi-desktop',
    accountProduct: () => ({
      agents: {
        openConversationAnchor: async () => ({}),
        getConversationAnchorSnapshot: async () => ({}),
        getPublicChatSessionSnapshot: async () => ({}),
        listAgentConversationSummaries: async (request: { agentId?: string }) => {
          const localAgentRef = String(request.agentId || '');
          return {
            summaries: (input.summariesByLocalAgentRef[localAgentRef] ?? []).map((summary) => ({
              anchor: {
                conversationAnchorId: summary.conversationAnchorId,
                localAgentRef,
                agentId: localAgentRef,
              },
            })),
          };
        },
      },
    }),
    withRuntimeProtectedScopes: async (
      _scopes: readonly string[],
      operation: (options: unknown) => Promise<unknown>,
    ) => operation({}),
  } as unknown as DesktopRendererSdkPort;
}

const sourceRefA = characterSourceRef('cbdb-person-a', 'a'.repeat(64));
const sourceRefB = characterSourceRef('cbdb-person-b', 'b'.repeat(64));

test('active conversation source resolution joins the anchor to the owning LocalAgent source', async () => {
  const sdk = createSdkStub({
    summariesByLocalAgentRef: {
      'local-agent:agent-a': [{ conversationAnchorId: 'anchor-a' }],
      'local-agent:agent-b': [{ conversationAnchorId: 'anchor-b' }],
    },
  });

  const resolved = await resolveActiveConversationSourceRef({
    conversationAnchorId: 'anchor-b',
    agents: [localAgent('agent-a', sourceRefA), localAgent('agent-b', sourceRefB)],
    ownerUserId: 'owner-1',
    sdk,
  });

  assert.deepEqual(resolved, sourceRefB);
});

test('active conversation source resolution fails closed when no summary matches', async () => {
  const sdk = createSdkStub({
    summariesByLocalAgentRef: {
      'local-agent:agent-a': [{ conversationAnchorId: 'anchor-a' }],
      'local-agent:agent-b': [{ conversationAnchorId: 'anchor-b' }],
    },
  });

  const resolved = await resolveActiveConversationSourceRef({
    conversationAnchorId: 'anchor-unknown',
    agents: [localAgent('agent-a', sourceRefA), localAgent('agent-b', sourceRefB)],
    ownerUserId: 'owner-1',
    sdk,
  });

  assert.equal(resolved, null);
});

test('active conversation source resolution fails closed without candidate agents', async () => {
  const sdk = createSdkStub({ summariesByLocalAgentRef: {} });

  const resolved = await resolveActiveConversationSourceRef({
    conversationAnchorId: 'anchor-a',
    agents: [],
    ownerUserId: 'owner-1',
    sdk,
  });

  assert.equal(resolved, null);
});

function createAgentTargetSdkStub(input: {
  conversationAnchorId: string;
  summariesByLocalAgentRef: Record<string, Array<{ conversationAnchorId: string }>>;
  onOpen?: () => void;
  handlesByLocalAgentRef?: Record<string, string | Error>;
  onResolveReference?: (localAgentRef: string) => void;
}) {
  const base = createSdkStub({ summariesByLocalAgentRef: input.summariesByLocalAgentRef });
  return {
    ...base,
    conversation: () => ({
      open: async () => {
        input.onOpen?.();
        return { conversationAnchorId: input.conversationAnchorId, activeTurnId: null };
      },
    }),
    appProduct: () => ({ agents: { listReferences: async () => { throw new Error('must not enumerate App references'); } } }),
    resolveDesktopAgentReference: async ({ localAgentRef }: { localAgentRef: string }) => {
      input.onResolveReference?.(localAgentRef);
      const handle = input.handlesByLocalAgentRef?.[localAgentRef];
      if (handle instanceof Error) throw handle;
      if (!handle) throw new Error('Desktop Agent reference is unavailable.');
      return { reference: { agentHandle: handle, displayName: localAgentRef } };
    },
    runtimeAgentDiscovery: () => ({
      listLocalAgents: async () => [
        {
          localAgentRef: 'local-agent:agent-a',
          ownerUserId: 'owner-1',
          runtimeSourceRef: 'runtime-source:agent-a',
          displayName: 'Agent A',
          sourceContextStatus: {
            ready: true,
            localAgentRef: 'local-agent:agent-a',
            sourceRef: sourceRefA,
          },
        },
        {
          localAgentRef: 'local-agent:agent-b',
          ownerUserId: 'owner-1',
          runtimeSourceRef: 'runtime-source:agent-b',
          displayName: 'Agent B',
          sourceContextStatus: {
            ready: true,
            localAgentRef: 'local-agent:agent-b',
            sourceRef: sourceRefB,
          },
        },
      ],
    }),
  } as unknown as DesktopRendererSdkPort;
}

const HANDLE_A = `agent_ref_${'A'.repeat(43)}`;
const HANDLE_B = `agent_ref_${'B'.repeat(43)}`;

test('agent target source resolution matches the handle through read-only Desktop references without opening a conversation', async () => {
  let opened = 0;
  const sdk = createAgentTargetSdkStub({
    conversationAnchorId: 'anchor-b',
    summariesByLocalAgentRef: {},
    handlesByLocalAgentRef: {
      'local-agent:agent-a': HANDLE_A,
      'local-agent:agent-b': HANDLE_B,
    },
    onOpen: () => {
      opened += 1;
    },
  });

  const resolved = await resolveAgentTargetSourceRef({
    agentHandle: HANDLE_B,
    ownerUserId: 'owner-1',
    sdk,
  });

  assert.deepEqual(resolved, sourceRefB);
  assert.equal(opened, 0);
});

test('agent target source resolution skips a LocalAgent whose reference cannot be resolved', async () => {
  const sdk = createAgentTargetSdkStub({
    conversationAnchorId: 'anchor-b',
    summariesByLocalAgentRef: {},
    handlesByLocalAgentRef: {
      'local-agent:agent-a': new Error('Desktop Agent reference is unavailable.'),
      'local-agent:agent-b': HANDLE_B,
    },
  });

  assert.deepEqual(await resolveAgentTargetSourceRef({
    agentHandle: HANDLE_B,
    ownerUserId: 'owner-1',
    sdk,
  }), sourceRefB);
});

test('agent target source resolution fails closed when no current reference or more than one matches', async () => {
  const unmatched = createAgentTargetSdkStub({
    conversationAnchorId: 'anchor-b',
    summariesByLocalAgentRef: {},
    handlesByLocalAgentRef: { 'local-agent:agent-a': HANDLE_A },
  });
  assert.equal(await resolveAgentTargetSourceRef({ agentHandle: HANDLE_B, ownerUserId: 'owner-1', sdk: unmatched }), null);

  const ambiguous = createAgentTargetSdkStub({
    conversationAnchorId: 'anchor-b',
    summariesByLocalAgentRef: {},
    handlesByLocalAgentRef: {
      'local-agent:agent-a': HANDLE_B,
      'local-agent:agent-b': HANDLE_B,
    },
  });
  assert.equal(await resolveAgentTargetSourceRef({ agentHandle: HANDLE_B, ownerUserId: 'owner-1', sdk: ambiguous }), null);
});

test('agent target source resolution fails closed without a canonical handle or owner and resolves nothing', async () => {
  let opened = 0;
  const resolvedRefs: string[] = [];
  const sdk = createAgentTargetSdkStub({
    conversationAnchorId: 'anchor-b',
    summariesByLocalAgentRef: {},
    handlesByLocalAgentRef: { 'local-agent:agent-b': HANDLE_B },
    onOpen: () => {
      opened += 1;
    },
    onResolveReference: (localAgentRef) => {
      resolvedRefs.push(localAgentRef);
    },
  });

  assert.equal(await resolveAgentTargetSourceRef({
    agentHandle: '',
    ownerUserId: 'owner-1',
    sdk,
  }), null);
  assert.equal(await resolveAgentTargetSourceRef({
    agentHandle: HANDLE_B,
    ownerUserId: '',
    sdk,
  }), null);
  assert.equal(opened, 0);
  assert.deepEqual(resolvedRefs, []);
});


function sourceTargetSdk(reference: { agentHandle: string; displayName: string; avatarUrl?: string } | undefined, opened: string[], lookedUp: string[]) {
  const base = createAgentTargetSdkStub({ conversationAnchorId: 'anchor-b', summariesByLocalAgentRef: {} });
  return {
    ...base,
    resolveDesktopAgentReference: async ({ localAgentRef }: { localAgentRef: string }) => {
      lookedUp.push(localAgentRef);
      return { reference };
    },
    appProduct: () => ({ agents: { listReferences: async () => { throw new Error('must not enumerate App references'); } } }),
    conversation: () => ({ open: async ({ agentHandle }: { agentHandle: string }) => {
      opened.push(agentHandle);
      return { conversationAnchorId: 'anchor-b', activeTurnId: null };
    } }),
  } as unknown as DesktopRendererSdkPort;
}

test('source target resolution opens only the explicitly selected Agent', async () => {
  const opened: string[] = [];
  const lookedUp: string[] = [];
  const reference = { agentHandle: 'agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', displayName: 'Agent B', avatarUrl: 'https://example.com/b.png' };
  const sdk = sourceTargetSdk(reference, opened, lookedUp);
  const result = await resolveAgentTargetSnapshotForSourceRef({ sourceRef: sourceRefB, ownerUserId: 'owner-1', sdk });
  assert.deepEqual(lookedUp, ['local-agent:agent-b']);
  assert.deepEqual(opened, [reference.agentHandle]);
  assert.equal(result?.conversationAnchorId, 'anchor-b');
  assert.equal(result?.avatarUrl, reference.avatarUrl);
});

test('source target resolution never opens a conversation without an exact owner or reference', async () => {
  const opened: string[] = [];
  const lookedUp: string[] = [];
  const sdk = sourceTargetSdk(undefined, opened, lookedUp);
  for (const input of [
    { sourceRef: sourceRefB, ownerUserId: '' },
    { sourceRef: characterSourceRef('missing', 'c'.repeat(64)), ownerUserId: 'owner-1' },
    { sourceRef: sourceRefB, ownerUserId: 'owner-1' },
  ]) assert.equal(await resolveAgentTargetSnapshotForSourceRef({ ...input, sdk }), null);
  assert.deepEqual(opened, []);
  assert.deepEqual(lookedUp, ['local-agent:agent-b']);
});
