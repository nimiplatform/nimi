import { getPlatformClient } from '@nimiplatform/sdk';
import type { RealmServiceArgs, RealmServiceResult } from '@nimiplatform/sdk/realm';

function realm() {
  return getPlatformClient().realm;
}

type CreateImageDirectUploadResult = {
  uploadUrl: string;
  resourceId: string;
  storageRef?: string;
};
type FinalizeResourceInput = RealmServiceArgs<'ResourcesService', 'finalizeResource'>[1];
type BatchUpsertBindingsInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerBatchUpsertWorldBindings'>[1];
type CreatorListAgentsResult = RealmServiceResult<'CreatorService', 'creatorControllerListAgents'>;
type CreatorGetAgentResult = RealmServiceResult<'CreatorService', 'creatorControllerGetAgent'>;
type AgentRulesListResult = RealmServiceResult<'AgentRulesService', 'agentRulesControllerListRules'>;
type ListWorldBindingsResult = RealmServiceResult<'WorldControlService', 'worldControlControllerListWorldBindings'>;
type MyWorldListResult = RealmServiceResult<'WorldControlService', 'worldControlControllerListMyWorlds'>;
type WorldAgentsResult = RealmServiceResult<'WorldsService', 'worldControllerGetWorldAgents'>;

export type LookdevWorldSummary = {
  id: string;
  name: string;
  status: string;
  agentCount: number | null;
};

export type LookdevPortraitBinding = {
  bindingId: string;
  resourceId: string;
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  createdAt: string;
};

export type LookdevAgentRecord = {
  id: string;
  handle: string;
  displayName: string;
  concept: string;
  description: string | null;
  scenario: string | null;
  greeting: string | null;
  worldId: string | null;
  avatarUrl: string | null;
  currentPortrait: LookdevPortraitBinding | null;
  importance: 'PRIMARY' | 'SECONDARY' | 'BACKGROUND' | 'UNKNOWN';
  status: string;
};

export type LookdevAgentTruthIdentity = {
  role: string | null;
  worldview: string | null;
  species: string | null;
  summary: string | null;
};

export type LookdevAgentTruthBiological = {
  gender: string | null;
  visualAge: string | null;
  ethnicity: string | null;
  heightCm: number | null;
  weightKg: number | null;
};

export type LookdevAgentTruthAppearance = {
  artStyle: string | null;
  hair: string | null;
  eyes: string | null;
  skin: string | null;
  fashionStyle: string | null;
  signatureItems: string[];
};

export type LookdevAgentTruthPersonality = {
  summary: string | null;
  mbti: string | null;
  interests: string[];
  goals: string[];
  relationshipMode: string | null;
  emotionBaseline: string | null;
};

export type LookdevAgentTruthCommunication = {
  summary: string | null;
  responseLength: string | null;
  formality: string | null;
  sentiment: string | null;
};

export type LookdevAgentRuleTruthSection<T> = {
  statement: string | null;
  structured: T | null;
};

export type LookdevAgentSoulPrime = {
  text: string;
  backstory: string | null;
  coreValues: string | null;
  personalityDescription: string | null;
  guidelines: string | null;
  catchphrase: string | null;
};

export type LookdevAgentTruthBundle = {
  description: string | null;
  scenario: string | null;
  greeting: string | null;
  wakeStrategy: 'PASSIVE' | 'PROACTIVE';
  dna: {
    identity: LookdevAgentTruthIdentity;
    biological: LookdevAgentTruthBiological;
    appearance: LookdevAgentTruthAppearance;
    personality: LookdevAgentTruthPersonality;
    communication: LookdevAgentTruthCommunication;
  };
  behavioralRules: string[];
  soulPrime: LookdevAgentSoulPrime | null;
  ruleTruth: {
    identity: LookdevAgentRuleTruthSection<LookdevAgentTruthIdentity>;
    biological: LookdevAgentRuleTruthSection<LookdevAgentTruthBiological>;
    appearance: LookdevAgentRuleTruthSection<LookdevAgentTruthAppearance>;
    personality: LookdevAgentRuleTruthSection<LookdevAgentTruthPersonality>;
    communication: LookdevAgentRuleTruthSection<LookdevAgentTruthCommunication>;
  };
};

type LooseObject = Record<string, unknown>;
type CreatorAgentDetailProjection = Pick<LookdevAgentTruthBundle, 'description' | 'scenario' | 'greeting' | 'wakeStrategy'> & {
  dna: LookdevAgentTruthBundle['dna'];
  behavioralRules: string[];
};
type NormalizedRuleRecord = {
  ruleKey: string;
  statement: string | null;
  structured: LooseObject;
};

const SOUL_PRIME_RULE_KEY = 'identity:soul_prime:core';

function asRecord(value: unknown): LooseObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as LooseObject : {};
}

function toStringOrNull(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized ? normalized : null;
}

function toNumberOrNull(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function toStringList(value: unknown, maxItems = 12): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: string[] = [];
  for (const item of value) {
    const entry = toStringOrNull(item);
    if (!entry || normalized.includes(entry)) {
      continue;
    }
    normalized.push(entry);
    if (normalized.length >= maxItems) {
      break;
    }
  }
  return normalized;
}

function pickString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value) {
      return value;
    }
  }
  return null;
}

function pickStringList(...values: string[][]): string[] {
  for (const value of values) {
    if (value.length > 0) {
      return value;
    }
  }
  return [];
}

function normalizeIdentityTruth(value: unknown): LookdevAgentTruthIdentity {
  const record = asRecord(value);
  return {
    role: toStringOrNull(record.role),
    worldview: toStringOrNull(record.worldview),
    species: toStringOrNull(record.species),
    summary: toStringOrNull(record.summary),
  };
}

function normalizeBiologicalTruth(value: unknown): LookdevAgentTruthBiological {
  const record = asRecord(value);
  return {
    gender: toStringOrNull(record.gender),
    visualAge: toStringOrNull(record.visualAge),
    ethnicity: toStringOrNull(record.ethnicity),
    heightCm: toNumberOrNull(record.heightCm),
    weightKg: toNumberOrNull(record.weightKg),
  };
}

function normalizeAppearanceTruth(value: unknown): LookdevAgentTruthAppearance {
  const record = asRecord(value);
  return {
    artStyle: toStringOrNull(record.artStyle),
    hair: toStringOrNull(record.hair),
    eyes: toStringOrNull(record.eyes),
    skin: toStringOrNull(record.skin),
    fashionStyle: toStringOrNull(record.fashionStyle),
    signatureItems: toStringList(record.signatureItems, 8),
  };
}

function normalizePersonalityTruth(value: unknown): LookdevAgentTruthPersonality {
  const record = asRecord(value);
  return {
    summary: toStringOrNull(record.summary),
    mbti: toStringOrNull(record.mbti),
    interests: toStringList(record.interests, 8),
    goals: toStringList(record.goals, 8),
    relationshipMode: toStringOrNull(record.relationshipMode),
    emotionBaseline: toStringOrNull(record.emotionBaseline),
  };
}

function normalizeCommunicationTruth(value: unknown): LookdevAgentTruthCommunication {
  const record = asRecord(value);
  return {
    summary: toStringOrNull(record.summary),
    responseLength: toStringOrNull(record.responseLength),
    formality: toStringOrNull(record.formality),
    sentiment: toStringOrNull(record.sentiment),
  };
}

function normalizeRulesPayload(value: unknown): string[] {
  const rules = asRecord(value);
  const lines = toStringList(rules.lines, 16);
  if (lines.length > 0) {
    return lines;
  }
  const text = toStringOrNull(rules.text);
  return text ? text.split(/\n+/u).map((line) => line.trim()).filter(Boolean) : [];
}

function mergeIdentityTruth(
  primary: LookdevAgentTruthIdentity,
  secondary: LookdevAgentTruthIdentity | null,
): LookdevAgentTruthIdentity {
  return {
    role: pickString(primary.role, secondary?.role),
    worldview: pickString(primary.worldview, secondary?.worldview),
    species: pickString(primary.species, secondary?.species),
    summary: pickString(primary.summary, secondary?.summary),
  };
}

function mergeBiologicalTruth(
  primary: LookdevAgentTruthBiological,
  secondary: LookdevAgentTruthBiological | null,
): LookdevAgentTruthBiological {
  return {
    gender: pickString(primary.gender, secondary?.gender),
    visualAge: pickString(primary.visualAge, secondary?.visualAge),
    ethnicity: pickString(primary.ethnicity, secondary?.ethnicity),
    heightCm: primary.heightCm ?? secondary?.heightCm ?? null,
    weightKg: primary.weightKg ?? secondary?.weightKg ?? null,
  };
}

function mergeAppearanceTruth(
  primary: LookdevAgentTruthAppearance,
  secondary: LookdevAgentTruthAppearance | null,
): LookdevAgentTruthAppearance {
  return {
    artStyle: pickString(primary.artStyle, secondary?.artStyle),
    hair: pickString(primary.hair, secondary?.hair),
    eyes: pickString(primary.eyes, secondary?.eyes),
    skin: pickString(primary.skin, secondary?.skin),
    fashionStyle: pickString(primary.fashionStyle, secondary?.fashionStyle),
    signatureItems: pickStringList(primary.signatureItems, secondary?.signatureItems || []),
  };
}

function mergePersonalityTruth(
  primary: LookdevAgentTruthPersonality,
  secondary: LookdevAgentTruthPersonality | null,
): LookdevAgentTruthPersonality {
  return {
    summary: pickString(primary.summary, secondary?.summary),
    mbti: pickString(primary.mbti, secondary?.mbti),
    interests: pickStringList(primary.interests, secondary?.interests || []),
    goals: pickStringList(primary.goals, secondary?.goals || []),
    relationshipMode: pickString(primary.relationshipMode, secondary?.relationshipMode),
    emotionBaseline: pickString(primary.emotionBaseline, secondary?.emotionBaseline),
  };
}

function mergeCommunicationTruth(
  primary: LookdevAgentTruthCommunication,
  secondary: LookdevAgentTruthCommunication | null,
): LookdevAgentTruthCommunication {
  return {
    summary: pickString(primary.summary, secondary?.summary),
    responseLength: pickString(primary.responseLength, secondary?.responseLength),
    formality: pickString(primary.formality, secondary?.formality),
    sentiment: pickString(primary.sentiment, secondary?.sentiment),
  };
}

function normalizeSoulPrime(value: NormalizedRuleRecord | null): LookdevAgentSoulPrime | null {
  if (!value) {
    return null;
  }
  return {
    text: value.statement || '',
    backstory: toStringOrNull(value.structured.backstory),
    coreValues: toStringOrNull(value.structured.coreValues),
    personalityDescription: toStringOrNull(value.structured.personalityDescription),
    guidelines: toStringOrNull(value.structured.guidelines),
    catchphrase: toStringOrNull(value.structured.catchphrase),
  };
}

function normalizeRuleRecord(value: unknown): NormalizedRuleRecord | null {
  const record = asRecord(value);
  const ruleKey = String(record.ruleKey || '').trim();
  if (!ruleKey) {
    return null;
  }
  return {
    ruleKey,
    statement: toStringOrNull(record.statement),
    structured: asRecord(record.structured),
  };
}

function findRuleTruth(
  rules: NormalizedRuleRecord[],
  ruleKey: string,
): NormalizedRuleRecord | null {
  return rules.find((rule) => rule.ruleKey === ruleKey) || null;
}

function extractAgentWorldId(item: LooseObject, user: LooseObject, agent: LooseObject, agentProfile: LooseObject): string | null {
  const world = asRecord(item.world);
  return toStringOrNull(
    item.worldId
    ?? user.worldId
    ?? agent.worldId
    ?? agentProfile.worldId
    ?? world.id,
  );
}

function normalizeWorlds(payload: MyWorldListResult): LookdevWorldSummary[] {
  const items = Array.isArray(asRecord(payload).items) ? asRecord(payload).items as unknown[] : [];
  return items.map((item) => {
    const record = asRecord(item);
    const rawAgentCount = record.agentCount ?? record.nativeAgentLimit;
    const agentCount = Number(rawAgentCount);
    return {
      id: String(record.id || '').trim(),
      name: String(record.name || 'Untitled World').trim(),
      status: String(record.status || '').trim(),
      agentCount: Number.isFinite(agentCount) && agentCount >= 0 ? agentCount : null,
    };
  }).filter((item) => item.id);
}

function normalizeCreatorAgentListItem(value: unknown): Omit<LookdevAgentRecord, 'description' | 'scenario' | 'greeting' | 'currentPortrait'> | null {
  const item = asRecord(value);
  const user = asRecord(item.user);
  const agent = asRecord(user.agent);
  const agentProfile = asRecord(item.agentProfile);
  const id = String(item.id || item.agentId || user.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    id,
    handle: String(item.handle || user.handle || '').trim(),
    displayName: String(item.displayName || user.displayName || item.name || user.name || '').trim() || id,
    concept: String(item.concept || agent.concept || '').trim(),
    worldId: extractAgentWorldId(item, user, agent, agentProfile),
    avatarUrl: toStringOrNull(item.avatarUrl ?? user.avatarUrl ?? agentProfile.avatarUrl),
    importance: String(agentProfile.importance || agent.importance || 'UNKNOWN').trim().toUpperCase() as LookdevAgentRecord['importance'],
    status: String(item.status || agent.status || 'UNKNOWN').trim() || 'UNKNOWN',
  };
}

function normalizeAgentDetail(value: CreatorGetAgentResult): Pick<LookdevAgentRecord, 'description' | 'scenario' | 'greeting'> {
  const item = asRecord(value);
  const user = asRecord(item.user);
  return {
    description: toStringOrNull(item.description ?? item.bio ?? user.bio),
    scenario: toStringOrNull(item.scenario),
    greeting: toStringOrNull(item.greeting),
  };
}

function normalizeCreatorAgentDetail(value: CreatorGetAgentResult): CreatorAgentDetailProjection {
  const item = asRecord(value);
  const user = asRecord(item.user);
  const agent = asRecord(user.agent);
  const agentProfile = asRecord(item.agentProfile);
  const dna = asRecord(item.dna);
  const profileDna = asRecord(agentProfile.dna);
  const resolvedDna = Object.keys(dna).length > 0 ? dna : profileDna;
  return {
    description: toStringOrNull(item.description ?? item.bio ?? user.bio),
    scenario: toStringOrNull(item.scenario),
    greeting: toStringOrNull(item.greeting),
    wakeStrategy: String(item.wakeStrategy || agent.wakeStrategy || 'PASSIVE') === 'PROACTIVE'
      ? 'PROACTIVE'
      : 'PASSIVE',
    dna: {
      identity: normalizeIdentityTruth(resolvedDna.identity),
      biological: normalizeBiologicalTruth(resolvedDna.biological),
      appearance: normalizeAppearanceTruth(resolvedDna.appearance),
      personality: normalizePersonalityTruth(resolvedDna.personality),
      communication: normalizeCommunicationTruth(resolvedDna.communication),
    },
    behavioralRules: normalizeRulesPayload(item.rules),
  };
}

function normalizeWorldAgentListItem(worldId: string, value: unknown): Omit<LookdevAgentRecord, 'description' | 'scenario' | 'greeting' | 'currentPortrait'> | null {
  const item = asRecord(value);
  const id = String(item.id || item.agentId || '').trim();
  if (!id) {
    return null;
  }
  return {
    id,
    handle: String(item.handle || '').trim(),
    displayName: String(item.displayName || item.name || '').trim() || id,
    concept: String(item.concept || item.bio || '').trim(),
    worldId,
    avatarUrl: toStringOrNull(item.avatarUrl),
    importance: String(item.importance || 'UNKNOWN').trim().toUpperCase() as LookdevAgentRecord['importance'],
    status: String(item.status || item.state || 'UNKNOWN').trim() || 'UNKNOWN',
  };
}

function normalizePortraitBinding(payload: ListWorldBindingsResult): LookdevPortraitBinding | null {
  const items = Array.isArray(asRecord(payload).items) ? asRecord(payload).items as unknown[] : [];
  const record = asRecord(items[0]);
  const resource = asRecord(record.resource);
  const resourceId = String(record.objectId || resource.id || '').trim();
  const url = String(resource.url || '').trim();
  const mimeType = String(resource.mimeType || '').trim();
  if (!resourceId || !url || !mimeType) {
    return null;
  }
  return {
    bindingId: String(record.id || '').trim(),
    resourceId,
    url,
    mimeType,
    width: Number(resource.width || 0) || undefined,
    height: Number(resource.height || 0) || undefined,
    createdAt: String(record.createdAt || '').trim(),
  };
}

export async function listLookdevWorlds(): Promise<LookdevWorldSummary[]> {
  const payload: MyWorldListResult = await realm().services.WorldControlService.worldControlControllerListMyWorlds();
  const worlds = normalizeWorlds(payload);
  return await Promise.all(worlds.map(async (world) => {
    if (typeof world.agentCount === 'number') {
      return world;
    }
    try {
      const cast = await realm().services.WorldsService.worldControllerGetWorldAgents(world.id);
      const items = Array.isArray(cast)
        ? cast
        : Array.isArray(asRecord(cast).items)
          ? asRecord(cast).items as unknown[]
          : [];
      return {
        ...world,
        agentCount: items.length,
      };
    } catch {
      return world;
    }
  }));
}

export async function listLookdevAgents(): Promise<Array<Omit<LookdevAgentRecord, 'description' | 'scenario' | 'greeting' | 'currentPortrait'>>> {
  const payload: CreatorListAgentsResult = await realm().services.CreatorService.creatorControllerListAgents();
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload).items)
      ? asRecord(payload).items as unknown[]
      : [];
  return items
    .map(normalizeCreatorAgentListItem)
    .filter((item): item is NonNullable<ReturnType<typeof normalizeCreatorAgentListItem>> => item !== null);
}

export async function listLookdevWorldAgents(worldId: string): Promise<Array<Omit<LookdevAgentRecord, 'description' | 'scenario' | 'greeting' | 'currentPortrait'>>> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('LOOKDEV_WORLD_ID_REQUIRED');
  }
  const payload: WorldAgentsResult = await realm().services.WorldsService.worldControllerGetWorldAgents(normalizedWorldId);
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload).items)
      ? asRecord(payload).items as unknown[]
      : [];
  return items
    .map((item) => normalizeWorldAgentListItem(normalizedWorldId, item))
    .filter((item): item is NonNullable<ReturnType<typeof normalizeWorldAgentListItem>> => item !== null);
}

export async function getLookdevAgent(agentId: string): Promise<Pick<LookdevAgentRecord, 'description' | 'scenario' | 'greeting'>> {
  const payload: CreatorGetAgentResult = await realm().services.CreatorService.creatorControllerGetAgent(agentId);
  return normalizeAgentDetail(payload);
}

export async function getLookdevAgentTruthBundle(worldId: string, agentId: string): Promise<LookdevAgentTruthBundle> {
  const [detailPayload, rulesPayload] = await Promise.all([
    realm().services.CreatorService.creatorControllerGetAgent(agentId),
    realm().services.AgentRulesService.agentRulesControllerListRules(worldId, agentId, 'DNA', 'ACTIVE'),
  ]);
  const detail = normalizeCreatorAgentDetail(detailPayload as CreatorGetAgentResult);
  const ruleItems = Array.isArray(rulesPayload)
    ? rulesPayload
    : Array.isArray(asRecord(rulesPayload).items)
      ? asRecord(rulesPayload).items as unknown[]
      : [];
  const rules = ruleItems
    .map(normalizeRuleRecord)
    .filter((rule): rule is NormalizedRuleRecord => rule !== null);
  const identityRule = findRuleTruth(rules, 'dna:identity:core');
  const biologicalRule = findRuleTruth(rules, 'dna:biological:traits');
  const appearanceRule = findRuleTruth(rules, 'dna:appearance:visual');
  const personalityRule = findRuleTruth(rules, 'dna:personality:traits');
  const communicationRule = findRuleTruth(rules, 'dna:communication:style');
  const soulPrimeRule = findRuleTruth(rules, SOUL_PRIME_RULE_KEY);

  const identityStructured = identityRule ? normalizeIdentityTruth(identityRule.structured) : null;
  const biologicalStructured = biologicalRule ? normalizeBiologicalTruth(biologicalRule.structured) : null;
  const appearanceStructured = appearanceRule ? normalizeAppearanceTruth(appearanceRule.structured) : null;
  const personalityStructured = personalityRule ? normalizePersonalityTruth(personalityRule.structured) : null;
  const communicationStructured = communicationRule ? normalizeCommunicationTruth(communicationRule.structured) : null;

  return {
    description: detail.description,
    scenario: detail.scenario,
    greeting: detail.greeting,
    wakeStrategy: detail.wakeStrategy,
    dna: {
      identity: mergeIdentityTruth(detail.dna.identity, identityStructured),
      biological: mergeBiologicalTruth(detail.dna.biological, biologicalStructured),
      appearance: mergeAppearanceTruth(detail.dna.appearance, appearanceStructured),
      personality: mergePersonalityTruth(detail.dna.personality, personalityStructured),
      communication: mergeCommunicationTruth(detail.dna.communication, communicationStructured),
    },
    behavioralRules: detail.behavioralRules,
    soulPrime: normalizeSoulPrime(soulPrimeRule),
    ruleTruth: {
      identity: { statement: identityRule?.statement || null, structured: identityStructured },
      biological: { statement: biologicalRule?.statement || null, structured: biologicalStructured },
      appearance: { statement: appearanceRule?.statement || null, structured: appearanceStructured },
      personality: { statement: personalityRule?.statement || null, structured: personalityStructured },
      communication: { statement: communicationRule?.statement || null, structured: communicationStructured },
    },
  };
}

export async function getAgentPortraitBinding(worldId: string, agentId: string): Promise<LookdevPortraitBinding | null> {
  const payload: ListWorldBindingsResult = await realm().services.WorldControlService.worldControlControllerListWorldBindings(
    worldId,
    1,
    'AGENT_PORTRAIT',
    'PRESENTATION',
    agentId,
    'AGENT',
    undefined,
    'RESOURCE',
  );
  return normalizePortraitBinding(payload);
}

export async function createLookdevImageUpload(): Promise<CreateImageDirectUploadResult> {
  return getPlatformClient().domains.resources.createImageDirectUpload(undefined);
}

export async function finalizeLookdevResource(resourceId: string, input: FinalizeResourceInput) {
  return getPlatformClient().domains.resources.finalizeResource(resourceId, input);
}

export async function upsertAgentPortraitBinding(input: {
  worldId: string;
  agentId: string;
  resourceId: string;
  intentPrompt?: string;
}) {
  const payload: BatchUpsertBindingsInput = {
    bindingUpserts: [{
      hostId: input.agentId,
      hostType: 'AGENT',
      objectId: input.resourceId,
      objectType: 'RESOURCE',
      bindingKind: 'PRESENTATION',
      bindingPoint: 'AGENT_PORTRAIT',
      intentPrompt: input.intentPrompt,
      tags: ['lookdev', 'portrait'],
      priority: 0,
    }],
  };
  return realm().services.WorldControlService.worldControlControllerBatchUpsertWorldBindings(
    input.worldId,
    payload,
  );
}
