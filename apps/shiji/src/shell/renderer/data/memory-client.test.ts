import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryCanonicalClass, MemoryRecordKind } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';

const mockGetAgent = vi.fn();
const mockInitializeAgent = vi.fn();
const mockUpdateAgentState = vi.fn();
const mockQueryMemory = vi.fn();
const mockWriteMemory = vi.fn();
const mockRegisterApp = vi.fn();
const mockAuthorizeExternalPrincipal = vi.fn();
const mockGetState = vi.fn();

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      appId: 'nimi.shiji',
      auth: {
        registerApp: mockRegisterApp,
      },
      appAuth: {
        authorizeExternalPrincipal: mockAuthorizeExternalPrincipal,
      },
      agentCore: {
        getAgent: mockGetAgent,
        initializeAgent: mockInitializeAgent,
        updateAgentState: mockUpdateAgentState,
        queryMemory: mockQueryMemory,
        writeMemory: mockWriteMemory,
      },
    },
  }),
}));

vi.mock('@renderer/app-shell/app-store.js', () => ({
  useAppStore: {
    getState: mockGetState,
  },
}));

const { recallAgentMemory, writeAgentMemory } = await import('./memory-client.js');

describe('shiji memory-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({
      auth: {
        user: {
          id: 'guardian-1',
        },
      },
    });
    mockGetAgent.mockResolvedValue({});
    mockInitializeAgent.mockResolvedValue({});
    mockUpdateAgentState.mockResolvedValue({});
    mockQueryMemory.mockResolvedValue({
      memories: [],
    });
    mockWriteMemory.mockResolvedValue({
      accepted: [{ record: { memoryId: 'mem-1' } }],
      rejected: [],
    });
    mockRegisterApp.mockResolvedValue({
      accepted: true,
    });
    mockAuthorizeExternalPrincipal.mockResolvedValue({
      tokenId: 'protected-token-id',
      secret: 'protected-token-secret',
    });
  });

  it('recallAgentMemory maps runtime dyadic memories and returns [] when agent is missing', async () => {
    mockGetAgent.mockRejectedValueOnce({
      reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
      actionHint: 'check_runtime_agent_core',
      traceId: '',
      retryable: false,
      source: 'runtime',
      message: 'agent missing',
    });

    await expect(recallAgentMemory('agent-1', 'learner-1')).resolves.toEqual([]);

    mockGetAgent.mockResolvedValueOnce({});
    mockQueryMemory.mockResolvedValueOnce({
      memories: [
        {
          canonicalClass: MemoryCanonicalClass.DYADIC,
          record: {
            memoryId: 'mem-1',
            payload: {
              oneofKind: 'observational',
              observational: {
                observation: 'Learner likes puzzles',
              },
            },
            createdAt: { seconds: '1714521600', nanos: 0 },
            updatedAt: { seconds: '1714521600', nanos: 0 },
          },
        },
      ],
    });

    await expect(recallAgentMemory('agent-1', 'learner-1')).resolves.toEqual([
      {
        id: 'mem-1',
        content: 'Learner likes puzzles',
        class: 'DYADIC',
        createdAt: '2024-05-01T00:00:00.000Z',
      },
    ]);

    expect(mockUpdateAgentState).toHaveBeenLastCalledWith({
      context: {
        appId: 'nimi.shiji',
        subjectUserId: 'guardian-1',
      },
      agentId: 'agent-1',
      mutations: [
        {
          mutation: {
            oneofKind: 'setDyadicContext',
            setDyadicContext: {
              userId: 'learner-1',
            },
          },
        },
        {
          mutation: {
            oneofKind: 'clearWorldContext',
            clearWorldContext: {},
          },
        },
      ],
    }, {
      protectedAccessToken: {
        tokenId: 'protected-token-id',
        secret: 'protected-token-secret',
      },
    });
    expect(mockQueryMemory).toHaveBeenCalledWith({
      context: {
        appId: 'nimi.shiji',
        subjectUserId: 'guardian-1',
      },
      agentId: 'agent-1',
      query: '',
      limit: 100,
      canonicalClasses: [MemoryCanonicalClass.DYADIC],
      kinds: [],
      includeInvalidated: false,
    }, {
      protectedAccessToken: {
        tokenId: 'protected-token-id',
        secret: 'protected-token-secret',
      },
    });
  });

  it('writeAgentMemory initializes missing agents and writes admitted dyadic observational memories', async () => {
    mockGetAgent.mockRejectedValueOnce({
      reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
      actionHint: 'check_runtime_agent_core',
      traceId: '',
      retryable: false,
      source: 'runtime',
      message: 'agent missing',
    });

    await writeAgentMemory({
      agentId: 'agent-1',
      learnerId: 'learner-1',
      worldId: 'world-1',
      sessionId: 'session-1',
      memoryText: 'Learner solved the riddle confidently',
    });

    expect(mockInitializeAgent).toHaveBeenCalledWith({
      context: {
        appId: 'nimi.shiji',
        subjectUserId: 'guardian-1',
      },
      agentId: 'agent-1',
      displayName: 'agent-1',
      autonomyConfig: undefined,
      worldId: 'world-1',
      metadata: undefined,
    }, {
      protectedAccessToken: {
        tokenId: 'protected-token-id',
        secret: 'protected-token-secret',
      },
    });
    expect(mockWriteMemory).toHaveBeenCalledTimes(1);
    const request = mockWriteMemory.mock.calls[0]?.[0];
    const options = mockWriteMemory.mock.calls[0]?.[1];
    const candidate = request.candidates[0];
    expect(candidate.canonicalClass).toBe(MemoryCanonicalClass.DYADIC);
    expect(candidate.record.kind).toBe(MemoryRecordKind.OBSERVATIONAL);
    expect(candidate.targetBank.owner.agentDyadic).toEqual({
      agentId: 'agent-1',
      userId: 'learner-1',
    });
    expect(candidate.record.provenance.sourceSystem).toBe('nimi.shiji');
    expect(candidate.record.provenance.authorId).toBe('guardian-1');
    expect(candidate.record.provenance.traceId).toBe('session-1');
    expect(candidate.record.payload.observational.observation).toBe('Learner solved the riddle confidently');
    expect(options).toEqual({
      protectedAccessToken: {
        tokenId: 'protected-token-id',
        secret: 'protected-token-secret',
      },
    });
  });

  it('writeAgentMemory fails closed when runtime rejects the candidate', async () => {
    mockWriteMemory.mockResolvedValueOnce({
      accepted: [],
      rejected: [{ reasonCode: ReasonCode.AI_OUTPUT_INVALID }],
    });

    await expect(writeAgentMemory({
      agentId: 'agent-1',
      learnerId: 'learner-1',
      worldId: 'world-1',
      sessionId: 'session-1',
      memoryText: 'Rejected memory',
    })).rejects.toThrow(/did not admit shiji dyadic memory/);
  });

  it('soft-disables recall and writes when runtime memory is unavailable', async () => {
    mockQueryMemory.mockRejectedValueOnce({
      reasonCode: 'AI_LOCAL_SERVICE_UNAVAILABLE',
      actionHint: 'install_or_attach_memory_provider',
      traceId: '',
      retryable: false,
      source: 'runtime',
      message: 'local memory substrate is not configured',
    });

    await expect(recallAgentMemory('agent-1', 'learner-1')).resolves.toEqual([]);

    mockGetAgent.mockRejectedValueOnce({
      reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
      actionHint: 'check_runtime_agent_core',
      traceId: '',
      retryable: false,
      source: 'runtime',
      message: 'agent missing',
    });
    mockInitializeAgent.mockRejectedValueOnce({
      reasonCode: 'AI_LOCAL_SERVICE_UNAVAILABLE',
      actionHint: 'install_or_attach_memory_provider',
      traceId: '',
      retryable: false,
      source: 'runtime',
      message: 'local memory substrate is not configured',
    });

    await expect(writeAgentMemory({
      agentId: 'agent-1',
      learnerId: 'learner-1',
      worldId: 'world-1',
      sessionId: 'session-1',
      memoryText: 'No-op memory',
    })).resolves.toBeUndefined();

    expect(mockWriteMemory).not.toHaveBeenCalled();
  });
});
