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
type CreateAgentRuleInput = RealmServiceArgs<'AgentRulesService', 'agentRulesControllerCreateRule'>[2];
type UpdateAgentRuleInput = RealmServiceArgs<'AgentRulesService', 'agentRulesControllerUpdateRule'>[3];
type CreateCreatorKeyInput = RealmServiceArgs<'CreatorService', 'creatorControllerCreateKey'>[0];
type UpdateAgentVisibilityInput = RealmServiceArgs<'AgentsService', 'agentControllerUpdateVisibility'>[1];
type AgentRuleListPayload = Array<Record<string, unknown>>;
export type ForgeCreateCreatorAgentInput = CreateCreatorAgentInput | {
  handle?: string;
  displayName?: string;
  name?: string;
  concept?: string;
  ownershipType?: CreateCreatorAgentInput['ownershipType'];
  worldId?: string;
};
export type ForgeBatchCreateCreatorAgentsInput = {
  items: ForgeCreateCreatorAgentInput[];
  continueOnError?: boolean;
};
export type ForgeUpdateAgentDnaInput = UpdateAgentDnaInput | {
  dna?: UpdateAgentDnaInput['dna'];
  [key: string]: unknown;
};
export type ForgeSoulPrimeStructured = {
  backstory?: string;
  coreValues?: string;
  personalityDescription?: string;
  guidelines?: string;
  catchphrase?: string;
};
export type ForgeUpdateAgentSoulPrimeInput = {
  text?: string;
  structured?: ForgeSoulPrimeStructured;
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
export type ForgeAgentSoulPrimePayload = {
  ruleId: string;
  ruleKey: 'identity:soul_prime:core';
  text: string;
  statement: string;
  structured: ForgeSoulPrimeStructured;
} | null;

type LooseObject = { [key: string]: unknown };
type SoulPrimeFieldKey = keyof ForgeSoulPrimeStructured;
type SoulPrimeFieldConfig = {
  key: SoulPrimeFieldKey;
  label: string;
};

const SOUL_PRIME_RULE_KEY = 'identity:soul_prime:core';
const SOUL_PRIME_RULE_FIELDS: SoulPrimeFieldConfig[] = [
  { key: 'backstory', label: 'Backstory' },
  { key: 'coreValues', label: 'Core Values' },
  { key: 'personalityDescription', label: 'Personality Description' },
  { key: 'guidelines', label: 'Guidelines' },
  { key: 'catchphrase', label: 'Catchphrase' },
];

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

function normalizeSoulPrimeStructured(value: unknown): ForgeSoulPrimeStructured | null {
  const source = toLooseObject(value);
  const normalized = SOUL_PRIME_RULE_FIELDS.reduce<ForgeSoulPrimeStructured>((acc, field) => {
    const content = toStringOrNull(source[field.key]);
    if (content) {
      acc[field.key] = content;
    }
    return acc;
  }, {});
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function renderSoulPrimeText(value: ForgeSoulPrimeStructured | null): string {
  if (!value) {
    return '';
  }
  return SOUL_PRIME_RULE_FIELDS
    .map((field) => {
      const content = toStringOrNull(value[field.key]);
      return content ? `${field.label}: ${content}` : null;
    })
    .filter((entry): entry is string => entry !== null)
    .join('\n\n');
}

function parseSoulPrimeText(text: string): ForgeSoulPrimeStructured | null {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return null;
  }

  const sections = normalizedText.split(/\n\s*\n+/);
  const parsed: ForgeSoulPrimeStructured = {};
  let matchedFieldCount = 0;

  for (const section of sections) {
    const trimmedSection = section.trim();
    const matchedField = SOUL_PRIME_RULE_FIELDS.find((field) =>
      trimmedSection.toLowerCase().startsWith(`${field.label.toLowerCase()}:`),
    );
    if (!matchedField) {
      continue;
    }
    const content = toStringOrNull(trimmedSection.slice(matchedField.label.length + 1));
    if (content) {
      parsed[matchedField.key] = content;
      matchedFieldCount += 1;
    }
  }

  if (matchedFieldCount > 0) {
    return Object.keys(parsed).length > 0 ? parsed : null;
  }

  return { guidelines: normalizedText };
}

function buildSoulPrimeStatement(value: ForgeSoulPrimeStructured): string {
  return renderSoulPrimeText(value);
}

function toSoulPrimeRule(rule: unknown): ForgeAgentSoulPrimePayload {
  const source = toLooseObject(rule);
  if (String(source.ruleKey || '').trim() !== SOUL_PRIME_RULE_KEY) {
    return null;
  }
  const structured = normalizeSoulPrimeStructured(source.structured) ?? parseSoulPrimeText(String(source.statement || ''));
  if (!structured) {
    return null;
  }
  const ruleId = String(source.id || '').trim();
  if (!ruleId) {
    return null;
  }
  return {
    ruleId,
    ruleKey: SOUL_PRIME_RULE_KEY,
    statement: String(source.statement || '').trim(),
    text: renderSoulPrimeText(structured),
    structured,
  };
}

function toSoulPrimeRuleInput(payload: ForgeUpdateAgentSoulPrimeInput): ForgeSoulPrimeStructured {
  const structured = payload.structured ?? parseSoulPrimeText(String(payload.text || ''));
  if (!structured) {
    throw new Error('FORGE_SOUL_PRIME_EMPTY');
  }
  return structured;
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
  const handle = String(payload.handle || '').trim();
  const concept = String(payload.concept || '').trim();
  const worldId = String(payload.worldId || '').trim();
  const displayName = String(payload.displayName || '').trim();

  if (!handle || !concept || !worldId) {
    throw new Error('FORGE_CREATOR_AGENT_INPUT_INVALID');
  }

  const rest = 'name' in payload
    ? (({ name: _name, ...value }: typeof payload & { name?: string }) => value)(payload)
    : payload;
  return {
    ...rest,
    handle,
    concept,
    worldId,
    ...(displayName ? { displayName } : {}),
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

export async function getAgentSoulPrime(
  worldId: string,
  agentId: string,
): Promise<ForgeAgentSoulPrimePayload> {
  const rules = await realm().services.AgentRulesService.agentRulesControllerListRules(
    worldId,
    agentId,
    'ACTIVE',
    'DNA',
  );
  return (rules as AgentRuleListPayload)
    .map((rule) => toSoulPrimeRule(rule))
    .find((rule): rule is NonNullable<ForgeAgentSoulPrimePayload> => rule !== null) ?? null;
}

export async function updateAgentSoulPrime(
  worldId: string,
  agentId: string,
  soulPrime: ForgeUpdateAgentSoulPrimeInput,
) {
  const structured = toSoulPrimeRuleInput(soulPrime);
  const statement = buildSoulPrimeStatement(structured);
  const existing = await getAgentSoulPrime(worldId, agentId);

  const payload = {
    title: 'Soul Prime',
    statement,
    category: 'DEFINITION',
    hardness: 'FIRM',
    scope: 'SELF',
    importance: 100,
    structured,
    provenance: 'CREATOR',
    sourceRef: 'forge.soul-prime-editor',
  } satisfies Partial<CreateAgentRuleInput> & Partial<UpdateAgentRuleInput>;

  if (existing) {
    return realm().services.AgentRulesService.agentRulesControllerUpdateRule(
      worldId,
      agentId,
      existing.ruleId,
      payload satisfies UpdateAgentRuleInput,
    );
  }

  return realm().services.AgentRulesService.agentRulesControllerCreateRule(
    worldId,
    agentId,
    {
      ruleKey: SOUL_PRIME_RULE_KEY,
      title: 'Soul Prime',
      statement,
      layer: 'DNA',
      category: 'DEFINITION',
      hardness: 'FIRM',
      scope: 'SELF',
      importance: 100,
      priority: 100,
      structured,
      provenance: 'CREATOR',
      sourceRef: 'forge.soul-prime-editor',
    } satisfies CreateAgentRuleInput,
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
