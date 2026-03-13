import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const mockRevenueDataClient = vi.hoisted(() => ({
  getBalances: vi.fn(),
  getSparkHistory: vi.fn(),
  getGemHistory: vi.fn(),
  getRevenueShareConfig: vi.fn(),
  previewRevenueDistribution: vi.fn(),
  getConnectStatus: vi.fn(),
  getWithdrawalConfig: vi.fn(),
  canWithdraw: vi.fn(),
  calculateWithdrawal: vi.fn(),
  createWithdrawal: vi.fn(),
  getWithdrawalHistory: vi.fn(),
  getWithdrawal: vi.fn(),
  createConnectOnboarding: vi.fn(),
  createConnectDashboard: vi.fn(),
  getAgentOrigin: vi.fn(),
}));

vi.mock('@renderer/data/revenue-data-client.js', () => mockRevenueDataClient);

import {
  useBalancesQuery,
  useSparkHistoryQuery,
  useConnectStatusQuery,
} from './use-revenue-queries.js';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useBalancesQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes { sparkBalance, gemBalance }', async () => {
    mockRevenueDataClient.getBalances.mockResolvedValue({
      sparkBalance: 1500,
      gemBalance: 250,
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useBalancesQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      sparkBalance: 1500,
      gemBalance: 250,
    });
  });

  it('falls back to spark/gem aliases if sparkBalance/gemBalance not present', async () => {
    mockRevenueDataClient.getBalances.mockResolvedValue({
      spark: 999,
      gem: 42,
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useBalancesQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      sparkBalance: 999,
      gemBalance: 42,
    });
  });

  it('defaults to 0 when balance fields are missing', async () => {
    mockRevenueDataClient.getBalances.mockResolvedValue({});

    const wrapper = createWrapper();
    const { result } = renderHook(() => useBalancesQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      sparkBalance: 0,
      gemBalance: 0,
    });
  });
});

describe('useSparkHistoryQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes history entries from { items } payload', async () => {
    mockRevenueDataClient.getSparkHistory.mockResolvedValue({
      items: [
        {
          id: 'h1',
          type: 'GIFT_RECEIVED',
          amount: 100,
          fromUserId: 'user2',
          description: 'Gift from fan',
          createdAt: '2026-01-01',
        },
        {
          id: 'h2',
          transactionType: 'PURCHASE',
          amount: 50,
          fromUserId: null,
          memo: 'Spark purchase',
          createdAt: '2026-01-02',
        },
      ],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useSparkHistoryQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0]).toMatchObject({
      id: 'h1',
      type: 'GIFT_RECEIVED',
      amount: 100,
      fromUserId: 'user2',
      description: 'Gift from fan',
    });
    // Falls back to transactionType and memo
    expect(result.current.data![1]).toMatchObject({
      id: 'h2',
      type: 'PURCHASE',
      amount: 50,
      description: 'Spark purchase',
    });
  });

  it('normalizes history entries from array payload', async () => {
    mockRevenueDataClient.getSparkHistory.mockResolvedValue([
      { id: 'h3', type: 'BONUS', amount: 200, description: 'Welcome bonus', createdAt: '2026-02-01' },
    ]);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useSparkHistoryQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].id).toBe('h3');
  });
});

describe('useConnectStatusQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes connect status', async () => {
    mockRevenueDataClient.getConnectStatus.mockResolvedValue({
      status: 'connected',
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useConnectStatusQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ status: 'connected' });
  });

  it('defaults to not_connected when status is missing', async () => {
    mockRevenueDataClient.getConnectStatus.mockResolvedValue({});

    const wrapper = createWrapper();
    const { result } = renderHook(() => useConnectStatusQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ status: 'not_connected' });
  });
});
