import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const mockAgentDataClient = vi.hoisted(() => ({
  listCreatorAgents: vi.fn(),
  getAgent: vi.fn(),
  getAgentSoulPrime: vi.fn(),
  listCreatorKeys: vi.fn(),
  createCreatorAgent: vi.fn(),
  batchCreateCreatorAgents: vi.fn(),
  deleteAgent: vi.fn(),
  updateAgent: vi.fn(),
  updateAgentDna: vi.fn(),
  updateAgentSoulPrime: vi.fn(),
  createCreatorKey: vi.fn(),
  revokeCreatorKey: vi.fn(),
  getAgentByHandle: vi.fn(),
  getAgentVisibility: vi.fn(),
  updateAgentVisibility: vi.fn(),
}));

vi.mock('@renderer/data/agent-data-client.js', () => mockAgentDataClient);

import {
  useAgentListQuery,
  useAgentDetailQuery,
  useAgentSoulPrimeQuery,
  useCreatorKeysQuery,
} from './use-agent-queries.js';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useAgentListQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns query with correct key and normalizes agent summary list (toAgentSummaryList)', async () => {
    mockAgentDataClient.listCreatorAgents.mockResolvedValue({
      items: [
        {
          id: 'a1',
          handle: 'test-agent',
          displayName: 'Test Agent',
          concept: 'A test agent',
          ownershipType: 'MASTER_OWNED',
          worldId: null,
          status: 'active',
          avatarUrl: 'https://example.com/avatar.png',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-02',
        },
      ],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useAgentListQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0]).toMatchObject({
      id: 'a1',
      handle: 'test-agent',
      displayName: 'Test Agent',
      concept: 'A test agent',
      ownershipType: 'MASTER_OWNED',
    });
  });

  it('filters out items with empty id', async () => {
    mockAgentDataClient.listCreatorAgents.mockResolvedValue({
      items: [
        { id: '', handle: 'empty', displayName: 'Empty', concept: '' },
        { id: 'a2', handle: 'valid', displayName: 'Valid', concept: 'ok' },
      ],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useAgentListQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data ?? [];
    expect(data).toHaveLength(1);
    expect(data[0]?.id).toBe('a2');
  });
});

describe('useAgentDetailQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses agentId in query key and normalizes detail (toAgentDetail)', async () => {
    mockAgentDataClient.getAgent.mockResolvedValue({
      id: 'a1',
      handle: 'test-agent',
      displayName: 'Test Agent',
      concept: 'A test concept',
      description: 'Full description',
      scenario: null,
      greeting: 'Hello!',
      ownershipType: 'WORLD_OWNED',
      worldId: 'w1',
      status: 'active',
      state: 'READY',
      avatarUrl: null,
      dna: { personality: 'cheerful' },
      rules: { format: 'rule-lines-v1', lines: ['Be kind'], text: 'Be kind' },
      wakeStrategy: 'PROACTIVE',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useAgentDetailQuery('a1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockAgentDataClient.getAgent).toHaveBeenCalledWith('a1');
    const detail = result.current.data!;
    expect(detail.id).toBe('a1');
    expect(detail.ownershipType).toBe('WORLD_OWNED');
    expect(detail.wakeStrategy).toBe('PROACTIVE');
    expect(detail.rules).toEqual({
      format: 'rule-lines-v1',
      lines: ['Be kind'],
      text: 'Be kind',
    });
    expect(detail.dna).toEqual({ personality: 'cheerful' });
  });

  it('does not fetch when agentId is empty', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useAgentDetailQuery(''), { wrapper });

    await new Promise((r) => setTimeout(r, 50));
    expect(mockAgentDataClient.getAgent).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreatorKeysQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes key list (toKeyList)', async () => {
    mockAgentDataClient.listCreatorKeys.mockResolvedValue({
      items: [
        {
          id: 'k1',
          name: 'production-key',
          keyPreview: 'sk_****abc',
          createdAt: '2026-01-01',
          lastUsedAt: '2026-03-01',
          expiresAt: null,
        },
      ],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useCreatorKeysQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0]).toMatchObject({
      id: 'k1',
      name: 'production-key',
      keyPreview: 'sk_****abc',
      lastUsedAt: '2026-03-01',
      expiresAt: null,
    });
  });

  it('handles array payload (not wrapped in { items })', async () => {
    mockAgentDataClient.listCreatorKeys.mockResolvedValue([
      { id: 'k2', name: 'dev-key', key: 'sk_****xyz', createdAt: '2026-01-01' },
    ]);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useCreatorKeysQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data ?? [];
    expect(data).toHaveLength(1);
    expect(data[0]?.keyPreview).toBe('sk_****xyz');
  });
});
