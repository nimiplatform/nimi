/**
 * Forge Agent Mutations (FG-AGENT-001)
 */

import { useMutation } from '@tanstack/react-query';
import {
  createCreatorAgent,
  deleteAgent,
  updateAgentDna,
  updateAgentSoulPrime,
  createCreatorKey,
  revokeCreatorKey,
  type ForgeCreateCreatorAgentInput,
  type ForgeCreateCreatorKeyInput,
  type ForgeUpdateAgentDnaInput,
  type ForgeUpdateAgentSoulPrimeInput,
} from '@renderer/data/agent-data-client.js';

export function useAgentMutations() {
  const createAgentMutation = useMutation({
    mutationFn: async (payload: ForgeCreateCreatorAgentInput) =>
      await createCreatorAgent(payload),
  });

  const deleteAgentMutation = useMutation({
    mutationFn: async (agentId: string) =>
      await deleteAgent(agentId),
  });

  const updateDnaMutation = useMutation({
    mutationFn: async (input: { agentId: string; dna: ForgeUpdateAgentDnaInput }) =>
      await updateAgentDna(input.agentId, input.dna),
  });

  const updateSoulPrimeMutation = useMutation({
    mutationFn: async (input: { agentId: string; soulPrime: ForgeUpdateAgentSoulPrimeInput }) =>
      await updateAgentSoulPrime(input.agentId, input.soulPrime),
  });

  const createKeyMutation = useMutation({
    mutationFn: async (payload: ForgeCreateCreatorKeyInput) =>
      await createCreatorKey(payload),
  });

  const revokeKeyMutation = useMutation({
    mutationFn: async (keyId: string) =>
      await revokeCreatorKey(keyId),
  });

  return {
    createAgentMutation,
    deleteAgentMutation,
    updateDnaMutation,
    updateSoulPrimeMutation,
    createKeyMutation,
    revokeKeyMutation,
  };
}
