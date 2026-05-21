export const OWNER_SETTINGS_SAVE_SOURCE = 'Realm MeService.updateMyRealmAgentSettings';
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
