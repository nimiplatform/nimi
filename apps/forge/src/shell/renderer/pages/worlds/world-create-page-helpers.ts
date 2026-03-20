import type {
  WorldStudioMainSlice,
  WorldStudioWorkflowSlice,
} from '@world-engine/controllers/world-studio-screen-model.js';
import type { WorldStudioRuntimeAiClient } from '@world-engine/runtime-ai-client.js';
import type {
  WorldStudioCreateStep,
  WorldStudioWorkspaceSnapshot,
} from '@world-engine/contracts.js';
import { getPlatformClient } from '@nimiplatform/sdk';
import type { JsonObject } from '@renderer/bridge/types.js';
import { getResolvedAiParams } from '@renderer/hooks/use-ai-config.js';

const WORLDVIEW_RULE_MODULES = [
  {
    field: 'timeModel',
    ruleKey: 'axiom:time:module',
    title: 'World Time Model',
    domain: 'AXIOM',
    category: 'MECHANISM',
    hardness: 'HARD',
    scope: 'WORLD',
  },
  {
    field: 'spaceTopology',
    ruleKey: 'axiom:space:module',
    title: 'World Space Topology',
    domain: 'AXIOM',
    category: 'DEFINITION',
    hardness: 'HARD',
    scope: 'WORLD',
  },
  {
    field: 'causality',
    ruleKey: 'axiom:causality:module',
    title: 'World Causality Model',
    domain: 'AXIOM',
    category: 'CONSTRAINT',
    hardness: 'HARD',
    scope: 'WORLD',
  },
  {
    field: 'coreSystem',
    ruleKey: 'physics:system:module',
    title: 'World Core System',
    domain: 'PHYSICS',
    category: 'MECHANISM',
    hardness: 'FIRM',
    scope: 'WORLD',
  },
  {
    field: 'existences',
    ruleKey: 'character:existence:catalog',
    title: 'World Existence Catalog',
    domain: 'CHARACTER',
    category: 'DEFINITION',
    hardness: 'FIRM',
    scope: 'WORLD',
  },
  {
    field: 'languages',
    ruleKey: 'society:language:catalog',
    title: 'World Language Catalog',
    domain: 'SOCIETY',
    category: 'DEFINITION',
    hardness: 'FIRM',
    scope: 'WORLD',
  },
  {
    field: 'resources',
    ruleKey: 'economy:resource:catalog',
    title: 'World Resource Catalog',
    domain: 'ECONOMY',
    category: 'DEFINITION',
    hardness: 'FIRM',
    scope: 'WORLD',
  },
  {
    field: 'structures',
    ruleKey: 'society:structure:catalog',
    title: 'World Structure Catalog',
    domain: 'SOCIETY',
    category: 'DEFINITION',
    hardness: 'SOFT',
    scope: 'WORLD',
  },
  {
    field: 'visualGuide',
    ruleKey: 'meta:visual:catalog',
    title: 'World Visual Guide',
    domain: 'META',
    category: 'POLICY',
    hardness: 'AESTHETIC',
    scope: 'WORLD',
  },
  {
    field: 'narrativeHooks',
    ruleKey: 'narrative:hook:catalog',
    title: 'World Narrative Hooks',
    domain: 'NARRATIVE',
    category: 'POLICY',
    hardness: 'SOFT',
    scope: 'WORLD',
  },
] as const;

export function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

export function deriveWorldRulesFromWorldviewPatch(
  worldviewPatch: JsonObject,
  sourceRef: string,
): JsonObject[] {
  return WORLDVIEW_RULE_MODULES
    .filter((config) => Object.prototype.hasOwnProperty.call(worldviewPatch, config.field))
    .map((config) => ({
      ruleKey: config.ruleKey,
      title: config.title,
      statement: `${config.title} generated from Forge create draft`,
      domain: config.domain,
      category: config.category,
      hardness: config.hardness,
      scope: config.scope,
      provenance: 'WORLD_STUDIO',
      priority: 100,
      sourceRef,
      structured: worldviewPatch[config.field],
      dependsOn: [],
      conflictsWith: [],
    }));
}

export function restoreWorldviewPatchFromWorldRules(
  worldRules: unknown,
): JsonObject {
  if (!Array.isArray(worldRules)) {
    return {};
  }

  const restored: JsonObject = {};
  for (const rawRule of worldRules) {
    const rule = asRecord(rawRule);
    const ruleKey = String(rule.ruleKey || '').trim();
    const config = WORLDVIEW_RULE_MODULES.find((item) => item.ruleKey === ruleKey);
    if (!config) continue;
    if (!Object.prototype.hasOwnProperty.call(rule, 'structured')) continue;
    restored[config.field] = rule.structured;
  }
  return restored;
}

export function getSelectedAgentDraftEntriesFromAgentSync(
  selectedCharacters: string[],
  agentSync: WorldStudioWorkspaceSnapshot['agentSync'],
): Array<{ characterName: string; draft: JsonObject }> {
  const selectedNames = agentSync.selectedCharacterIds.length > 0
    ? agentSync.selectedCharacterIds
    : selectedCharacters;
  const seen = new Set<string>();
  const entries: Array<{ characterName: string; draft: JsonObject }> = [];

  for (const name of selectedNames) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName || seen.has(normalizedName)) continue;
    const draft = asRecord(agentSync.draftsByCharacter[normalizedName]);
    entries.push({ characterName: normalizedName, draft });
    seen.add(normalizedName);
  }

  if (entries.length > 0) {
    return entries;
  }

  for (const [name, value] of Object.entries(agentSync.draftsByCharacter || {})) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName || seen.has(normalizedName)) continue;
    entries.push({ characterName: normalizedName, draft: asRecord(value) });
    seen.add(normalizedName);
  }

  return entries;
}

export function getSelectedAgentDraftEntries(
  snapshot: WorldStudioWorkspaceSnapshot,
): Array<{ characterName: string; draft: JsonObject }> {
  return getSelectedAgentDraftEntriesFromAgentSync(snapshot.selectedCharacters, snapshot.agentSync);
}

export function deriveAgentCoreRuleDrafts(
  snapshot: WorldStudioWorkspaceSnapshot,
): Array<{ characterName: string; payload: JsonObject }> {
  return getSelectedAgentDraftEntries(snapshot).map((entry) => {
    const concept = String(entry.draft.concept || '').trim();
    const backstory = String(entry.draft.backstory || '').trim();
    const coreValues = String(entry.draft.coreValues || '').trim();
    const relationshipStyle = String(entry.draft.relationshipStyle || '').trim();
    const statementParts = [concept, backstory, coreValues, relationshipStyle].filter(Boolean);

    return {
      characterName: entry.characterName,
      payload: {
        ruleKey: 'identity:self:core',
        title: `${entry.characterName} Core Identity`,
        statement: statementParts.join('\n\n') || `${entry.characterName} identity draft from Forge world creation.`,
        layer: 'DNA',
        category: 'DEFINITION',
        hardness: 'FIRM',
        scope: 'SELF',
        importance: 80,
        priority: 100,
        provenance: 'CREATOR',
        reasoning: 'Seeded from Forge world create draft.',
        structured: {
          characterName: entry.characterName,
          handle: String(entry.draft.handle || '').trim() || null,
          concept: concept || null,
          backstory: backstory || null,
          coreValues: coreValues || null,
          relationshipStyle: relationshipStyle || null,
          dnaPrimary: String(entry.draft.dnaPrimary || '').trim() || null,
          dna: entry.draft.dna && typeof entry.draft.dna === 'object' ? entry.draft.dna : null,
        },
      },
    };
  });
}

export function restoreAgentSyncFromAgentRuleDrafts(
  agentRules: unknown,
): {
  selectedCharacterIds: string[];
  draftsByCharacter: Record<string, JsonObject>;
} {
  if (!Array.isArray(agentRules)) {
    return { selectedCharacterIds: [], draftsByCharacter: {} };
  }

  const selectedCharacterIds: string[] = [];
  const draftsByCharacter: Record<string, JsonObject> = {};

  for (const rawItem of agentRules) {
    const item = asRecord(rawItem);
    const characterName = String(item.characterName || '').trim();
    const payload = asRecord(item.payload);
    const structured = asRecord(payload.structured);
    if (!characterName) continue;

    if (!selectedCharacterIds.includes(characterName)) {
      selectedCharacterIds.push(characterName);
    }

    draftsByCharacter[characterName] = {
      characterName,
      handle: String(structured.handle || '').trim(),
      concept: String(structured.concept || '').trim(),
      backstory: String(structured.backstory || '').trim(),
      coreValues: String(structured.coreValues || '').trim(),
      relationshipStyle: String(structured.relationshipStyle || '').trim(),
      dnaPrimary: String(structured.dnaPrimary || '').trim(),
      dna: structured.dna && typeof structured.dna === 'object' ? structured.dna : null,
    };
  }

  return { selectedCharacterIds, draftsByCharacter };
}

export function deriveRuleTruthDraftFromWorkspace(
  snapshot: Pick<WorldStudioWorkspaceSnapshot, 'worldviewPatch' | 'sourceRef' | 'selectedCharacters' | 'agentSync'>,
): WorldStudioWorkspaceSnapshot['ruleTruthDraft'] {
  const worldRules = deriveWorldRulesFromWorldviewPatch(
    snapshot.worldviewPatch as JsonObject,
    snapshot.sourceRef || 'forge:create-draft',
  );
  const agentEntries = getSelectedAgentDraftEntriesFromAgentSync(
    snapshot.selectedCharacters,
    snapshot.agentSync,
  );
  const agentRules = agentEntries.map((entry) => {
    const concept = String(entry.draft.concept || '').trim();
    const backstory = String(entry.draft.backstory || '').trim();
    const coreValues = String(entry.draft.coreValues || '').trim();
    const relationshipStyle = String(entry.draft.relationshipStyle || '').trim();
    const statementParts = [concept, backstory, coreValues, relationshipStyle].filter(Boolean);

    return {
      characterName: entry.characterName,
      payload: {
        ruleKey: 'identity:self:core',
        title: `${entry.characterName} Core Identity`,
        statement: statementParts.join('\n\n') || `${entry.characterName} identity draft from Forge world creation.`,
        layer: 'DNA',
        category: 'DEFINITION',
        hardness: 'FIRM',
        scope: 'SELF',
        importance: 80,
        priority: 100,
        provenance: 'CREATOR',
        reasoning: 'Seeded from Forge world create draft.',
        structured: {
          characterName: entry.characterName,
          handle: String(entry.draft.handle || '').trim() || null,
          concept: concept || null,
          backstory: backstory || null,
          coreValues: coreValues || null,
          relationshipStyle: relationshipStyle || null,
          dnaPrimary: String(entry.draft.dnaPrimary || '').trim() || null,
          dna: entry.draft.dna && typeof entry.draft.dna === 'object' ? entry.draft.dna : null,
        },
      },
    };
  });

  return {
    worldRules,
    agentRules,
  };
}

export function resolveRuleTruthDraft(
  snapshot: Pick<WorldStudioWorkspaceSnapshot, 'ruleTruthDraft' | 'worldviewPatch' | 'sourceRef' | 'selectedCharacters' | 'agentSync'>,
): WorldStudioWorkspaceSnapshot['ruleTruthDraft'] {
  const existingWorldRules = Array.isArray(snapshot.ruleTruthDraft?.worldRules)
    ? snapshot.ruleTruthDraft.worldRules.filter((item): item is JsonObject => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : [];
  const existingAgentRules = Array.isArray(snapshot.ruleTruthDraft?.agentRules)
    ? snapshot.ruleTruthDraft.agentRules.filter((item): item is { characterName: string; payload: JsonObject } => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : [];

  if (existingWorldRules.length > 0 || existingAgentRules.length > 0) {
    return {
      worldRules: existingWorldRules,
      agentRules: existingAgentRules,
    };
  }

  return deriveRuleTruthDraftFromWorkspace(snapshot);
}

export function setTimeFlowRatioOnWorldviewPatch(worldviewPatch: JsonObject, value: string): JsonObject {
  const numeric = Number(value);
  const timeModel = asRecord(worldviewPatch.timeModel);
  return {
    ...worldviewPatch,
    timeModel: {
      ...timeModel,
      timeFlowRatio: Number.isFinite(numeric) ? numeric : 1,
    },
  };
}

export function getTimeFlowRatioFromWorldviewPatch(worldviewPatch: JsonObject): string {
  const timeModel = asRecord(worldviewPatch.timeModel);
  const ratio = timeModel.timeFlowRatio;
  if (typeof ratio === 'number' && Number.isFinite(ratio)) {
    return String(ratio);
  }
  return '1';
}

export function createForgeAiClient(): WorldStudioRuntimeAiClient {
  const { runtime } = getPlatformClient();
  const textParams = getResolvedAiParams('text');
  const imageParams = getResolvedAiParams('image');
  return {
    generateText: async (input) => {
      const result = await runtime.ai.text.generate({
        model: textParams.model,
        connectorId: textParams.connectorId,
        route: textParams.route,
        input: input.prompt,
        system: input.systemPrompt,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      });
      const traceId = String(result.trace?.traceId || '').trim();
      return {
        text: String(result.text || ''),
        traceId,
        promptTraceId: traceId,
      };
    },
    generateImage: async (input) => {
      const result = await runtime.media.image.generate({
        model: imageParams.model,
        connectorId: imageParams.connectorId,
        route: imageParams.route,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        size: input.size,
        aspectRatio: input.aspectRatio,
        quality: input.quality,
        style: input.style,
        seed: input.seed,
        responseFormat: input.responseFormat,
        signal: input.abortSignal,
      });
      const artifacts = Array.isArray(result.artifacts)
        ? result.artifacts.map((artifact) => asRecord(artifact))
        : [];
      return {
        artifacts: Array.isArray(artifacts)
          ? artifacts.map((artifact) => ({
              uri: String(artifact.url || artifact.uri || '').trim() || undefined,
              mimeType: String(artifact.mimeType || '').trim() || undefined,
              bytes: artifact.bytes && (artifact.bytes as Uint8Array).length > 0 ? artifact.bytes as Uint8Array : undefined,
            }))
          : [],
        traceId: String(result.trace?.traceId || '').trim(),
      };
    },
    generateEmbedding: async (input) => {
      const result = await runtime.ai.embedding.generate({
        model: input.model || textParams.model,
        connectorId: textParams.connectorId,
        route: textParams.route,
        input: input.input,
      });
      return {
        embeddings: Array.isArray(result.vectors) ? result.vectors : [],
        traceId: String(result.trace?.traceId || '').trim(),
      };
    },
  };
}

function encodeImageArtifactBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}

export function resolveGeneratedImageUrl(
  artifacts: Array<{ url?: string; uri?: string; mimeType?: string; base64?: string; bytes?: Uint8Array }>,
): string {
  const artifact = artifacts[0];
  if (!artifact) return '';
  const url = String(artifact.url || artifact.uri || '').trim();
  if (url) return url;
  if (artifact.base64) {
    const mimeType = String(artifact.mimeType || '').trim() || 'image/png';
    return `data:${mimeType};base64,${artifact.base64}`;
  }
  if (artifact.bytes && artifact.bytes.length > 0) {
    const mimeType = String(artifact.mimeType || '').trim() || 'image/png';
    return `data:${mimeType};base64,${encodeImageArtifactBytes(artifact.bytes)}`;
  }
  return '';
}

export function toCreateDisplayStage(step: WorldStudioCreateStep): WorldStudioWorkflowSlice['createDisplayStage'] {
  if (step === 'CHECKPOINTS') return 'CURATE';
  if (step === 'SYNTHESIZE') return 'GENERATE';
  if (step === 'DRAFT' || step === 'PUBLISH') return 'REVIEW';
  return 'IMPORT';
}

export function toImportSubview(step: WorldStudioCreateStep): WorldStudioMainSlice['importSubview'] {
  if (step === 'SOURCE') return 'PREPARE';
  if (step === 'INGEST' || step === 'EXTRACT') return 'RUNNING';
  return 'RESULT';
}

export function toReviewSubview(step: WorldStudioCreateStep): WorldStudioMainSlice['reviewSubview'] {
  return step === 'PUBLISH' ? 'PUBLISH_REVIEW' : 'EDIT';
}

export function toDraftStatus(step: WorldStudioCreateStep): 'DRAFT' | 'SYNTHESIZE' | 'REVIEW' | 'PUBLISH' | 'FAILED' {
  if (step === 'SYNTHESIZE') return 'SYNTHESIZE';
  if (step === 'DRAFT') return 'REVIEW';
  if (step === 'PUBLISH') return 'PUBLISH';
  return 'DRAFT';
}
