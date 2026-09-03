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

test('agent target source resolution opens the canonical conversation and joins the owning LocalAgent source', async () => {
  let opened = 0;
  const sdk = createAgentTargetSdkStub({
    conversationAnchorId: 'anchor-b',
    summariesByLocalAgentRef: {
      'local-agent:agent-a': [{ conversationAnchorId: 'anchor-a' }],
      'local-agent:agent-b': [{ conversationAnchorId: 'anchor-b' }],
    },
    onOpen: () => {
      opened += 1;
    },
  });

  const resolved = await resolveAgentTargetSourceRef({
    agentHandle: 'agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    ownerUserId: 'owner-1',
    sdk,
  });

  assert.deepEqual(resolved, sourceRefB);
  assert.equal(opened, 1);
});

test('agent target source resolution fails closed when the anchor matches no summary', async () => {
  const sdk = createAgentTargetSdkStub({
    conversationAnchorId: 'anchor-unknown',
    summariesByLocalAgentRef: {
      'local-agent:agent-a': [{ conversationAnchorId: 'anchor-a' }],
    },
  });

  const resolved = await resolveAgentTargetSourceRef({
    agentHandle: 'agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    ownerUserId: 'owner-1',
    sdk,
  });

  assert.equal(resolved, null);
});

test('agent target source resolution fails closed without a canonical handle and never opens a conversation', async () => {
  let opened = 0;
  const sdk = createAgentTargetSdkStub({
    conversationAnchorId: 'anchor-b',
    summariesByLocalAgentRef: {
      'local-agent:agent-b': [{ conversationAnchorId: 'anchor-b' }],
    },
    onOpen: () => {
      opened += 1;
    },
  });

  assert.equal(await resolveAgentTargetSourceRef({
    agentHandle: '',
    ownerUserId: 'owner-1',
    sdk,
  }), null);
  assert.equal(await resolveAgentTargetSourceRef({
    agentHandle: 'agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    ownerUserId: '',
    sdk,
  }), null);
  assert.equal(opened, 0);
});

function createSourceTargetSdkStub(input: {
  references: Array<{ agentHandle: string; displayName: string; avatarUrl?: string | null }>;
  anchorByAgentHandle: Record<string, string>;
  summariesByLocalAgentRef: Record<string, Array<{ conversationAnchorId: string }>>;
  onOpen?: (agentHandle: string) => void;
}) {
  const base = createSdkStub({ summariesByLocalAgentRef: input.summariesByLocalAgentRef });
  return {
    ...base,
    appProduct: () => ({
      agents: {
        listReferences: async () => input.references.map((reference) => ({
          agentHandle: reference.agentHandle,
          displayName: reference.displayName,
          avatarUrl: reference.avatarUrl ?? null,
        })),
      },
    }),
    conversation: () => ({
      open: async ({ agentHandle }: { agentHandle: string }) => {
        input.onOpen?.(agentHandle);
        return {
          conversationAnchorId: input.anchorByAgentHandle[agentHandle] ?? '',
          activeTurnId: null,
        };
      },
    }),
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

test('source target snapshot resolution joins the source LocalAgent anchor to its App reference', async () => {
  const opened: string[] = [];
  const sdk = createSourceTargetSdkStub({
    references: [
      { agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', displayName: 'Agent A' },
      { agentHandle: 'agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', displayName: 'Agent B', avatarUrl: 'https://example.com/b.png' },
    ],
    anchorByAgentHandle: {
      agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA: 'anchor-a',
      agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB: 'anchor-b',
    },
    summariesByLocalAgentRef: {
      'local-agent:agent-b': [{ conversationAnchorId: 'anchor-b' }],
    },
    onOpen: (agentHandle) => {
      opened.push(agentHandle);
    },
  });

  const resolved = await resolveAgentTargetSnapshotForSourceRef({
    sourceRef: sourceRefB,
    ownerUserId: 'owner-1',
    sdk,
  });

  assert.equal(resolved?.agentHandle, 'agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
  assert.equal(resolved?.conversationAnchorId, 'anchor-b');
  assert.equal(resolved?.displayName, 'Agent B');
  assert.equal(resolved?.avatarUrl, 'https://example.com/b.png');
  assert.equal(opened.length, 2);
});

test('source target snapshot resolution fails closed when no reference anchor matches', async () => {
  const sdk = createSourceTargetSdkStub({
    references: [
      { agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', displayName: 'Agent A' },
    ],
    anchorByAgentHandle: {
      agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA: 'anchor-a',
    },
    summariesByLocalAgentRef: {
      'local-agent:agent-b': [{ conversationAnchorId: 'anchor-b' }],
    },
  });

  const resolved = await resolveAgentTargetSnapshotForSourceRef({
    sourceRef: sourceRefB,
    ownerUserId: 'owner-1',
    sdk,
  });

  assert.equal(resolved, null);
});

test('source target snapshot resolution fails closed when the source owns no LocalAgent', async () => {
  let opened = 0;
  const sdk = createSourceTargetSdkStub({
    references: [
      { agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', displayName: 'Agent A' },
    ],
    anchorByAgentHandle: {
      agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA: 'anchor-a',
    },
    summariesByLocalAgentRef: {
      'local-agent:agent-a': [{ conversationAnchorId: 'anchor-a' }],
    },
    onOpen: () => {
      opened += 1;
    },
  });

  const resolved = await resolveAgentTargetSnapshotForSourceRef({
    sourceRef: characterSourceRef('cbdb-person-c', 'c'.repeat(64)),
    ownerUserId: 'owner-1',
    sdk,
  });

  assert.equal(resolved, null);
  assert.equal(opened, 0);
});

test('source target snapshot resolution fails closed on ambiguous anchor matches', async () => {
  const sdk = createSourceTargetSdkStub({
    references: [
      { agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', displayName: 'Agent A' },
      { agentHandle: 'agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', displayName: 'Agent B' },
    ],
    anchorByAgentHandle: {
      agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA: 'anchor-b',
      agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB: 'anchor-b',
    },
    summariesByLocalAgentRef: {
      'local-agent:agent-b': [{ conversationAnchorId: 'anchor-b' }],
    },
  });

  const resolved = await resolveAgentTargetSnapshotForSourceRef({
    sourceRef: sourceRefB,
    ownerUserId: 'owner-1',
    sdk,
  });

  assert.equal(resolved, null);
});

test('source target snapshot resolution fails closed without an owner and never opens a conversation', async () => {
  let opened = 0;
  const sdk = createSourceTargetSdkStub({
    references: [
      { agentHandle: 'agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', displayName: 'Agent B' },
    ],
    anchorByAgentHandle: {
      agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB: 'anchor-b',
    },
    summariesByLocalAgentRef: {
      'local-agent:agent-b': [{ conversationAnchorId: 'anchor-b' }],
    },
    onOpen: () => {
      opened += 1;
    },
  });

  const resolved = await resolveAgentTargetSnapshotForSourceRef({
    sourceRef: sourceRefB,
    ownerUserId: '',
    sdk,
  });

  assert.equal(resolved, null);
  assert.equal(opened, 0);
});
