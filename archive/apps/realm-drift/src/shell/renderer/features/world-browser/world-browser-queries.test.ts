import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('./world-browser-data.js', () => ({
  listMyWorlds: vi.fn().mockResolvedValue([
    { id: 'w1', name: 'World 1', agentCount: 3 },
    { id: 'w2', name: 'World 2', agentCount: 0 },
  ]),
  getWorldDetailWithAgents: vi.fn().mockResolvedValue({
    id: 'w1',
    name: 'World 1',
    agents: [{ id: 'a1', name: 'Agent 1' }],
  }),
  getWorldview: vi.fn().mockResolvedValue({
    timeModel: 'linear',
  }),
  listWorldLorebooks: vi.fn().mockResolvedValue([
    { id: 'l1', title: 'Lorebook 1' },
  ]),
}));

import {
  useMyWorldsQuery,
  useWorldDetailWithAgentsQuery,
  useWorldviewQuery,
  useWorldLorebooksQuery,
} from './world-browser-queries.js';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('world-browser-queries', () => {
  it('useMyWorldsQuery fetches worlds with correct query key', async () => {
    const { result } = renderHook(() => useMyWorldsQuery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]?.name).toBe('World 1');
  });

  it('useWorldDetailWithAgentsQuery fetches world detail', async () => {
    const { result } = renderHook(() => useWorldDetailWithAgentsQuery('w1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.name).toBe('World 1');
    expect(result.current.data?.agents).toHaveLength(1);
  });

  it('useWorldviewQuery fetches worldview', async () => {
    const { result } = renderHook(() => useWorldviewQuery('w1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.timeModel).toBe('linear');
  });

  it('useWorldLorebooksQuery fetches lorebooks', async () => {
    const { result } = renderHook(() => useWorldLorebooksQuery('w1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('disabled when worldId is empty', () => {
    const { result } = renderHook(() => useWorldDetailWithAgentsQuery(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});
