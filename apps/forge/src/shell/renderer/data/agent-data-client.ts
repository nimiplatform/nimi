/**
 * Agent Data Client — Forge adapter (FG-AGENT-001)
 *
 * Direct SDK realm client calls for agent management.
 * Uses CreatorService for creator-scoped ops, AgentsService for agent-level ops.
 */

import { getPlatformClient } from '@runtime/platform-client.js';

function realm() {
  return getPlatformClient().realm;
}

// ── Creator-Scoped Agent Ops ──────────────────────────────

export async function listCreatorAgents() {
  return realm().services.CreatorService.creatorControllerListAgents();
}

export async function createCreatorAgent(payload: Record<string, unknown>) {
  return realm().services.CreatorService.creatorControllerCreateAgent(payload);
}

export async function batchCreateCreatorAgents(payload: {
  items: Array<Record<string, unknown>>;
  continueOnError?: boolean;
}) {
  return realm().services.CreatorService.creatorControllerBatchCreateAgents(payload);
}

// ── Agent Detail Ops (creator-scoped) ─────────────────────

export async function getAgent(agentId: string) {
  return realm().services.CreatorService.creatorControllerGetAgent(agentId);
}

export async function updateAgent(agentId: string, payload: Record<string, unknown>) {
  return realm().services.CreatorService.creatorControllerUpdateAgent(agentId, payload);
}

export async function deleteAgent(agentId: string) {
  return realm().services.CreatorService.creatorControllerDeleteAgent(agentId);
}

export async function getAgentByHandle(handle: string) {
  return realm().services.AgentsService.getAgentByHandle(handle);
}

// ── DNA Ops ───────────────────────────────────────────────

export async function updateAgentDna(agentId: string, dna: Record<string, unknown>) {
  return realm().services.AgentsService.agentControllerUpdateDna(agentId, dna);
}

export async function getAgentSoulPrime(agentId: string) {
  return realm().services.AgentsService.agentControllerGetSoulPrime(agentId);
}

export async function updateAgentSoulPrime(agentId: string, soulPrime: Record<string, unknown>) {
  return realm().services.AgentsService.agentControllerUpdateSoulPrime(agentId, soulPrime);
}

// ── API Keys ──────────────────────────────────────────────

export async function listCreatorKeys() {
  return realm().services.CreatorService.creatorControllerListKeys();
}

export async function createCreatorKey(payload: Record<string, unknown>) {
  return realm().services.CreatorService.creatorControllerCreateKey(payload);
}

export async function revokeCreatorKey(keyId: string) {
  return realm().services.CreatorService.creatorControllerRevokeKey(keyId);
}

// ── Agent Visibility ──────────────────────────────────────

export async function getAgentVisibility(agentId: string) {
  return realm().services.AgentsService.agentControllerGetVisibility(agentId);
}

export async function updateAgentVisibility(agentId: string, payload: Record<string, unknown>) {
  return realm().services.AgentsService.agentControllerUpdateVisibility(agentId, payload);
}
