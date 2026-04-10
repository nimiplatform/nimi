import {
  publishableWorldPackageSchema,
  type CanonicalPublishableWorldPackage,
} from '../../../../../../../packages/nimi-forge/src/contracts/index.js';
import type { ForgeWorkspaceSnapshot } from '@renderer/features/workbench/types.js';

function requireString(value: unknown, code: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

function optionalString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized ? normalized : null;
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

function slugify(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function deterministicId(prefix: string, seed: string): string {
  return `${prefix}-${slugify(seed) || 'item'}`;
}

function deterministicHash(seed: string): string {
  return `always-${slugify(seed) || 'default'}`;
}

function buildAgentRulesPayload(snapshot: ForgeWorkspaceSnapshot, draftAgentId: string) {
  const bundle = snapshot.reviewState.agentBundles.find((item) => item.draftAgentId === draftAgentId);
  if (!bundle || bundle.rules.length === 0) {
    return undefined;
  }
  const lines = bundle.rules.map((rule) => `[${rule.layer}] ${rule.title}: ${rule.statement}`);
  return {
    format: 'rule-lines-v1' as const,
    lines,
    text: lines.join('\n'),
  };
}

function buildVoiceResources(input: {
  worldId: string;
  userId: string;
  snapshot: ForgeWorkspaceSnapshot;
  agentIdMap: Record<string, string>;
}) {
  const resources: CanonicalPublishableWorldPackage['resources'] = [];
  const bindings: CanonicalPublishableWorldPackage['bindings'] = [];

  Object.values(input.snapshot.agentDrafts).forEach((agentDraft) => {
    if (!agentDraft.voiceDemoResourceId || !agentDraft.voiceDemoUrl) {
      return;
    }
    const agentId = input.agentIdMap[agentDraft.draftAgentId];
    if (!agentId) {
      return;
    }
    resources.push({
      id: agentDraft.voiceDemoResourceId,
      provider: 'forge-runtime-upload',
      storageRef: agentDraft.voiceDemoUrl,
      resourceType: 'AUDIO',
      mimeType: 'audio/mpeg',
      sizeBytes: null,
      width: null,
      height: null,
      durationSec: null,
      hashSha256: null,
      provenance: 'forge-enrichment',
      sourceRef: agentDraft.voiceDemoUrl,
      uploaderAccountId: input.userId,
      worldId: input.worldId,
      label: `${agentDraft.displayName} voice demo`,
      tags: ['forge-enrichment', 'voice-demo'],
    });
    bindings.push({
      id: deterministicId('binding', `${input.worldId}-${agentId}-voice-sample`),
      objectType: 'RESOURCE',
      objectId: agentDraft.voiceDemoResourceId,
      hostType: 'AGENT',
      hostId: agentId,
      bindingKind: 'PRESENTATION',
      bindingPoint: 'AGENT_VOICE_SAMPLE',
      priority: 0,
      conditions: null,
      conditionHash: deterministicHash(`${input.worldId}-${agentId}-voice-sample`),
      intentPrompt: null,
      tags: ['forge-enrichment', 'voice-demo'],
      scopeWorldId: input.worldId,
      createdBy: input.userId,
      versionPin: null,
    });
  });

  return { resources, bindings };
}

export function buildWorkbenchWorldPackage(input: {
  workspaceId: string;
  userId: string;
  snapshot: ForgeWorkspaceSnapshot;
}): CanonicalPublishableWorldPackage {
  const worldName = requireString(input.snapshot.worldDraft.name, 'FORGE_WORKBENCH_PACKAGE_WORLD_NAME_REQUIRED');
  const worldId = String(
    input.snapshot.worldDraft.worldId
    || deterministicId('forge-world', `${input.workspaceId}-${worldName}`),
  ).trim();
  const reviewedAt = new Date().toISOString();
  const packageVersion = `forge-workbench-${slugify(input.workspaceId)}-${input.snapshot.updatedAt.replace(/[^0-9]/g, '')}`;
  const worldRules = input.snapshot.reviewState.worldRules;

  if (worldRules.length === 0) {
    throw new Error('FORGE_WORKBENCH_PACKAGE_WORLD_RULES_REQUIRED');
  }

  const worldOwnedDrafts = Object.values(input.snapshot.agentDrafts)
    .filter((draft) => draft.ownershipType === 'WORLD_OWNED');

  const agentIdMap = Object.fromEntries(
    worldOwnedDrafts.map((draft) => [
      draft.draftAgentId,
      String(draft.sourceAgentId || deterministicId('forge-agent', `${worldId}-${draft.handle || draft.displayName}`)).trim(),
    ]),
  );

  const agentBlueprints = worldOwnedDrafts.map((draft) => ({
    id: agentIdMap[draft.draftAgentId]!,
    creatorId: input.userId,
    worldId,
    name: requireString(draft.displayName, 'FORGE_WORKBENCH_PACKAGE_AGENT_NAME_REQUIRED'),
    description: requireString(draft.description, `FORGE_WORKBENCH_PACKAGE_AGENT_DESCRIPTION_REQUIRED_${draft.draftAgentId}`),
    dna: {
      identity: {
        name: draft.displayName,
        handle: draft.handle,
      },
      authored: {
        concept: draft.concept,
      },
      enrichment: {
        scenario: draft.scenario,
        greeting: draft.greeting,
      },
    },
    dnaPrimary: requireString(draft.concept || draft.description, `FORGE_WORKBENCH_PACKAGE_AGENT_DNA_PRIMARY_REQUIRED_${draft.draftAgentId}`),
    dnaSecondary: [draft.handle].filter(Boolean),
    state: 'ACTIVE',
    wakeStrategy: 'PASSIVE',
    isAutonomous: false,
    ownershipType: 'WORLD_OWNED',
    ownerWorldId: worldId,
    activeWorldId: worldId,
    importance: 'PRIMARY',
    accountVisibility: 'PUBLIC',
    profileVisibility: 'PUBLIC',
    defaultPostVisibility: 'PUBLIC',
    dmVisibility: 'FOLLOWERS',
    nsfwEnabled: false,
    origin: draft.source,
    referenceImageUrl: draft.avatarUrl,
    visualCandidates: draft.avatarUrl ? [draft.avatarUrl] : [],
    scenario: requireString(draft.scenario, `FORGE_WORKBENCH_PACKAGE_AGENT_SCENARIO_REQUIRED_${draft.draftAgentId}`),
    greeting: requireString(draft.greeting, `FORGE_WORKBENCH_PACKAGE_AGENT_GREETING_REQUIRED_${draft.draftAgentId}`),
    rules: buildAgentRulesPayload(input.snapshot, draft.draftAgentId),
    tier: 'TIER_2' as const,
  }));

  worldOwnedDrafts.forEach((draft) => {
    if (!draft.voiceDemoUrl) {
      throw new Error(`FORGE_WORKBENCH_PACKAGE_AGENT_VOICE_DEMO_REQUIRED_${draft.draftAgentId}`);
    }
    if (!draft.voiceDemoResourceId) {
      throw new Error(`FORGE_WORKBENCH_PACKAGE_AGENT_VOICE_RESOURCE_REQUIRED_${draft.draftAgentId}`);
    }
  });

  const voiceArtifacts = buildVoiceResources({
    worldId,
    userId: input.userId,
    snapshot: input.snapshot,
    agentIdMap,
  });

  const pkg = {
    slug: slugify(worldName) || slugify(worldId),
    meta: {
      sourceTitle: worldName,
      sourceMode: 'forge-official' as const,
      generatedBy: 'world-agent-package-factory' as const,
      version: packageVersion,
      compatMode: 'native-v2' as const,
      reviewStatus: 'validated' as const,
    },
    slicePolicy: {
      timeSlice: `workbench-${input.workspaceId}`,
      forbiddenTerms: [],
      activeCharacters: worldOwnedDrafts.map((draft) => draft.displayName).filter(Boolean),
      notes: ['Forge workbench official package publish'],
    },
    world: {
      id: worldId,
      creatorId: input.userId,
      name: worldName,
      tagline: requireString(input.snapshot.worldDraft.tagline, 'FORGE_WORKBENCH_PACKAGE_WORLD_TAGLINE_REQUIRED'),
      motto: optionalString(input.snapshot.worldDraft.motto),
      overview: optionalString(input.snapshot.worldDraft.overview),
      description: requireString(input.snapshot.worldDraft.description, 'FORGE_WORKBENCH_PACKAGE_WORLD_DESCRIPTION_REQUIRED'),
      genre: requireString(input.snapshot.worldDraft.genre, 'FORGE_WORKBENCH_PACKAGE_WORLD_GENRE_REQUIRED'),
      themes: requireStringArray(input.snapshot.worldDraft.themes, 'FORGE_WORKBENCH_PACKAGE_WORLD_THEMES_REQUIRED'),
      era: optionalString(input.snapshot.worldDraft.era),
      contentRating: 'UNRATED' as const,
      type: 'CREATOR',
      status: 'ACTIVE',
      nativeCreationState: 'OPEN',
      nativeAgentLimit: agentBlueprints.length,
      transitInLimit: 16,
      lorebookEntryLimit: 0,
      level: 1,
      scoreQ: 0,
      scoreC: 0,
      scoreA: 0,
      scoreE: 0,
      scoreEwma: 0,
      iconUrl: input.snapshot.worldDraft.iconUrl,
      bannerUrl: input.snapshot.worldDraft.bannerUrl,
      reviewedAt,
      reviewedBy: input.userId,
    },
    worldviewMetadata: {
      id: deterministicId('forge-worldview', worldId),
      worldId,
      version: 1,
      lifecycle: 'ACTIVE' as const,
      tone: requireString(input.snapshot.worldDraft.genre, 'FORGE_WORKBENCH_PACKAGE_WORLD_GENRE_REQUIRED'),
      targetAudience: 'forge-official',
    },
    worldRules,
    agentBlueprints,
    agentRelationships: [],
    scenes: [],
    worldLorebooks: [],
    agentLorebooks: [],
    resources: voiceArtifacts.resources,
    bindings: voiceArtifacts.bindings,
    worldDrafts: [{
      id: String(input.snapshot.worldDraft.draftId || deterministicId('forge-draft', `${worldId}-${input.workspaceId}`)).trim(),
      ownerUserId: input.userId,
      targetWorldId: worldId,
      status: 'PUBLISH' as const,
      sourceType: input.snapshot.worldDraft.sourceType === 'NOVEL' ? 'FILE' : 'TEXT',
      sourceRef: input.snapshot.workspace.workspaceId,
      draftPayload: {
        workspaceId: input.workspaceId,
        sourceType: input.snapshot.worldDraft.sourceType,
        reviewState: {
          worldRuleCount: input.snapshot.reviewState.worldRules.length,
          agentBundleCount: input.snapshot.reviewState.agentBundles.length,
        },
      },
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
    throw new Error(`FORGE_WORKBENCH_PACKAGE_INVALID: ${details}`);
  }

  return parsed.data;
}
