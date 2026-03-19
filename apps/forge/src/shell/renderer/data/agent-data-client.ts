/**
 * Agent Data Client — Forge adapter (FG-AGENT-001)
 *
 * Direct SDK realm client calls for agent management.
 * Uses CreatorService for creator-scoped ops, AgentsService for agent-level ops.
 */

import { getPlatformClient } from '@nimiplatform/sdk';
import type { RealmServiceArgs } from '@nimiplatform/sdk/realm';

function realm() {
  return getPlatformClient().realm;
}

type CreateCreatorAgentInput = RealmServiceArgs<'CreatorService', 'creatorControllerCreateAgent'>[0];
type BatchCreateCreatorAgentsInput = RealmServiceArgs<'CreatorService', 'creatorControllerBatchCreateAgents'>[0];
type UpdateAgentInput = RealmServiceArgs<'CreatorService', 'creatorControllerUpdateAgent'>[1];
type UpdateAgentDnaInput = RealmServiceArgs<'AgentsService', 'agentControllerUpdateDna'>[1];
type UpdateAgentSoulPrimeInput = RealmServiceArgs<'AgentsService', 'agentControllerUpdateSoulPrime'>[1];
type CreateCreatorKeyInput = RealmServiceArgs<'CreatorService', 'creatorControllerCreateKey'>[0];
type UpdateAgentVisibilityInput = RealmServiceArgs<'AgentsService', 'agentControllerUpdateVisibility'>[1];
export type ForgeCreateCreatorAgentInput = CreateCreatorAgentInput | {
  handle?: string;
  displayName?: string;
  name?: string;
  concept?: string;
  ownerType?: string;
  worldId?: string;
  [key: string]: unknown;
};
export type ForgeBatchCreateCreatorAgentsInput = {
  items: ForgeCreateCreatorAgentInput[];
  continueOnError?: boolean;
};
export type ForgeUpdateAgentDnaInput = UpdateAgentDnaInput | {
  dna?: UpdateAgentDnaInput['dna'];
  [key: string]: unknown;
};
export type ForgeUpdateAgentSoulPrimeInput = UpdateAgentSoulPrimeInput | {
  soulPrime?: UpdateAgentSoulPrimeInput['soulPrime'];
  [key: string]: unknown;
};
export type ForgeCreateCreatorKeyInput = CreateCreatorKeyInput | {
  name?: string;
  label?: string;
  type?: CreateCreatorKeyInput['type'];
  scopes?: string[];
  [key: string]: unknown;
};
export type ForgeUpdateAgentVisibilityInput = UpdateAgentVisibilityInput | {
  visibility?: string;
  [key: string]: unknown;
};
export type ForgeCreatorAgentListItem = {
  id: string;
  handle: string;
  displayName: string;
  concept: string;
  ownershipType: 'MASTER_OWNED' | 'WORLD_OWNED';
  worldId: string | null;
  status: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ForgeCreatorAgentListResponse = {
  items: ForgeCreatorAgentListItem[];
};
export type ForgeAgentDna = {
  primaryType?: string;
  secondaryTraits?: string[];
  voice?: {
    voiceId?: string;
  };
  [key: string]: unknown;
};
export type ForgeAgentDetailResponse = ForgeCreatorAgentListItem & {
  description: string | null;
  scenario: string | null;
  greeting: string | null;
  state: string;
  dna: ForgeAgentDna | null;
  rules: { format: string; lines: string[]; text: string } | null;
  wakeStrategy: 'PASSIVE' | 'PROACTIVE';
};
export type ForgeCreatorKeyListItem = {
  id: string;
  name: string;
  keyPreview: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};
export type ForgeCreatorKeyListResponse = {
  items: ForgeCreatorKeyListItem[];
};

type LooseObject = { [key: string]: unknown };

function isLooseObject(value: unknown): value is LooseObject {
  return Boolean(value) && typeof value === 'object';
}

function toLooseObject(value: unknown): LooseObject {
  return isLooseObject(value) ? value : {};
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeCreatorAgentListItem(value: unknown): ForgeCreatorAgentListItem | null {
  const item = toLooseObject(value);
  const user = toLooseObject(item.user);
  const agent = toLooseObject(user.agent);
  const agentProfile = toLooseObject(item.agentProfile);
  const id = String(item.id || item.agentId || user.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    id,
    handle: String(item.handle || user.handle || '').trim(),
    displayName: String(item.displayName || user.displayName || item.name || user.name || '').trim(),
    concept: String(item.concept || agent.concept || '').trim(),
    ownershipType: agent.worldId ? 'WORLD_OWNED' : 'MASTER_OWNED',
    worldId: toStringOrNull(agent.worldId),
    status: String(item.status || agent.status || 'draft').trim() || 'draft',
    avatarUrl: toStringOrNull(item.avatarUrl ?? user.avatarUrl ?? agentProfile.avatarUrl),
    createdAt: String(item.createdAt || user.createdAt || '').trim(),
    updatedAt: String(item.updatedAt || user.updatedAt || '').trim(),
  };
}

function normalizeAgentRules(value: unknown): ForgeAgentDetailResponse['rules'] {
  const rules = toLooseObject(value);
  if (!rules.format && !rules.text && !Array.isArray(rules.lines)) {
    return null;
  }
  return {
    format: String(rules.format || 'rule-lines-v1'),
    lines: Array.isArray(rules.lines) ? rules.lines.map((line) => String(line || '')) : [],
    text: String(rules.text || ''),
  };
}

function normalizeAgentDetail(value: unknown): ForgeAgentDetailResponse {
  const item = toLooseObject(value);
  const user = toLooseObject(item.user);
  const agent = toLooseObject(user.agent);
  const agentProfile = toLooseObject(item.agentProfile);
  const listItem = normalizeCreatorAgentListItem(value) ?? {
    id: String(item.id || '').trim(),
    handle: '',
    displayName: '',
    concept: '',
    ownershipType: 'MASTER_OWNED' as const,
    worldId: null,
    status: 'draft',
    avatarUrl: null,
    createdAt: '',
    updatedAt: '',
  };
  return {
    ...listItem,
    description: toStringOrNull(item.description ?? item.bio ?? user.bio),
    scenario: toStringOrNull(item.scenario),
    greeting: toStringOrNull(item.greeting),
    state: String(item.state || agent.state || 'INCUBATING').trim() || 'INCUBATING',
    dna: isLooseObject(item.dna)
      ? item.dna as ForgeAgentDna
      : isLooseObject(agentProfile.dna)
        ? agentProfile.dna as ForgeAgentDna
        : null,
    rules: normalizeAgentRules(item.rules),
    wakeStrategy: String(item.wakeStrategy || agent.wakeStrategy || 'PASSIVE') === 'PROACTIVE'
      ? 'PROACTIVE'
      : 'PASSIVE',
  };
}

function normalizeCreatorKeyListItem(value: unknown): ForgeCreatorKeyListItem | null {
  const item = toLooseObject(value);
  const id = String(item.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    id,
    name: String(item.name || item.label || 'Unnamed Key').trim(),
    keyPreview: String(item.keyPreview || item.key || '****').trim() || '****',
    createdAt: String(item.createdAt || '').trim(),
    lastUsedAt: toStringOrNull(item.lastUsedAt),
    expiresAt: toStringOrNull(item.expiresAt),
  };
}

// ── Creator-Scoped Agent Ops ──────────────────────────────

export async function listCreatorAgents() {
  const payload = await realm().services.CreatorService.creatorControllerListAgents();
  const root = toLooseObject(payload);
  const items = Array.isArray(root.items) ? root.items : [];
  return {
    items: items
      .map(normalizeCreatorAgentListItem)
      .filter((item): item is ForgeCreatorAgentListItem => item !== null),
  } satisfies ForgeCreatorAgentListResponse;
}

function normalizeCreateCreatorAgentInput(payload: ForgeCreateCreatorAgentInput): CreateCreatorAgentInput {
  if ('handle' in payload && 'concept' in payload) {
    return payload as CreateCreatorAgentInput;
  }
  return {
    ...payload,
    handle: String(payload.handle || payload.displayName || payload.name || '').trim(),
    displayName: String(payload.displayName || payload.name || '').trim(),
    concept: String(payload.concept || payload.displayName || payload.name || '').trim(),
  };
}

export async function createCreatorAgent(payload: ForgeCreateCreatorAgentInput) {
  return realm().services.CreatorService.creatorControllerCreateAgent(normalizeCreateCreatorAgentInput(payload));
}

export async function batchCreateCreatorAgents(payload: ForgeBatchCreateCreatorAgentsInput) {
  return realm().services.CreatorService.creatorControllerBatchCreateAgents({
    items: payload.items.map(normalizeCreateCreatorAgentInput),
    continueOnError: payload.continueOnError ?? false,
  });
}

// ── Agent Detail Ops (creator-scoped) ─────────────────────

export async function getAgent(agentId: string) {
  const payload = await realm().services.CreatorService.creatorControllerGetAgent(agentId);
  return normalizeAgentDetail(payload);
}

export async function updateAgent(agentId: string, payload: UpdateAgentInput) {
  return realm().services.CreatorService.creatorControllerUpdateAgent(agentId, payload);
}

export async function deleteAgent(agentId: string) {
  return realm().services.CreatorService.creatorControllerDeleteAgent(agentId);
}

export async function getAgentByHandle(handle: string) {
  return realm().services.AgentsService.getAgentByHandle(handle);
}

// ── DNA Ops ───────────────────────────────────────────────

export async function updateAgentDna(agentId: string, dna: ForgeUpdateAgentDnaInput) {
  return realm().services.AgentsService.agentControllerUpdateDna(
    agentId,
    'dna' in dna ? dna as UpdateAgentDnaInput : { dna: dna as UpdateAgentDnaInput['dna'] },
  );
}

export async function getAgentSoulPrime(agentId: string) {
  return realm().services.AgentsService.agentControllerGetSoulPrime(agentId);
}

export async function updateAgentSoulPrime(agentId: string, soulPrime: ForgeUpdateAgentSoulPrimeInput) {
  return realm().services.AgentsService.agentControllerUpdateSoulPrime(
    agentId,
    'soulPrime' in soulPrime
      ? soulPrime as UpdateAgentSoulPrimeInput
      : { soulPrime: soulPrime as UpdateAgentSoulPrimeInput['soulPrime'] },
  );
}

// ── API Keys ──────────────────────────────────────────────

export async function listCreatorKeys() {
  const payload = await realm().services.CreatorService.creatorControllerListKeys();
  const root = toLooseObject(payload);
  const items = Array.isArray(root.items)
    ? root.items
    : Array.isArray(payload)
      ? payload
      : [];
  return {
    items: items
      .map(normalizeCreatorKeyListItem)
      .filter((item): item is ForgeCreatorKeyListItem => item !== null),
  } satisfies ForgeCreatorKeyListResponse;
}

export async function createCreatorKey(payload: ForgeCreateCreatorKeyInput) {
  return realm().services.CreatorService.creatorControllerCreateKey({
    ...payload,
    label: String(payload.label || ('name' in payload ? payload.name : '') || '').trim(),
    type: payload.type || 'PERSONAL',
  });
}

export async function revokeCreatorKey(keyId: string) {
  return realm().services.CreatorService.creatorControllerRevokeKey(keyId);
}

// ── Agent Visibility ──────────────────────────────────────

export async function getAgentVisibility(agentId: string) {
  return realm().services.AgentsService.agentControllerGetVisibility(agentId);
}

export async function updateAgentVisibility(agentId: string, payload: ForgeUpdateAgentVisibilityInput) {
  if ('visibility' in payload && payload.visibility) {
    const visibility = payload.visibility === 'FRIENDS' || payload.visibility === 'PRIVATE'
      ? payload.visibility
      : 'PUBLIC';
    return realm().services.AgentsService.agentControllerUpdateVisibility(agentId, {
      accountVisibility: visibility,
      defaultPostVisibility: visibility,
      dmVisibility: visibility,
      profileVisibility: visibility,
    });
  }
  return realm().services.AgentsService.agentControllerUpdateVisibility(agentId, payload as UpdateAgentVisibilityInput);
}
