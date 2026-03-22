/**
 * Import Publish Client — Backend push for import results
 *
 * Wraps existing world-data-client and agent-data-client functions
 * to publish imported rules to the backend. Handles partial failure
 * with retry support.
 */

import {
  createWorldDraft,
  publishWorldDraft,
  createWorldRule,
  createAgentRule,
} from '@renderer/data/world-data-client.js';
import {
  createCreatorAgent,
  batchCreateCreatorAgents,
  updateAgent,
} from '@renderer/data/agent-data-client.js';
import { canonicalizeHandleSeed } from '../engines/rule-key-canonicalizer.js';
import type { ForgePublishPlan } from '@renderer/features/workbench/types.js';

import type {
  LocalWorldRuleDraft,
  LocalAgentRuleDraft,
  LocalAgentRuleBundle,
} from '../types.js';

export type PublishProgress = {
  phase: 'CREATING_WORLD' | 'CREATING_AGENTS' | 'CREATING_WORLD_RULES' | 'CREATING_AGENT_RULES' | 'DONE';
  current: number;
  total: number;
  errors: PublishError[];
};

export type PublishError = {
  phase: string;
  item: string;
  message: string;
};

export type PublishResult = {
  worldId: string | null;
  agentIds: Record<string, string>;
  draftAgentIds?: Record<string, string>;
  publishedWorldRuleIds: string[];
  publishedAgentRuleIds: string[];
  errors: PublishError[];
};

type ProgressCallback = (progress: PublishProgress) => void;
const MAX_PUBLISH_ATTEMPTS = 3;

function isObjectLike(value: unknown): value is object {
  return Boolean(value) && typeof value === 'object';
}

function readStringField(value: unknown, key: string): string {
  if (!isObjectLike(value)) {
    return '';
  }
  const field = Reflect.get(value, key);
  return typeof field === 'string' ? field : '';
}

function readObjectArrayField(value: unknown, key: string): object[] {
  if (!isObjectLike(value)) {
    return [];
  }
  const field = Reflect.get(value, key);
  return Array.isArray(field) ? field.filter(isObjectLike) : [];
}

function buildImportDraftPayload(input: {
  worldName: string;
  worldDescription: string;
  sourceRef: string;
  worldRules: LocalWorldRuleDraft[];
}) {
  const worldName = String(input.worldName || '').trim();
  if (!worldName) {
    throw new Error('FORGE_IMPORT_WORLD_NAME_REQUIRED');
  }
  return {
    importSource: {
      sourceType: 'TEXT' as const,
      sourceRef: input.sourceRef,
    },
    truthDraft: {
      worldRules: input.worldRules,
      agentRules: [],
    },
    stateDraft: {
      worldState: {
        name: worldName,
        description: String(input.worldDescription || '').trim() || undefined,
      },
    },
    historyDraft: {
      events: {
        primary: [],
        secondary: [],
      },
    },
    workflowState: {
      workspaceVersion: crypto.randomUUID(),
      createStep: 'REVIEW',
      selectedCharacters: [],
    },
  };
}

async function retryOperation<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_PUBLISH_ATTEMPTS) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Publish character card import results.
 * Creates agent + agent rules, optionally world rules.
 */
export async function publishCharacterCardImport(params: {
  characterName: string;
  agentRules: LocalAgentRuleDraft[];
  worldRules: LocalWorldRuleDraft[];
  targetWorldId: string | null;
  ownerType: 'MASTER_OWNED' | 'WORLD_OWNED';
  onProgress?: ProgressCallback;
}): Promise<PublishResult> {
  const { characterName, agentRules, worldRules, targetWorldId, ownerType, onProgress } = params;
  const errors: PublishError[] = [];
  const result: PublishResult = {
    worldId: targetWorldId,
    agentIds: {},
    publishedWorldRuleIds: [],
    publishedAgentRuleIds: [],
    errors,
  };

  if (!targetWorldId) {
    errors.push({
      phase: 'CREATING_AGENTS',
      item: characterName,
      message: 'Target world is required before publishing imported character rules.',
    });
    result.errors = errors;
    return result;
  }

  // Phase 1: Create agent
  onProgress?.({ phase: 'CREATING_AGENTS', current: 0, total: 1, errors });
  try {
    const agentPayload = {
      handle: canonicalizeHandleSeed(characterName),
      displayName: characterName,
      concept: agentRules.find((r) => r.ruleKey === 'identity:self:core')?.statement.slice(0, 200) ?? characterName,
      ownershipType: ownerType as 'MASTER_OWNED' | 'WORLD_OWNED',
      worldId: targetWorldId,
    };
    const agentResponse = await retryOperation(() => createCreatorAgent(agentPayload));
    const agentId = readStringField(agentResponse, 'id');
    result.agentIds[characterName] = agentId;
  } catch (err) {
    errors.push({
      phase: 'CREATING_AGENTS',
      item: characterName,
      message: err instanceof Error ? err.message : String(err),
    });
    result.errors = errors;
    return result;
  }

  const agentId = result.agentIds[characterName];
  if (!agentId || !targetWorldId) {
    result.errors = errors;
    return result;
  }

  // Phase 2: Create world rules (if any)
  if (worldRules.length > 0 && targetWorldId) {
    onProgress?.({ phase: 'CREATING_WORLD_RULES', current: 0, total: worldRules.length, errors });
    for (let i = 0; i < worldRules.length; i++) {
      const worldRule = worldRules[i];
      if (!worldRule) {
        continue;
      }
      try {
        const response = await retryOperation(() => createWorldRule(targetWorldId, worldRule));
        result.publishedWorldRuleIds.push(readStringField(response, 'id'));
      } catch (err) {
        errors.push({
          phase: 'CREATING_WORLD_RULES',
          item: worldRule.ruleKey,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      onProgress?.({ phase: 'CREATING_WORLD_RULES', current: i + 1, total: worldRules.length, errors });
    }
  }

  // Phase 3: Create agent rules (ordered by layer)
  const layerOrder = ['DNA', 'BEHAVIORAL', 'RELATIONAL', 'CONTEXTUAL'] as const;
  const sortedRules = [...agentRules].sort((a, b) => {
    const aIdx = layerOrder.indexOf(a.layer);
    const bIdx = layerOrder.indexOf(b.layer);
    return aIdx - bIdx;
  });

  onProgress?.({ phase: 'CREATING_AGENT_RULES', current: 0, total: sortedRules.length, errors });
  for (let i = 0; i < sortedRules.length; i++) {
    const agentRule = sortedRules[i];
    if (!agentRule) {
      continue;
    }
    try {
        const response = await retryOperation(() => createAgentRule(targetWorldId, agentId, agentRule));
      result.publishedAgentRuleIds.push(readStringField(response, 'id'));
    } catch (err) {
      errors.push({
        phase: 'CREATING_AGENT_RULES',
        item: agentRule.ruleKey,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    onProgress?.({ phase: 'CREATING_AGENT_RULES', current: i + 1, total: sortedRules.length, errors });
  }

  onProgress?.({ phase: 'DONE', current: 1, total: 1, errors });
  result.errors = errors;
  return result;
}

/**
 * Publish a unified workspace plan.
 * Creates/updates the target world first, then world agents, then world/agent rule truth.
 */
export async function publishForgeWorkspacePlan(params: {
  plan: ForgePublishPlan;
  worldName: string;
  worldDescription: string;
  targetWorldId: string | null;
  agentBundles: Array<{
    draftAgentId: string;
    characterName: string;
    rules: LocalAgentRuleDraft[];
  }>;
  onProgress?: ProgressCallback;
}): Promise<PublishResult> {
  const { plan, worldName, worldDescription, agentBundles, onProgress } = params;
  let { targetWorldId } = params;
  const errors: PublishError[] = [];
  const result: PublishResult = {
    worldId: targetWorldId,
    agentIds: {},
    draftAgentIds: {},
    publishedWorldRuleIds: [],
    publishedAgentRuleIds: [],
    errors,
  };

  if (!targetWorldId && plan.worldAction === 'CREATE') {
    onProgress?.({ phase: 'CREATING_WORLD', current: 0, total: 1, errors });
    try {
      const draftResponse = await retryOperation(() => createWorldDraft({
        sourceType: 'TEXT',
        sourceRef: 'forge_workspace',
        draftPayload: buildImportDraftPayload({
          worldName,
          worldDescription,
          sourceRef: 'forge_workspace',
          worldRules: plan.worldRules,
        }),
      }));
      const draftId = readStringField(draftResponse, 'id');
      const publishResponse = await retryOperation(() => publishWorldDraft(draftId));
      targetWorldId = readStringField(publishResponse, 'worldId') || readStringField(publishResponse, 'id');
      result.worldId = targetWorldId;
    } catch (err) {
      errors.push({
        phase: 'CREATING_WORLD',
        item: worldName,
        message: err instanceof Error ? err.message : String(err),
      });
      return result;
    }
    onProgress?.({ phase: 'CREATING_WORLD', current: 1, total: 1, errors });
  }

  if (!targetWorldId) {
    errors.push({
      phase: 'CREATING_WORLD',
      item: worldName,
      message: 'Target world is required before publishing world-bound truth.',
    });
    return result;
  }

  const createAgents = plan.agents.filter((item) => item.action === 'CREATE_WORLD_AGENT');
  const updateAgents = plan.agents.filter((item) => item.action === 'UPDATE_WORLD_AGENT');
  const totalAgentOps = createAgents.length + updateAgents.length;

  onProgress?.({ phase: 'CREATING_AGENTS', current: 0, total: totalAgentOps || 1, errors });

  if (createAgents.length > 0) {
    try {
      const batchResponse = await retryOperation(() => batchCreateCreatorAgents({
        items: createAgents.map((item) => ({
          handle: item.handle || canonicalizeHandleSeed(item.displayName),
          displayName: item.displayName,
          concept: item.concept || item.displayName,
          ownershipType: 'WORLD_OWNED' as const,
          worldId: targetWorldId,
        })),
        continueOnError: true,
      }));

      const created = readObjectArrayField(batchResponse, 'created');
      const unmatched = new Set(createAgents.map((item) => item.draftAgentId));

      for (const item of created) {
        const id = readStringField(item, 'id');
        const displayName = readStringField(item, 'displayName');
        const matchedPlan = createAgents.find((planItem) => planItem.displayName === displayName);
        if (!id || !matchedPlan) {
          continue;
        }
        result.draftAgentIds![matchedPlan.draftAgentId] = id;
        result.agentIds[displayName] = id;
        unmatched.delete(matchedPlan.draftAgentId);
      }

      if (unmatched.size > 0) {
        for (const draftAgentId of unmatched) {
          const planItem = createAgents.find((item) => item.draftAgentId === draftAgentId);
          if (!planItem) {
            continue;
          }
          try {
            const createdAgent = await retryOperation(() => createCreatorAgent({
              handle: planItem.handle || canonicalizeHandleSeed(planItem.displayName),
              displayName: planItem.displayName,
              concept: planItem.concept || planItem.displayName,
              ownershipType: 'WORLD_OWNED' as const,
              worldId: targetWorldId,
            }));
            const id = readStringField(createdAgent, 'id');
            if (id) {
              result.draftAgentIds![draftAgentId] = id;
              result.agentIds[planItem.displayName] = id;
            }
          } catch (err) {
            errors.push({
              phase: 'CREATING_AGENTS',
              item: planItem.displayName,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } catch (err) {
      errors.push({
        phase: 'CREATING_AGENTS',
        item: 'batch-create',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const [index, item] of updateAgents.entries()) {
    if (!item.sourceAgentId) {
      errors.push({
        phase: 'CREATING_AGENTS',
        item: item.displayName,
        message: 'Missing sourceAgentId for update action.',
      });
      continue;
    }
    const sourceAgentId = item.sourceAgentId;
    try {
      await retryOperation(() => updateAgent(sourceAgentId, {
        displayName: item.displayName,
      }));
      result.draftAgentIds![item.draftAgentId] = sourceAgentId;
      result.agentIds[item.displayName] = sourceAgentId;
    } catch (err) {
      errors.push({
        phase: 'CREATING_AGENTS',
        item: item.displayName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    onProgress?.({
      phase: 'CREATING_AGENTS',
      current: createAgents.length + index + 1,
      total: totalAgentOps || 1,
      errors,
    });
  }

  if (createAgents.length > 0 && updateAgents.length === 0) {
    onProgress?.({
      phase: 'CREATING_AGENTS',
      current: createAgents.length,
      total: totalAgentOps || 1,
      errors,
    });
  }

  onProgress?.({
    phase: 'CREATING_WORLD_RULES',
    current: 0,
    total: plan.worldRules.length || 1,
    errors,
  });
  for (let i = 0; i < plan.worldRules.length; i++) {
    const worldRule = plan.worldRules[i];
    if (!worldRule) {
      continue;
    }
    try {
      const response = await retryOperation(() => createWorldRule(targetWorldId, worldRule));
      result.publishedWorldRuleIds.push(readStringField(response, 'id'));
    } catch (err) {
      errors.push({
        phase: 'CREATING_WORLD_RULES',
        item: worldRule.ruleKey,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    onProgress?.({
      phase: 'CREATING_WORLD_RULES',
      current: i + 1,
      total: plan.worldRules.length || 1,
      errors,
    });
  }

  const totalAgentRules = agentBundles.reduce((sum, bundle) => sum + bundle.rules.length, 0);
  let agentRuleProgress = 0;
  onProgress?.({
    phase: 'CREATING_AGENT_RULES',
    current: 0,
    total: totalAgentRules || 1,
    errors,
  });

  for (const bundle of agentBundles) {
    const targetAgentId = result.draftAgentIds?.[bundle.draftAgentId]
      || plan.agentRules.find((item) => item.draftAgentId === bundle.draftAgentId)?.agentId
      || null;
    if (!targetAgentId) {
      errors.push({
        phase: 'CREATING_AGENT_RULES',
        item: bundle.characterName,
        message: 'No resolved agent id found for bundle publish.',
      });
      continue;
    }
    for (const rule of bundle.rules) {
      try {
        const response = await retryOperation(() => createAgentRule(targetWorldId, targetAgentId, rule));
        result.publishedAgentRuleIds.push(readStringField(response, 'id'));
      } catch (err) {
        errors.push({
          phase: 'CREATING_AGENT_RULES',
          item: `${bundle.characterName}:${rule.ruleKey}`,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      agentRuleProgress++;
      onProgress?.({
        phase: 'CREATING_AGENT_RULES',
        current: agentRuleProgress,
        total: totalAgentRules || 1,
        errors,
      });
    }
  }

  onProgress?.({ phase: 'DONE', current: 1, total: 1, errors });
  return result;
}

/**
 * Publish novel import results.
 * Creates world + agents + all rules.
 */
export async function publishNovelImport(params: {
  worldName: string;
  worldDescription: string;
  worldRules: LocalWorldRuleDraft[];
  agentBundles: LocalAgentRuleBundle[];
  targetWorldId: string | null;
  onProgress?: ProgressCallback;
}): Promise<PublishResult> {
  const { worldName, worldDescription, worldRules, agentBundles, onProgress } = params;
  let { targetWorldId } = params;
  const errors: PublishError[] = [];
  const result: PublishResult = {
    worldId: targetWorldId,
    agentIds: {},
    publishedWorldRuleIds: [],
    publishedAgentRuleIds: [],
    errors,
  };

  // Phase 1: Create world if needed
  if (!targetWorldId) {
    onProgress?.({ phase: 'CREATING_WORLD', current: 0, total: 1, errors });
    try {
      const draftResponse = await retryOperation(() => createWorldDraft({
        sourceType: 'TEXT',
        sourceRef: 'novel_import',
        draftPayload: buildImportDraftPayload({
          worldName,
          worldDescription,
          sourceRef: 'novel_import',
          worldRules,
        }),
      }));
      const draftId = readStringField(draftResponse, 'id');

      const publishResponse = await retryOperation(() => publishWorldDraft(draftId));
      targetWorldId = readStringField(publishResponse, 'worldId') || readStringField(publishResponse, 'id');
      result.worldId = targetWorldId;
    } catch (err) {
      errors.push({
        phase: 'CREATING_WORLD',
        item: worldName,
        message: err instanceof Error ? err.message : String(err),
      });
      result.errors = errors;
      return result;
    }
    onProgress?.({ phase: 'CREATING_WORLD', current: 1, total: 1, errors });
  }

  if (!targetWorldId) {
    result.errors = errors;
    return result;
  }

  // Phase 2: Batch create agents
  if (agentBundles.length > 0) {
    onProgress?.({ phase: 'CREATING_AGENTS', current: 0, total: agentBundles.length, errors });
    const agentItems = agentBundles.map((bundle) => ({
      handle: canonicalizeHandleSeed(bundle.characterName),
      displayName: bundle.characterName,
      concept: bundle.rules.find((r) => r.ruleKey === 'identity:self:core')?.statement.slice(0, 200) ?? bundle.characterName,
      ownershipType: 'WORLD_OWNED' as const,
      worldId: targetWorldId,
    }));

    try {
      const batchResponse = await retryOperation(() => batchCreateCreatorAgents({
        items: agentItems,
        continueOnError: true,
      }));
      const created = readObjectArrayField(batchResponse, 'created');

      for (const item of created) {
        const name = readStringField(item, 'displayName');
        const id = readStringField(item, 'id');
        if (name && id) result.agentIds[name] = id;
      }
    } catch (err) {
      // Fallback: create agents one by one
      for (let i = 0; i < agentItems.length; i++) {
        const agentItem = agentItems[i];
        const bundle = agentBundles[i];
        if (!agentItem || !bundle) {
          continue;
        }
        try {
          const response = await retryOperation(() => createCreatorAgent(agentItem));
          result.agentIds[bundle.characterName] = readStringField(response, 'id');
        } catch (innerErr) {
          errors.push({
            phase: 'CREATING_AGENTS',
            item: bundle.characterName,
            message: innerErr instanceof Error ? innerErr.message : String(innerErr),
          });
        }
      }
    }
    onProgress?.({ phase: 'CREATING_AGENTS', current: agentBundles.length, total: agentBundles.length, errors });
  }

  // Phase 3: Create world rules
  if (worldRules.length > 0) {
    onProgress?.({ phase: 'CREATING_WORLD_RULES', current: 0, total: worldRules.length, errors });
    for (let i = 0; i < worldRules.length; i++) {
      const worldRule = worldRules[i];
      if (!worldRule) {
        continue;
      }
      try {
        const response = await retryOperation(() => createWorldRule(targetWorldId, worldRule));
        result.publishedWorldRuleIds.push(readStringField(response, 'id'));
      } catch (err) {
        errors.push({
          phase: 'CREATING_WORLD_RULES',
          item: worldRule.ruleKey,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      onProgress?.({ phase: 'CREATING_WORLD_RULES', current: i + 1, total: worldRules.length, errors });
    }
  }

  // Phase 4: Create agent rules per character
  const totalAgentRules = agentBundles.reduce((sum, b) => sum + b.rules.length, 0);
  let agentRuleProgress = 0;
  onProgress?.({ phase: 'CREATING_AGENT_RULES', current: 0, total: totalAgentRules, errors });

  for (const bundle of agentBundles) {
    const agentId = result.agentIds[bundle.characterName];
    if (!agentId) continue;

    for (const rule of bundle.rules) {
      try {
        const response = await retryOperation(() => createAgentRule(targetWorldId, agentId, rule));
        result.publishedAgentRuleIds.push(readStringField(response, 'id'));
      } catch (err) {
        errors.push({
          phase: 'CREATING_AGENT_RULES',
          item: `${bundle.characterName}:${rule.ruleKey}`,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      agentRuleProgress++;
      onProgress?.({ phase: 'CREATING_AGENT_RULES', current: agentRuleProgress, total: totalAgentRules, errors });
    }
  }

  onProgress?.({ phase: 'DONE', current: 1, total: 1, errors });
  result.errors = errors;
  return result;
}
