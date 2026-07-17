import type {
  Realm,
} from '../../realm';
import type {
  RealmWorldCoreControllerGetOasisWorldOperationResponse,
  RealmWorldCoreControllerGetPersonaCharacterOperationResponse,
  RealmWorldCoreControllerGetWorldCharacterOperationResponse,
  RealmWorldCoreControllerGetWorldCoreOperationResponse,
  RealmWorldCoreControllerListPersonaCharactersOperationResponse,
  RealmWorldCoreControllerListWorldCharactersOperationResponse,
  RealmWorldCoreControllerListWorldCoresOperationRequest,
  RealmWorldCoreControllerListWorldCoresOperationResponse,
} from '../../realm/generated';
import { createNimiError } from '../../types';

export type WorldWorkflowVisibilityFilter =
  NonNullable<RealmWorldCoreControllerListWorldCoresOperationRequest['query']>['visibility'];

export type WorldWorkflowReadKind =
  | 'oasis-world'
  | 'world-core'
  | 'world-core-list'
  | 'world-character'
  | 'world-character-list'
  | 'persona-character'
  | 'persona-character-list';

export interface WorldWorkflowReadStep {
  readonly kind: WorldWorkflowReadKind;
  readonly worldId?: string;
  readonly characterId?: string;
  readonly personaCharacterId?: string;
  readonly visibility?: WorldWorkflowVisibilityFilter;
  readonly take?: number;
}

export type WorldWorkflowReadResult =
  | { readonly kind: 'oasis-world'; readonly world: RealmWorldCoreControllerGetOasisWorldOperationResponse }
  | { readonly kind: 'world-core'; readonly world: RealmWorldCoreControllerGetWorldCoreOperationResponse }
  | { readonly kind: 'world-core-list'; readonly worlds: RealmWorldCoreControllerListWorldCoresOperationResponse }
  | { readonly kind: 'world-character'; readonly character: RealmWorldCoreControllerGetWorldCharacterOperationResponse }
  | { readonly kind: 'world-character-list'; readonly characters: RealmWorldCoreControllerListWorldCharactersOperationResponse }
  | { readonly kind: 'persona-character'; readonly personaCharacter: RealmWorldCoreControllerGetPersonaCharacterOperationResponse }
  | { readonly kind: 'persona-character-list'; readonly personaCharacters: RealmWorldCoreControllerListPersonaCharactersOperationResponse };

export interface WorldWorkflowPlan {
  readonly planId: string;
  readonly steps: readonly WorldWorkflowReadStep[];
}

export type WorldWorkflowEvent =
  | { readonly type: 'world.workflow.started'; readonly planId: string; readonly stepCount: number }
  | { readonly type: 'world.workflow.step.completed'; readonly planId: string; readonly index: number; readonly kind: WorldWorkflowReadKind }
  | { readonly type: 'world.workflow.completed'; readonly planId: string; readonly results: readonly WorldWorkflowReadResult[] };

export function createWorldWorkflowPlan(input: {
  readonly planId: string;
  readonly steps: readonly WorldWorkflowReadStep[];
}): WorldWorkflowPlan {
  const planId = requireText(input.planId, 'world workflow planId is required', 'provide_world_workflow_plan_id');
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    workflowError('SDK_WORLD_WORKFLOW_PLAN_INVALID', 'world workflow requires at least one step', 'add_world_workflow_step');
  }
  for (const step of input.steps) {
    validateWorldWorkflowStep(step);
  }
  return { planId, steps: input.steps.map((step) => ({ ...step })) };
}

export async function executeWorldWorkflowPlan(
  realm: Realm,
  plan: WorldWorkflowPlan,
): Promise<{
  readonly events: readonly WorldWorkflowEvent[];
  readonly results: readonly WorldWorkflowReadResult[];
}> {
  if (!realm?.worldCore) {
    workflowError('SDK_WORLD_WORKFLOW_REALM_REQUIRED', 'world workflow requires a Realm facade with worldCore methods', 'provide_realm_facade');
  }
  const events: WorldWorkflowEvent[] = [
    { type: 'world.workflow.started', planId: plan.planId, stepCount: plan.steps.length },
  ];
  const results: WorldWorkflowReadResult[] = [];
  for (const [index, step] of plan.steps.entries()) {
    results.push(await executeWorldWorkflowStep(realm, step));
    events.push({ type: 'world.workflow.step.completed', planId: plan.planId, index, kind: step.kind });
  }
  events.push({ type: 'world.workflow.completed', planId: plan.planId, results });
  return { events, results };
}

export async function executeWorldWorkflowStep(
  realm: Realm,
  step: WorldWorkflowReadStep,
): Promise<WorldWorkflowReadResult> {
  validateWorldWorkflowStep(step);
  if (step.kind === 'oasis-world') {
    const world = await realm.worldCore.worldCoreControllerGetOasisWorld({ path: {} });
    return { kind: 'oasis-world', world };
  }
  if (step.kind === 'world-core') {
    const world = await realm.worldCore.worldCoreControllerGetWorldCore({ path: { worldId: requireWorldId(step.worldId) } });
    return { kind: 'world-core', world };
  }
  if (step.kind === 'world-character') {
    const character = await realm.worldCore.worldCoreControllerGetWorldCharacter({ path: { characterId: requireCharacterId(step.characterId) } });
    return { kind: 'world-character', character };
  }
  if (step.kind === 'world-character-list') {
    const characters = await realm.worldCore.worldCoreControllerListWorldCharacters({ path: { worldId: requireWorldId(step.worldId) } });
    return { kind: 'world-character-list', characters };
  }
  if (step.kind === 'persona-character') {
    const personaCharacter = await realm.worldCore.worldCoreControllerGetPersonaCharacter({
      path: { personaCharacterId: requirePersonaCharacterId(step.personaCharacterId) },
    });
    return { kind: 'persona-character', personaCharacter };
  }
  if (step.kind === 'persona-character-list') {
    const personaCharacters = await realm.worldCore.worldCoreControllerListPersonaCharacters({ path: {} });
    return { kind: 'persona-character-list', personaCharacters };
  }
  const worlds = await realm.worldCore.worldCoreControllerListWorldCores({
    path: {},
    query: {
      ...(step.visibility === undefined ? {} : { visibility: step.visibility }),
      ...(step.take === undefined ? {} : { take: step.take }),
    },
  });
  return { kind: 'world-core-list', worlds };
}

export function oasisWorldStep(): WorldWorkflowReadStep {
  return { kind: 'oasis-world' };
}

export function worldCoreStep(worldId: string): WorldWorkflowReadStep {
  return { kind: 'world-core', worldId: requireWorldId(worldId) };
}

export function listWorldCoresStep(input: {
  readonly visibility?: WorldWorkflowVisibilityFilter;
  readonly take?: number;
} = {}): WorldWorkflowReadStep {
  const step: WorldWorkflowReadStep = {
    kind: 'world-core-list',
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
    ...(input.take === undefined ? {} : { take: input.take }),
  };
  validateWorldWorkflowStep(step);
  return step;
}

export function worldCharacterStep(characterId: string): WorldWorkflowReadStep {
  return { kind: 'world-character', characterId: requireCharacterId(characterId) };
}

export function listWorldCharactersStep(worldId: string): WorldWorkflowReadStep {
  return { kind: 'world-character-list', worldId: requireWorldId(worldId) };
}

export function personaCharacterStep(personaCharacterId: string): WorldWorkflowReadStep {
  return {
    kind: 'persona-character',
    personaCharacterId: requirePersonaCharacterId(personaCharacterId),
  };
}

export function listPersonaCharactersStep(): WorldWorkflowReadStep {
  return { kind: 'persona-character-list' };
}

function validateWorldWorkflowStep(step: WorldWorkflowReadStep | null | undefined): void {
  if (!step || typeof step !== 'object') {
    workflowError('SDK_WORLD_WORKFLOW_STEP_INVALID', 'world workflow step is required', 'provide_world_workflow_step');
  }
  if (!['oasis-world', 'world-core', 'world-core-list', 'world-character', 'world-character-list', 'persona-character', 'persona-character-list'].includes(step.kind)) {
    workflowError('SDK_WORLD_WORKFLOW_STEP_INVALID', `unsupported world workflow step kind: ${String(step.kind)}`, 'use_supported_world_workflow_step');
  }
  if (step.kind === 'world-core' || step.kind === 'world-character-list') {
    requireWorldId(step.worldId);
  }
  if (step.kind === 'world-character') {
    requireCharacterId(step.characterId);
  }
  if (step.kind === 'persona-character') {
    requirePersonaCharacterId(step.personaCharacterId);
  }
  if (step.take !== undefined && (!Number.isInteger(step.take) || step.take < 1)) {
    workflowError('SDK_WORLD_WORKFLOW_STEP_INVALID', 'take must be a positive integer', 'fix_world_core_take');
  }
}

function requireWorldId(value: unknown): string {
  return requireText(value, 'worldId is required', 'provide_world_id');
}

function requireCharacterId(value: unknown): string {
  return requireText(value, 'characterId is required', 'provide_world_character_id');
}

function requirePersonaCharacterId(value: unknown): string {
  return requireText(value, 'personaCharacterId is required', 'provide_persona_character_id');
}

function requireText(value: unknown, message: string, actionHint: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    workflowError('SDK_WORLD_WORKFLOW_INPUT_INVALID', message, actionHint);
  }
  return normalized;
}

function workflowError(code: string, message: string, actionHint: string): never {
  throw createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
  });
}
