import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const mockRevenueDataClient = vi.hoisted(() => ({
  createConnectOnboarding: vi.fn(),
  createConnectDashboard: vi.fn(),
  createWithdrawal: vi.fn(),
  getBalances: vi.fn(),
  getSparkHistory: vi.fn(),
  getGemHistory: vi.fn(),
  getRevenueShareConfig: vi.fn(),
  previewRevenueDistribution: vi.fn(),
  getConnectStatus: vi.fn(),
  getWithdrawalConfig: vi.fn(),
  canWithdraw: vi.fn(),
  calculateWithdrawal: vi.fn(),
  getWithdrawalHistory: vi.fn(),
  getWithdrawal: vi.fn(),
  getAgentOrigin: vi.fn(),
}));

vi.mock('@renderer/data/revenue-data-client.js', () => mockRevenueDataClient);

import { useRevenueMutations } from './use-revenue-mutations.js';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useRevenueMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all 3 expected mutation objects', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useRevenueMutations(), { wrapper });

    expect(result.current).toHaveProperty('connectOnboardingMutation');
    expect(result.current).toHaveProperty('connectDashboardMutation');
    expect(result.current).toHaveProperty('createWithdrawalMutation');
  });

  it('connectOnboardingMutation calls createConnectOnboarding', async () => {
    mockRevenueDataClient.createConnectOnboarding.mockResolvedValue({ url: 'https://onboard.stripe.com' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useRevenueMutations(), { wrapper });

    await act(async () => {
      result.current.connectOnboardingMutation.mutate({ returnUrl: 'https://app.example.com' });
    });

    await vi.waitFor(() => expect(result.current.connectOnboardingMutation.isSuccess).toBe(true));
    expect(mockRevenueDataClient.createConnectOnboarding).toHaveBeenCalledWith({
      returnUrl: 'https://app.example.com',
    });
  });

  it('connectDashboardMutation calls createConnectDashboard', async () => {
    mockRevenueDataClient.createConnectDashboard.mockResolvedValue({ url: 'https://dashboard.stripe.com' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useRevenueMutations(), { wrapper });

    await act(async () => {
      result.current.connectDashboardMutation.mutate();
    });

    await vi.waitFor(() => expect(result.current.connectDashboardMutation.isSuccess).toBe(true));
    expect(mockRevenueDataClient.createConnectDashboard).toHaveBeenCalled();
  });

  it('createWithdrawalMutation calls createWithdrawal with payload', async () => {
    mockRevenueDataClient.createWithdrawal.mockResolvedValue({ id: 'w1', status: 'pending' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useRevenueMutations(), { wrapper });

    await act(async () => {
      result.current.createWithdrawalMutation.mutate({ amount: '100.00' });
    });

    await vi.waitFor(() => expect(result.current.createWithdrawalMutation.isSuccess).toBe(true));
    expect(mockRevenueDataClient.createWithdrawal).toHaveBeenCalledWith({ amount: '100.00' });
  });
});
