import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const mockAgentDataClient = vi.hoisted(() => ({
  createCreatorAgent: vi.fn(),
  deleteAgent: vi.fn(),
  updateAgentDna: vi.fn(),
  updateAgentSoulPrime: vi.fn(),
  createCreatorKey: vi.fn(),
  revokeCreatorKey: vi.fn(),
  listCreatorAgents: vi.fn(),
  batchCreateCreatorAgents: vi.fn(),
  getAgent: vi.fn(),
  updateAgent: vi.fn(),
  getAgentByHandle: vi.fn(),
  getAgentSoulPrime: vi.fn(),
  listCreatorKeys: vi.fn(),
  getAgentVisibility: vi.fn(),
  updateAgentVisibility: vi.fn(),
}));

vi.mock('@renderer/data/agent-data-client.js', () => mockAgentDataClient);

import { useAgentMutations } from './use-agent-mutations.js';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useAgentMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all expected mutation objects', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useAgentMutations(), { wrapper });

    expect(result.current).toHaveProperty('createAgentMutation');
    expect(result.current).toHaveProperty('deleteAgentMutation');
    expect(result.current).toHaveProperty('updateDnaMutation');
    expect(result.current).toHaveProperty('updateSoulPrimeMutation');
    expect(result.current).toHaveProperty('createKeyMutation');
    expect(result.current).toHaveProperty('revokeKeyMutation');
  });

  it('createAgentMutation calls createCreatorAgent', async () => {
    mockAgentDataClient.createCreatorAgent.mockResolvedValue({ id: 'new-agent' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useAgentMutations(), { wrapper });

    await act(async () => {
      result.current.createAgentMutation.mutate({ handle: 'test', concept: 'A test agent' });
    });

    await vi.waitFor(() => expect(result.current.createAgentMutation.isSuccess).toBe(true));
    expect(mockAgentDataClient.createCreatorAgent).toHaveBeenCalledWith({
      handle: 'test',
      concept: 'A test agent',
    });
  });

  it('deleteAgentMutation calls deleteAgent with agentId', async () => {
    mockAgentDataClient.deleteAgent.mockResolvedValue({});

    const wrapper = createWrapper();
    const { result } = renderHook(() => useAgentMutations(), { wrapper });

    await act(async () => {
      result.current.deleteAgentMutation.mutate('agent-to-delete');
    });

    await vi.waitFor(() => expect(result.current.deleteAgentMutation.isSuccess).toBe(true));
    expect(mockAgentDataClient.deleteAgent).toHaveBeenCalledWith('agent-to-delete');
  });

  it('updateDnaMutation calls updateAgentDna with agentId and dna', async () => {
    mockAgentDataClient.updateAgentDna.mockResolvedValue({});

    const wrapper = createWrapper();
    const { result } = renderHook(() => useAgentMutations(), { wrapper });

    await act(async () => {
      result.current.updateDnaMutation.mutate({
        agentId: 'a1',
        dna: { personality: 'cheerful' },
      });
    });

    await vi.waitFor(() => expect(result.current.updateDnaMutation.isSuccess).toBe(true));
    expect(mockAgentDataClient.updateAgentDna).toHaveBeenCalledWith('a1', { personality: 'cheerful' });
  });

  it('revokeKeyMutation calls revokeCreatorKey with keyId', async () => {
    mockAgentDataClient.revokeCreatorKey.mockResolvedValue({});

    const wrapper = createWrapper();
    const { result } = renderHook(() => useAgentMutations(), { wrapper });

    await act(async () => {
      result.current.revokeKeyMutation.mutate('key-123');
    });

    await vi.waitFor(() => expect(result.current.revokeKeyMutation.isSuccess).toBe(true));
    expect(mockAgentDataClient.revokeCreatorKey).toHaveBeenCalledWith('key-123');
  });
});
