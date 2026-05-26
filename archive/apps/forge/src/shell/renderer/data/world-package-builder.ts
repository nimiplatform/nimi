import type {
  WorldLorebookDraftRow,
} from '@world-engine/contracts.js';
import type { JsonObject } from '@renderer/bridge';
import type { ForgeWorkspaceSnapshot } from '@renderer/state/creator-world-workspace.js';
import {
  publishableWorldPackageSchema,
  type CanonicalPublishableWorldPackage,
} from '../../../../../../../packages/nimi-forge/src/contracts/index.js';

const WORLD_CONTENT_RATINGS = ['UNRATED', 'G', 'PG13', 'R18', 'EXPLICIT'] as const;
const WORLD_DRAFT_SOURCE_TYPES = ['TEXT', 'FILE'] as const;
const WORLDVIEW_LIFECYCLES = ['ACTIVE', 'MAINTENANCE', 'FROZEN', 'ARCHIVED'] as const;

type ForgeAgentRuleDraft = ForgeWorkspaceSnapshot['ruleTruthDraft']['agentRules'][number];
type ForgeAgentDraftRecord = ForgeWorkspaceSnapshot['agentSync']['draftsByCharacter'][string];

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function slugify(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function createDeterministicId(prefix: string, seed: string): string {
  const normalizedSeed = slugify(seed) || 'item';
  return `${prefix}-${normalizedSeed}`;
}

function requireString(value: unknown, code: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

function requireStringArray(value: unknown, code: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(code);
  }
  const normalized = value
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 0);
  if (normalized.length === 0) {
    throw new Error(code);
  }
  return normalized;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value == null) {
    return null;
  }
  const normalized = String(value || '').trim();
  return normalized ? normalized : null;
}

function requireNullableString(value: unknown, code: string): string | null {
  if (value == null) {
    return null;
  }
  return requireString(value, code);
}

function numberOrDefault(value: unknown, fallback: number): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function requireEnum<const Values extends readonly string[]>(
  value: unknown,
  allowed: Values,
  code: string,
): Values[number] {
  const normalized = requireString(value, code);
  if (!allowed.includes(normalized)) {
    throw new Error(code);
  }
  return normalized as Values[number];
}

function parseFutureHistoricalEvents(value: string): JsonObject[] {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error('FORGE_PACKAGE_FUTURE_EVENTS_INVALID');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('FORGE_PACKAGE_FUTURE_EVENTS_INVALID');
  }
  return parsed.map((item) => asRecord(item));
}

function normalizeRulesPayload(
  draft: JsonObject,
  characterName: string,
): {
  format: 'rule-lines-v1';
  lines: string[];
  text: string;
} {
  const rawRules = asRecord(draft.rules);
  const lines = Array.isArray(rawRules.lines)
    ? rawRules.lines.map((item) => String(item || '').trim()).filter((item) => item.length > 0)
    : [];

  if (lines.length > 0 && rawRules.format === 'rule-lines-v1') {
    return {
      format: 'rule-lines-v1',
      lines,
      text: requireString(rawRules.text, 'FORGE_PACKAGE_AGENT_RULES_TEXT_REQUIRED'),
    };
  }

  const synthesized = [
    String(draft.concept || '').trim(),
    String(draft.backstory || '').trim(),
    String(draft.coreValues || '').trim(),
    String(draft.relationshipStyle || '').trim(),
  ].filter((item) => item.length > 0);

  if (synthesized.length === 0) {
    return {
      format: 'rule-lines-v1',
      lines: [`${characterName} official forge package draft.`],
      text: `${characterName} official forge package draft.`,
    };
  }

  return {
    format: 'rule-lines-v1',
    lines: synthesized,
    text: synthesized.join('\n'),
  };
}

function normalizeAgentDna(
  draft: JsonObject,
  characterName: string,
): Record<string, unknown> {
  const dna = asRecord(draft.dna);
  if (Object.keys(dna).length > 0) {
    return dna;
  }

  const concept = String(draft.concept || '').trim();
  const backstory = String(draft.backstory || '').trim();
  const coreValues = String(draft.coreValues || '').trim();
  const relationshipStyle = String(draft.relationshipStyle || '').trim();

  return {
    identity: {
      name: characterName,
      role: concept || 'official forge character',
      species: 'unknown',
      faction: null,
    },
    personality: {
      summary: coreValues || backstory || concept || characterName,
      relationshipStyle: relationshipStyle || null,
    },
    communication: {
      summary: relationshipStyle || concept || backstory || characterName,
    },
    authored: {
      aliases: [],
      titles: [],
    },
  };
}

function collectCharacterNames(snapshot: ForgeWorkspaceSnapshot): string[] {
  const names = new Set<string>();

  snapshot.selectedCharacters.forEach((item) => {
    const normalized = String(item || '').trim();
    if (normalized) {
      names.add(normalized);
    }
  });

  Object.keys(snapshot.agentSync.draftsByCharacter || {}).forEach((item) => {
    const normalized = String(item || '').trim();
    if (normalized) {
      names.add(normalized);
    }
  });

  snapshot.ruleTruthDraft.agentRules.forEach((item) => {
    const normalized = String(item.characterName || '').trim();
    if (normalized) {
      names.add(normalized);
    }
  });

  return [...names];
}

function findAgentRuleDraft(
  agentRules: ForgeAgentRuleDraft[],
  characterName: string,
): ForgeAgentRuleDraft | undefined {
  return agentRules.find((item) => String(item.characterName || '').trim() === characterName);
}

function buildAgentBlueprints(input: {
  worldId: string;
  userId: string;
  snapshot: ForgeWorkspaceSnapshot;
}): {
  agentBlueprints: CanonicalPublishableWorldPackage['truth']['agents']['blueprints'];
  agentLorebooks: CanonicalPublishableWorldPackage['compat']['agentLorebooks'];
} {
  const characterNames = collectCharacterNames(input.snapshot);
  const agentLorebooks: CanonicalPublishableWorldPackage['compat']['agentLorebooks'] = [];

  const agentBlueprints = characterNames.map((characterName, index) => {
    const draft = asRecord(input.snapshot.agentSync.draftsByCharacter[characterName] as ForgeAgentDraftRecord);
    const ruleDraft = findAgentRuleDraft(input.snapshot.ruleTruthDraft.agentRules, characterName);
    const structured = asRecord(ruleDraft?.payload?.structured);
    const merged = {
      ...structured,
      ...draft,
    };

    const agentId = createDeterministicId('forge-agent', `${input.worldId}-${characterName}`);
    const description = String(
      merged.description
      || merged.concept
      || merged.backstory
      || `${characterName} official forge agent`
    ).trim();
    const dnaPrimary = String(merged.dnaPrimary || merged.concept || merged.backstory || characterName).trim();
    const dnaSecondary = Array.isArray(merged.dnaSecondary)
      ? merged.dnaSecondary.map((item) => String(item || '').trim()).filter(Boolean)
      : [
        String(merged.backstory || '').trim(),
        String(merged.coreValues || '').trim(),
        String(merged.relationshipStyle || '').trim(),
      ].filter(Boolean);

    const rawLorebooks = Array.isArray(merged.agentLorebooks) ? merged.agentLorebooks : [];
    rawLorebooks.forEach((item, lorebookIndex) => {
      const lorebook = asRecord(item);
      const name = requireString(
        lorebook.name || `${characterName} lorebook ${lorebookIndex + 1}`,
        'FORGE_PACKAGE_AGENT_LOREBOOK_NAME_REQUIRED',
      );
      const content = requireString(
        lorebook.content,
        'FORGE_PACKAGE_AGENT_LOREBOOK_CONTENT_REQUIRED',
      );
      agentLorebooks.push({
        id: String(lorebook.id || createDeterministicId('forge-agent-lore', `${agentId}-${name}`)),
        worldId: input.worldId,
        agentId,
        name,
        content,
        keywords: Array.isArray(lorebook.keywords)
          ? lorebook.keywords.map((entry) => String(entry || '').trim()).filter(Boolean)
          : [],
        priority: numberOrDefault(lorebook.priority, 100),
        constant: Boolean(lorebook.constant),
        enabled: lorebook.enabled !== false,
        source: typeof lorebook.source === 'string' ? lorebook.source : 'forge-official-package',
      });
    });

    return {
      id: agentId,
      creatorId: input.userId,
      worldId: input.worldId,
      name: characterName,
      description,
      dna: normalizeAgentDna(merged, characterName),
      dnaPrimary,
      dnaSecondary: dnaSecondary.length > 0 ? dnaSecondary : [description],
      state: 'ACTIVE',
      wakeStrategy: merged.wakeStrategy === 'PASSIVE' ? 'PASSIVE' : 'PROACTIVE',
      isAutonomous: true,
      ownershipType: 'WORLD',
      ownerWorldId: input.worldId,
      activeWorldId: input.worldId,
      importance: index === 0 ? 'HIGH' : 'MEDIUM',
      accountVisibility: 'PUBLIC',
      profileVisibility: 'PUBLIC',
      defaultPostVisibility: 'PUBLIC',
      dmVisibility: 'FOLLOWERS',
      referenceImageUrl: optionalNullableString(
        merged.referenceImageUrl
          || input.snapshot.assets.characterPortraits[characterName]?.imageUrl,
      ),
      ...(typeof merged.scenario === 'string' && merged.scenario.trim()
        ? { scenario: merged.scenario.trim() }
        : {}),
      ...(typeof merged.greeting === 'string' && merged.greeting.trim()
        ? { greeting: merged.greeting.trim() }
        : {}),
      ...(typeof merged.exampleDialogue === 'string' && merged.exampleDialogue.trim()
        ? { exampleDialogue: merged.exampleDialogue.trim() }
        : {}),
      ...(typeof merged.systemPromptBase === 'string' && merged.systemPromptBase.trim()
        ? { systemPromptBase: merged.systemPromptBase.trim() }
        : {}),
      ...(Array.isArray(merged.alternateGreetings)
        ? {
          alternateGreetings: merged.alternateGreetings
            .map((item) => String(item || '').trim())
            .filter(Boolean),
        }
        : {}),
      rules: normalizeRulesPayload(merged, characterName),
      tier: index === 0 ? 'TIER_1' as const : 'TIER_2' as const,
    };
  });

  return {
    agentBlueprints,
    agentLorebooks,
  };
}

function buildWorldLorebooks(
  worldId: string,
  rows: WorldLorebookDraftRow[],
): CanonicalPublishableWorldPackage['compat']['worldLorebooks'] {
  return rows.map((item, index) => {
    const row = asRecord(item);
    const name = String(row.name || row.key || `lorebook-${index + 1}`).trim();
    if (!name) {
      throw new Error('FORGE_PACKAGE_WORLD_LOREBOOK_NAME_REQUIRED');
    }

    const value = asRecord(row.value);
    const content = String(row.content || '').trim();
    const normalizedContent = content || (Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : '');
    if (!normalizedContent) {
      throw new Error('FORGE_PACKAGE_WORLD_LOREBOOK_CONTENT_REQUIRED');
    }

    return {
      id: String(row.id || createDeterministicId('forge-world-lore', `${worldId}-${name}`)),
      worldId,
      key: String(row.key || '').trim() || undefined,
      name,
      content: normalizedContent,
      ...(Object.keys(value).length > 0 ? { value } : {}),
      keywords: Array.isArray(row.keywords)
        ? row.keywords.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [],
      priority: numberOrDefault(row.priority, 100),
      constant: Boolean(row.constant),
      enabled: row.enabled !== false,
      source: 'forge-official-package',
    };
  });
}

function buildWorldDraftPayload(snapshot: ForgeWorkspaceSnapshot, sourceMode: 'TEXT' | 'FILE'): JsonObject {
  const futureHistoricalEvents = parseFutureHistoricalEvents(snapshot.futureEventsText || '');

  return {
    importSource: {
      sourceType: sourceMode,
      sourceRef: String(snapshot.sourceRef || '').trim() || undefined,
      sourceText: String(snapshot.sourceText || '').trim() || undefined,
    },
    truthDraft: {
      worldRules: snapshot.ruleTruthDraft.worldRules,
      agentRules: snapshot.ruleTruthDraft.agentRules,
    },
    stateDraft: {
      worldState: snapshot.worldStateDraft,
    },
    historyDraft: {
      events: {
        primary: Array.isArray(snapshot.eventsDraft.primary) ? snapshot.eventsDraft.primary : [],
        secondary: Array.isArray(snapshot.eventsDraft.secondary) ? snapshot.eventsDraft.secondary : [],
        ...(futureHistoricalEvents.length > 0 ? { futureHistorical: futureHistoricalEvents } : {}),
      },
    },
  };
}

export function buildForgeOfficialWorldPackage(input: {
  userId: string;
  sourceMode: 'TEXT' | 'FILE';
  draftId?: string | null;
  snapshot: ForgeWorkspaceSnapshot;
}): CanonicalPublishableWorldPackage {
  const workspaceVersion = requireString(
    input.snapshot.workspaceVersion,
    'FORGE_PACKAGE_WORKSPACE_VERSION_REQUIRED',
  );
  const worldState = asRecord(input.snapshot.worldStateDraft);
  const worldName = requireString(worldState.name, 'FORGE_PACKAGE_WORLD_NAME_REQUIRED');
  const worldId = String(
    worldState.id
    || createDeterministicId('forge-world', workspaceVersion),
  ).trim();
  const { agentBlueprints, agentLorebooks } = buildAgentBlueprints({
    worldId,
    userId: input.userId,
    snapshot: input.snapshot,
  });
  const worldLorebooks = buildWorldLorebooks(worldId, input.snapshot.lorebooksDraft || []);
  const reviewedAt = new Date().toISOString();
  const worldRules = input.snapshot.ruleTruthDraft.worldRules;

  const worldRecord = {
    id: worldId,
    creatorId: input.userId,
    name: worldName,
    tagline: requireString(worldState.tagline, 'FORGE_PACKAGE_WORLD_TAGLINE_REQUIRED'),
    motto: requireNullableString(worldState.motto, 'FORGE_PACKAGE_WORLD_MOTTO_REQUIRED'),
    overview: requireNullableString(worldState.overview, 'FORGE_PACKAGE_WORLD_OVERVIEW_REQUIRED'),
    description: requireString(worldState.description, 'FORGE_PACKAGE_WORLD_DESCRIPTION_REQUIRED'),
    genre: requireString(worldState.genre, 'FORGE_PACKAGE_WORLD_GENRE_REQUIRED'),
    themes: requireStringArray(worldState.themes, 'FORGE_PACKAGE_WORLD_THEMES_REQUIRED'),
    era: requireNullableString(worldState.era, 'FORGE_PACKAGE_WORLD_ERA_REQUIRED'),
    contentRating: worldState.contentRating
      ? requireEnum(worldState.contentRating, WORLD_CONTENT_RATINGS, 'FORGE_PACKAGE_WORLD_CONTENT_RATING_REQUIRED')
      : 'UNRATED',
    type: requireString(worldState.type || 'CREATOR', 'FORGE_PACKAGE_WORLD_TYPE_REQUIRED'),
    status: requireString(worldState.status || 'ACTIVE', 'FORGE_PACKAGE_WORLD_STATUS_REQUIRED'),
    nativeCreationState: requireString(
      worldState.nativeCreationState || 'OPEN',
      'FORGE_PACKAGE_WORLD_NATIVE_CREATION_STATE_REQUIRED',
    ),
    nativeAgentLimit: agentBlueprints.length,
    transitInLimit: numberOrDefault(worldState.transitInLimit, 16),
    lorebookEntryLimit: worldLorebooks.length + agentLorebooks.length,
    level: numberOrDefault(worldState.level, 1),
    scoreQ: numberOrDefault(worldState.scoreQ, 0),
    scoreC: numberOrDefault(worldState.scoreC, 0),
    scoreA: numberOrDefault(worldState.scoreA, 0),
    scoreE: numberOrDefault(worldState.scoreE, 0),
    scoreEwma: numberOrDefault(worldState.scoreEwma, 0),
    iconUrl: optionalNullableString(worldState.iconUrl),
    bannerUrl: optionalNullableString(
      input.snapshot.assets.worldCover.imageUrl || worldState.bannerUrl,
    ),
    reviewedAt,
    reviewedBy: input.userId,
  };

  const worldviewMetadata = {
    id: createDeterministicId('forge-worldview', worldId),
    worldId,
    version: 1,
    lifecycle: input.snapshot.worldviewPatch.lifecycle
      ? requireEnum(input.snapshot.worldviewPatch.lifecycle, WORLDVIEW_LIFECYCLES, 'FORGE_PACKAGE_WORLDVIEW_LIFECYCLE_REQUIRED')
      : 'ACTIVE',
    tone: typeof worldState.genre === 'string' ? worldState.genre : undefined,
    targetAudience: 'forge-official',
  };

  const pkg = {
    slug: slugify(worldName) || slugify(worldId),
    meta: {
      sourceTitle: worldName,
      sourceMode: 'forge-official' as const,
      generatedBy: 'world-agent-package-factory' as const,
      version: `forge-${workspaceVersion}`,
      compatMode: 'native-v2' as const,
      reviewStatus: 'validated' as const,
    },
    slicePolicy: {
      timeSlice: requireString(
        input.snapshot.selectedStartTimeId,
        'FORGE_PACKAGE_TIME_SLICE_REQUIRED',
      ),
      forbiddenTerms: [],
      activeCharacters: collectCharacterNames(input.snapshot),
      notes: ['Forge official package hard-cut publish'],
    },
    truth: {
      world: {
        record: worldRecord,
        worldviewMetadata,
        rules: worldRules,
        scenes: [],
      },
      agents: {
        blueprints: agentBlueprints,
        relationships: [],
      },
    },
    derivation: {
      inheritanceCandidates: [],
      entryLine: ['official-package-publish'] as const,
    },
    projection: {
      inputs: [
        ...worldRules.map((rule) => ({
          id: createDeterministicId('forge-projection', `${worldId}-${rule.ruleKey}`),
          sourceType: 'WORLD_RULE' as const,
          sourceRef: rule.ruleKey,
          governingTruthRef: `world-rule:${rule.ruleKey}`,
          surfaceEligibility: ['runtime', 'creator_inspection', 'public_read', 'compat'] as const,
        })),
        ...agentBlueprints.map((agent: (typeof agentBlueprints)[number]) => ({
          id: createDeterministicId('forge-projection', `${worldId}-${agent.id}`),
          sourceType: 'AGENT_RULE_BATCH' as const,
          sourceRef: agent.id,
          governingTruthRef: `agent:${agent.id}`,
          surfaceEligibility: ['runtime', 'creator_inspection', 'public_read', 'compat'] as const,
        })),
      ],
    },
    evidence: {
      sourceChunkIds: [String(input.snapshot.sourceRef || workspaceVersion)],
      truthBindings: [],
    },
    governance: {
      packageId: createDeterministicId('forge-package', `${worldId}-${workspaceVersion}`),
      packageVersion: `forge-${workspaceVersion}`,
      sourceTitle: worldName,
      sourceMode: 'forge-official' as const,
      generatedBy: 'world-agent-package-factory' as const,
      reviewStatus: 'validated' as const,
      buildScope: 'forge-authoring' as const,
    },
    compat: {
      worldview: {
        worldState,
        worldviewPatch: input.snapshot.worldviewPatch,
      },
      agentProfiles: agentBlueprints.map((agent: (typeof agentBlueprints)[number]) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        dna: agent.dna,
        scenario: agent.scenario ?? null,
        greeting: agent.greeting ?? null,
      })),
      worldLorebooks,
      agentLorebooks,
    },
    resources: [],
    bindings: [],
    worldDrafts: [{
      id: String(input.draftId || createDeterministicId('forge-draft', `${worldId}-${workspaceVersion}`)),
      ownerUserId: input.userId,
      targetWorldId: worldId,
      status: 'PUBLISH' as const,
      sourceType: requireEnum(input.sourceMode, WORLD_DRAFT_SOURCE_TYPES, 'FORGE_PACKAGE_DRAFT_SOURCE_TYPE_REQUIRED'),
      sourceRef: String(input.snapshot.sourceRef || '').trim() || null,
      draftPayload: buildWorldDraftPayload(input.snapshot, input.sourceMode),
      publishedAt: reviewedAt,
    }],
  };

  const parsed = publishableWorldPackageSchema.safeParse(pkg);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'package';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    throw new Error(`FORGE_PACKAGE_BUILD_INVALID: ${details}`);
  }

  return parsed.data;
}
