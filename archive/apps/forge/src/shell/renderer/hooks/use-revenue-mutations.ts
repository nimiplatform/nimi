/**
 * Forge Revenue Mutations (FG-REV-001..005)
 */

import { useMutation } from '@tanstack/react-query';
import {
  createConnectOnboarding,
  createConnectDashboard,
  createWithdrawal,
  type ForgeCreateConnectOnboardingInput,
  type ForgeCreateWithdrawalInput,
} from '@renderer/data/revenue-data-client.js';

export function useRevenueMutations() {
  const connectOnboardingMutation = useMutation({
    mutationFn: async (payload: ForgeCreateConnectOnboardingInput) =>
      await createConnectOnboarding(payload),
  });

  const connectDashboardMutation = useMutation({
    mutationFn: async () => await createConnectDashboard(),
  });

  const createWithdrawalMutation = useMutation({
    mutationFn: async (payload: ForgeCreateWithdrawalInput) =>
      await createWithdrawal(payload),
  });

  return {
    connectOnboardingMutation,
    connectDashboardMutation,
    createWithdrawalMutation,
  };
}
