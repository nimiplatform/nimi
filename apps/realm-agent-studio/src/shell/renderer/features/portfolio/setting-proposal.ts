export const OWNER_SETTINGS_SAVE_SOURCE = 'Realm MeService.updateMyRealmAgentSettings';
export const SETTINGS_AI_PROPOSAL_SOURCE = 'Runtime runtime.ai.text.generate';
export const RAW_RULE_REVIEW_DEFERRED_REASON = 'raw AgentRule review deferred: Realm has not admitted a dedicated owner-scoped rule-content read surface';

export type OwnerAgentSettingsSnapshot = {
  displayName?: string | null;
  description?: string | null;
  greeting?: string | null;
  naturalLanguageIntent?: string | null;
  identity?: {
    publicRole?: string | null;
    worldview?: string | null;
  };
  personality?: {
    summary?: string | null;
    relationshipMode?: string | null;
    interests?: string[];
    goals?: string[];
  };
  communication?: {
    contentStyle?: string | null;
    formality?: 'casual' | 'formal' | 'slang';
    responseLength?: 'short' | 'medium' | 'long';
    sentiment?: 'positive' | 'neutral' | 'cynical';
  };
  boundaries?: {
    allowedThemes?: string[];
    disallowedThemes?: string[];
  };
  positioning?: {
    targetAudience?: string | null;
    positioning?: string | null;
  };
};

export type OwnerAgentSettingsDraft = {
  displayName: string;
  description: string;
  greeting: string;
  naturalLanguageIntent: string;
  publicRole: string;
  worldview: string;
  personalitySummary: string;
  relationshipMode: string;
  interestsText: string;
  goalsText: string;
  contentStyle: string;
  formality: string;
  responseLength: string;
  sentiment: string;
  allowedThemesText: string;
  disallowedThemesText: string;
  targetAudience: string;
  positioning: string;
  rawRuleTextCandidate: string;
};

export type RuntimeOwnerSettingsProposalPatch = Partial<Pick<
  OwnerAgentSettingsDraft,
  | 'displayName'
  | 'description'
  | 'greeting'
  | 'naturalLanguageIntent'
  | 'publicRole'
  | 'worldview'
  | 'personalitySummary'
  | 'relationshipMode'
  | 'interestsText'
  | 'goalsText'
  | 'contentStyle'
  | 'formality'
  | 'responseLength'
  | 'sentiment'
  | 'allowedThemesText'
  | 'disallowedThemesText'
  | 'targetAudience'
  | 'positioning'
  | 'rawRuleTextCandidate'
>>;

export type RuntimeOwnerSettingsProposal = {
  source: typeof SETTINGS_AI_PROPOSAL_SOURCE;
  candidate: true;
  truthWrite: false;
  draftPatch: RuntimeOwnerSettingsProposalPatch;
  changedSettingKeys: string[];
  rationale: string;
  rawText: string;
};

export type NormalizedOwnerAgentSettingsDraft = OwnerAgentSettingsDraft & {
  interests: string[];
  goals: string[];
  allowedThemes: string[];
  disallowedThemes: string[];
};

export type OwnerAgentSettingsUpdateInput = {
  displayName?: string | null;
  description?: string | null;
  greeting?: string | null;
  naturalLanguageIntent?: string | null;
  identity?: {
    publicRole?: string | null;
    worldview?: string | null;
  };
  personality?: {
    summary?: string | null;
    relationshipMode?: string | null;
    interests?: string[];
    goals?: string[];
  };
  communication?: {
    contentStyle?: string | null;
    formality?: 'casual' | 'formal' | 'slang';
    responseLength?: 'short' | 'medium' | 'long';
    sentiment?: 'positive' | 'neutral' | 'cynical';
  };
  boundaries?: {
    allowedThemes?: string[];
    disallowedThemes?: string[];
  };
  positioning?: {
    targetAudience?: string | null;
    positioning?: string | null;
  };
};

export type OwnerSettingsPayloadPreview = {
  source: typeof OWNER_SETTINGS_SAVE_SOURCE;
  ownerReviewed: true;
  submitted: OwnerAgentSettingsUpdateInput;
  rawRuleReview?: {
    deferred: true;
    reason: typeof RAW_RULE_REVIEW_DEFERRED_REASON;
    text: string;
  };
};

export type OwnerSettingsUpdateBuildResult =
  | {
    ok: true;
    changed: true;
    source: typeof OWNER_SETTINGS_SAVE_SOURCE;
    input: OwnerAgentSettingsUpdateInput;
    changedSettingKeys: string[];
    rawRuleTextCandidate?: string;
    preview: OwnerSettingsPayloadPreview;
  }
  | {
    ok: false;
    changed: false;
    source: typeof OWNER_SETTINGS_SAVE_SOURCE;
    failure: 'owner-settings-no-changes' | 'owner-settings-invalid' | 'raw-rule-review-deferred';
    errors: string[];
    input: null;
    rawRuleTextCandidate?: string;
  };

const FORMALITY_VALUES = ['casual', 'formal', 'slang'] as const;
const RESPONSE_LENGTH_VALUES = ['short', 'medium', 'long'] as const;
const SENTIMENT_VALUES = ['positive', 'neutral', 'cynical'] as const;
const FORBIDDEN_SETTING_KEYS = new Set([
  'handle',
  'worldId',
  'avatarUrl',
  'profileCoverUrl',
  'provider',
  'model',
  'localAgent',
  'lifecycle',
  'state',
  'dna',
  'agentRule',
  'agentRules',
  'ruleText',
]);

const RUNTIME_PROPOSAL_STRING_FIELDS = [
  'displayName',
  'description',
  'greeting',
  'naturalLanguageIntent',
  'publicRole',
  'worldview',
  'personalitySummary',
  'relationshipMode',
  'interestsText',
  'goalsText',
  'contentStyle',
  'allowedThemesText',
  'disallowedThemesText',
  'targetAudience',
  'positioning',
  'rawRuleTextCandidate',
] as const;

const RUNTIME_PROPOSAL_ENUM_FIELDS = {
  formality: FORMALITY_VALUES,
  responseLength: RESPONSE_LENGTH_VALUES,
  sentiment: SENTIMENT_VALUES,
} as const;

function normalizeLineText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function compactProfileText(value: string): string {
  return normalizeLineText(value).replace(/[ \t]+/g, ' ');
}

function listToText(values: string[] | undefined): string {
  return values?.join(', ') ?? '';
}

function parseListText(value: string): string[] {
  return normalizeLineText(value)
    .split(/[,\n]/g)
    .map((item) => compactProfileText(item))
    .filter(Boolean);
}

function extractFirstJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Runtime settings proposal did not return a JSON object.');
  }
  return JSON.parse(text.slice(start, end + 1));
}

function proposalValueToText(value: unknown): string | null {
  if (typeof value === 'string') {
    return normalizeLineText(value);
  }
  if (Array.isArray(value)) {
    const lines = value
      .map((item) => typeof item === 'string' ? compactProfileText(item) : '')
      .filter(Boolean);
    return lines.length > 0 ? lines.join(', ') : null;
  }
  return null;
}

function normalizeNullableText(value: string): string | null {
  const normalized = normalizeLineText(value);
  return normalized ? normalized : null;
}

function normalizeNullableSingleLine(value: string): string | null {
  const normalized = compactProfileText(value);
  return normalized ? normalized : null;
}

function sameStringArray(left: string[] | undefined, right: string[]): boolean {
  const normalizedLeft = left ?? [];
  return normalizedLeft.length === right.length && normalizedLeft.every((value, index) => value === right[index]);
}

function hasOwnKeys(value: object): boolean {
  return Object.keys(value).length > 0;
}

function addNullableChange<T extends Record<string, unknown>>(
  target: T,
  key: keyof T,
  proposed: string | null,
  current: string | null | undefined,
) {
  if (proposed !== (current ?? null)) {
    target[key] = proposed as T[keyof T];
  }
}

function addStringArrayChange<T extends Record<string, unknown>>(
  target: T,
  key: keyof T,
  proposed: string[],
  current: string[] | undefined,
) {
  if (!sameStringArray(current, proposed)) {
    target[key] = proposed as T[keyof T];
  }
}

function validateEnum<T extends readonly string[]>(value: string, allowed: T, label: string, errors: string[]): T[number] | undefined {
  const normalized = compactProfileText(value);
  if (!normalized) {
    return undefined;
  }
  if (!allowed.includes(normalized)) {
    errors.push(`${label} must be one of: ${allowed.join(', ')}`);
    return undefined;
  }
  return normalized as T[number];
}

export function createOwnerAgentSettingsDraft(settings: OwnerAgentSettingsSnapshot): OwnerAgentSettingsDraft {
  return {
    displayName: settings.displayName ?? '',
    description: settings.description ?? '',
    greeting: settings.greeting ?? '',
    naturalLanguageIntent: settings.naturalLanguageIntent ?? '',
    publicRole: settings.identity?.publicRole ?? '',
    worldview: settings.identity?.worldview ?? '',
    personalitySummary: settings.personality?.summary ?? '',
    relationshipMode: settings.personality?.relationshipMode ?? '',
    interestsText: listToText(settings.personality?.interests),
    goalsText: listToText(settings.personality?.goals),
    contentStyle: settings.communication?.contentStyle ?? '',
    formality: settings.communication?.formality ?? '',
    responseLength: settings.communication?.responseLength ?? '',
    sentiment: settings.communication?.sentiment ?? '',
    allowedThemesText: listToText(settings.boundaries?.allowedThemes),
    disallowedThemesText: listToText(settings.boundaries?.disallowedThemes),
    targetAudience: settings.positioning?.targetAudience ?? '',
    positioning: settings.positioning?.positioning ?? '',
    rawRuleTextCandidate: '',
  };
}

export function normalizeOwnerAgentSettingsDraft(draft: OwnerAgentSettingsDraft): NormalizedOwnerAgentSettingsDraft {
  return {
    displayName: compactProfileText(draft.displayName),
    description: normalizeLineText(draft.description),
    greeting: normalizeLineText(draft.greeting),
    naturalLanguageIntent: normalizeLineText(draft.naturalLanguageIntent),
    publicRole: compactProfileText(draft.publicRole),
    worldview: normalizeLineText(draft.worldview),
    personalitySummary: normalizeLineText(draft.personalitySummary),
    relationshipMode: compactProfileText(draft.relationshipMode),
    interestsText: normalizeLineText(draft.interestsText),
    goalsText: normalizeLineText(draft.goalsText),
    contentStyle: normalizeLineText(draft.contentStyle),
    formality: compactProfileText(draft.formality),
    responseLength: compactProfileText(draft.responseLength),
    sentiment: compactProfileText(draft.sentiment),
    allowedThemesText: normalizeLineText(draft.allowedThemesText),
    disallowedThemesText: normalizeLineText(draft.disallowedThemesText),
    targetAudience: normalizeLineText(draft.targetAudience),
    positioning: normalizeLineText(draft.positioning),
    rawRuleTextCandidate: normalizeLineText(draft.rawRuleTextCandidate),
    interests: parseListText(draft.interestsText),
    goals: parseListText(draft.goalsText),
    allowedThemes: parseListText(draft.allowedThemesText),
    disallowedThemes: parseListText(draft.disallowedThemesText),
  };
}

export function assertNoForbiddenOwnerSettingsFields(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_SETTING_KEYS.has(key)) {
      return key;
    }
    const nestedViolation = assertNoForbiddenOwnerSettingsFields(nested);
    if (nestedViolation) {
      return nestedViolation;
    }
  }

  return null;
}

export function buildRuntimeOwnerSettingsProposalPrompt(input: {
  agentId: string;
  current: OwnerAgentSettingsSnapshot;
  draft: OwnerAgentSettingsDraft;
  model: string;
}) {
  const normalizedDraft = normalizeOwnerAgentSettingsDraft(input.draft);
  const model = compactProfileText(input.model);
  const intent = normalizedDraft.naturalLanguageIntent;
  const errors: string[] = [];

  if (!model) {
    errors.push('Runtime runtime.ai.text.generate model config missing');
  }
  if (!intent) {
    errors.push('natural-language setting intent missing');
  }

  if (errors.length > 0) {
    return { ok: false as const, errors, payload: null };
  }

  return {
    ok: true as const,
    errors: [],
    payload: {
      model,
      maxTokens: 900,
      temperature: 0.2,
      system: [
        'You propose owner-reviewed Realm Agent settings only.',
        'Return one JSON object with admitted draft field names only.',
        'Allowed fields: displayName, description, greeting, naturalLanguageIntent, publicRole, worldview, personalitySummary, relationshipMode, interestsText, goalsText, contentStyle, formality, responseLength, sentiment, allowedThemesText, disallowedThemesText, targetAudience, positioning, rawRuleTextCandidate, rationale.',
        'Do not include provider, model, LocalAgent, lifecycle, state, worldId, handle, avatarUrl, profileCoverUrl, dna, agentRule, or agentRules.',
        'The owner must review the result before any Realm save.',
      ].join('\n'),
      input: JSON.stringify({
        agentId: input.agentId,
        ownerIntent: intent,
        currentSettings: input.current,
        currentDraft: normalizedDraft,
      }),
      metadata: {
        domain: 'realm-agent-studio.settings-proposal',
        surfaceId: 'realm-agent-studio',
      },
    },
  };
}

export function normalizeRuntimeOwnerSettingsProposal(
  outputText: string,
  baseDraft: OwnerAgentSettingsDraft,
): RuntimeOwnerSettingsProposal {
  const parsed = extractFirstJsonObject(outputText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Runtime settings proposal JSON must be an object.');
  }

  const forbiddenKey = assertNoForbiddenOwnerSettingsFields(parsed);
  if (forbiddenKey) {
    throw new Error(`Runtime settings proposal rejected forbidden ${forbiddenKey}.`);
  }

  const record = parsed as Record<string, unknown>;
  const draftPatch: RuntimeOwnerSettingsProposalPatch = {};
  const changedSettingKeys: string[] = [];

  for (const field of RUNTIME_PROPOSAL_STRING_FIELDS) {
    const value = proposalValueToText(record[field]);
    if (value !== null && value !== baseDraft[field]) {
      draftPatch[field] = value;
      changedSettingKeys.push(field);
    }
  }

  for (const [field, allowed] of Object.entries(RUNTIME_PROPOSAL_ENUM_FIELDS)) {
    const value = proposalValueToText(record[field]);
    if (!value) {
      continue;
    }
    if (!(allowed as readonly string[]).includes(value)) {
      throw new Error(`Runtime settings proposal rejected invalid ${field}.`);
    }
    const typedField = field as keyof typeof RUNTIME_PROPOSAL_ENUM_FIELDS;
    if (value !== baseDraft[typedField]) {
      draftPatch[typedField] = value;
      changedSettingKeys.push(field);
    }
  }

  if (changedSettingKeys.length === 0) {
    throw new Error('Runtime settings proposal returned no admitted setting changes.');
  }

  return {
    source: SETTINGS_AI_PROPOSAL_SOURCE,
    candidate: true,
    truthWrite: false,
    draftPatch,
    changedSettingKeys,
    rationale: proposalValueToText(record.rationale) || 'Runtime returned a settings candidate for owner review.',
    rawText: outputText,
  };
}

export function applyRuntimeOwnerSettingsProposal(
  draft: OwnerAgentSettingsDraft,
  proposal: RuntimeOwnerSettingsProposal,
): OwnerAgentSettingsDraft {
  return {
    ...draft,
    ...proposal.draftPatch,
  };
}

export function buildRealmOwnerAgentSettingsUpdateInput(
  draft: OwnerAgentSettingsDraft,
  current: OwnerAgentSettingsSnapshot,
): OwnerSettingsUpdateBuildResult {
  const normalized = normalizeOwnerAgentSettingsDraft(draft);
  const input: OwnerAgentSettingsUpdateInput = {};
  const changedSettingKeys: string[] = [];
  const errors: string[] = [];

  addNullableChange(input, 'displayName', normalizeNullableSingleLine(normalized.displayName), current.displayName);
  addNullableChange(input, 'description', normalizeNullableText(normalized.description), current.description);
  addNullableChange(input, 'greeting', normalizeNullableText(normalized.greeting), current.greeting);
  addNullableChange(input, 'naturalLanguageIntent', normalizeNullableText(normalized.naturalLanguageIntent), current.naturalLanguageIntent);

  const identity: NonNullable<OwnerAgentSettingsUpdateInput['identity']> = {};
  addNullableChange(identity, 'publicRole', normalizeNullableSingleLine(normalized.publicRole), current.identity?.publicRole);
  addNullableChange(identity, 'worldview', normalizeNullableText(normalized.worldview), current.identity?.worldview);
  if (hasOwnKeys(identity)) {
    input.identity = identity;
  }

  const personality: NonNullable<OwnerAgentSettingsUpdateInput['personality']> = {};
  addNullableChange(personality, 'summary', normalizeNullableText(normalized.personalitySummary), current.personality?.summary);
  addNullableChange(personality, 'relationshipMode', normalizeNullableSingleLine(normalized.relationshipMode), current.personality?.relationshipMode);
  addStringArrayChange(personality, 'interests', normalized.interests, current.personality?.interests);
  addStringArrayChange(personality, 'goals', normalized.goals, current.personality?.goals);
  if (hasOwnKeys(personality)) {
    input.personality = personality;
  }

  const communication: NonNullable<OwnerAgentSettingsUpdateInput['communication']> = {};
  addNullableChange(communication, 'contentStyle', normalizeNullableText(normalized.contentStyle), current.communication?.contentStyle);
  const formality = validateEnum(normalized.formality, FORMALITY_VALUES, 'formality', errors);
  const responseLength = validateEnum(normalized.responseLength, RESPONSE_LENGTH_VALUES, 'response length', errors);
  const sentiment = validateEnum(normalized.sentiment, SENTIMENT_VALUES, 'sentiment', errors);
  if (formality && formality !== current.communication?.formality) {
    communication.formality = formality;
  }
  if (responseLength && responseLength !== current.communication?.responseLength) {
    communication.responseLength = responseLength;
  }
  if (sentiment && sentiment !== current.communication?.sentiment) {
    communication.sentiment = sentiment;
  }
  if (hasOwnKeys(communication)) {
    input.communication = communication;
  }

  const boundaries: NonNullable<OwnerAgentSettingsUpdateInput['boundaries']> = {};
  addStringArrayChange(boundaries, 'allowedThemes', normalized.allowedThemes, current.boundaries?.allowedThemes);
  addStringArrayChange(boundaries, 'disallowedThemes', normalized.disallowedThemes, current.boundaries?.disallowedThemes);
  if (hasOwnKeys(boundaries)) {
    input.boundaries = boundaries;
  }

  const positioning: NonNullable<OwnerAgentSettingsUpdateInput['positioning']> = {};
  addNullableChange(positioning, 'targetAudience', normalizeNullableText(normalized.targetAudience), current.positioning?.targetAudience);
  addNullableChange(positioning, 'positioning', normalizeNullableText(normalized.positioning), current.positioning?.positioning);
  if (hasOwnKeys(positioning)) {
    input.positioning = positioning;
  }

  changedSettingKeys.push(...Object.keys(input));

  const forbiddenKey = assertNoForbiddenOwnerSettingsFields(input);
  if (forbiddenKey) {
    errors.push(`owner settings update rejected: forbidden ${forbiddenKey} present`);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      changed: false,
      source: OWNER_SETTINGS_SAVE_SOURCE,
      failure: 'owner-settings-invalid',
      errors,
      input: null,
      ...(normalized.rawRuleTextCandidate ? { rawRuleTextCandidate: normalized.rawRuleTextCandidate } : {}),
    };
  }

  if (!hasOwnKeys(input)) {
    return {
      ok: false,
      changed: false,
      source: OWNER_SETTINGS_SAVE_SOURCE,
      failure: normalized.rawRuleTextCandidate ? 'raw-rule-review-deferred' : 'owner-settings-no-changes',
      errors: [normalized.rawRuleTextCandidate ? RAW_RULE_REVIEW_DEFERRED_REASON : 'owner settings have no reviewed changes'],
      input: null,
      ...(normalized.rawRuleTextCandidate ? { rawRuleTextCandidate: normalized.rawRuleTextCandidate } : {}),
    };
  }

  const preview: OwnerSettingsPayloadPreview = {
    source: OWNER_SETTINGS_SAVE_SOURCE,
    ownerReviewed: true,
    submitted: input,
    ...(normalized.rawRuleTextCandidate
      ? {
        rawRuleReview: {
          deferred: true,
          reason: RAW_RULE_REVIEW_DEFERRED_REASON,
          text: normalized.rawRuleTextCandidate,
        },
      }
      : {}),
  };

  return {
    ok: true,
    changed: true,
    source: OWNER_SETTINGS_SAVE_SOURCE,
    input,
    changedSettingKeys,
    ...(normalized.rawRuleTextCandidate ? { rawRuleTextCandidate: normalized.rawRuleTextCandidate } : {}),
    preview,
  };
}
