import type {
  Realm,
} from '../../realm';
import type {
  RealmWorldControllerGetMainWorldOperationResponse,
  RealmWorldControllerListWorldsOperationRequest,
  RealmWorldControllerGetWorldDetailWithAgentsOperationResponse,
  RealmWorldControllerGetWorldHistoryOperationResponse,
  RealmWorldControllerGetWorldOperationResponse,
  RealmWorldControllerListWorldsOperationResponse,
} from '../../realm/generated';
import { createNimiError } from '../../types';

export type WorldWorkflowStatusFilter =
  NonNullable<RealmWorldControllerListWorldsOperationRequest['query']>['status'];

export type WorldWorkflowReadKind =
  | 'main-world'
  | 'world-summary'
  | 'world-detail-with-agents'
  | 'world-history'
  | 'world-list';

export interface WorldWorkflowReadStep {
  readonly kind: WorldWorkflowReadKind;
  readonly worldId?: string;
  readonly status?: WorldWorkflowStatusFilter;
  readonly recommendedAgentLimit?: number;
}

export type WorldWorkflowReadResult =
  | { readonly kind: 'main-world'; readonly world: RealmWorldControllerGetMainWorldOperationResponse }
  | { readonly kind: 'world-summary'; readonly world: RealmWorldControllerGetWorldOperationResponse }
  | { readonly kind: 'world-detail-with-agents'; readonly world: RealmWorldControllerGetWorldDetailWithAgentsOperationResponse }
  | { readonly kind: 'world-history'; readonly history: RealmWorldControllerGetWorldHistoryOperationResponse }
  | { readonly kind: 'world-list'; readonly worlds: RealmWorldControllerListWorldsOperationResponse };

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
  if (!realm?.world) {
    workflowError('SDK_WORLD_WORKFLOW_REALM_REQUIRED', 'world workflow requires a vNext Realm facade', 'provide_realm_facade');
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
  if (step.kind === 'main-world') {
    const world = await realm.world.worldControllerGetMainWorld({ path: {} });
    return { kind: 'main-world', world };
  }
  if (step.kind === 'world-summary') {
    const world = await realm.world.worldControllerGetWorld({ path: { id: requireWorldId(step.worldId) } });
    return { kind: 'world-summary', world };
  }
  if (step.kind === 'world-detail-with-agents') {
    const world = await realm.world.worldControllerGetWorldDetailWithAgents({
      path: { id: requireWorldId(step.worldId) },
      query: step.recommendedAgentLimit === undefined ? {} : { recommendedAgentLimit: step.recommendedAgentLimit },
    });
    return { kind: 'world-detail-with-agents', world };
  }
  if (step.kind === 'world-history') {
    const history = await realm.world.worldControllerGetWorldHistory({ path: { id: requireWorldId(step.worldId) } });
    return { kind: 'world-history', history };
  }
  const worlds = await realm.world.worldControllerListWorlds({
    path: {},
    query: step.status === undefined ? {} : { status: step.status },
  });
  return { kind: 'world-list', worlds };
}

export function worldSummaryStep(worldId: string): WorldWorkflowReadStep {
  return { kind: 'world-summary', worldId: requireWorldId(worldId) };
}

export function mainWorldStep(): WorldWorkflowReadStep {
  return { kind: 'main-world' };
}

export function worldDetailWithAgentsStep(input: {
  readonly worldId: string;
  readonly recommendedAgentLimit?: number;
}): WorldWorkflowReadStep {
  const step: WorldWorkflowReadStep = {
    kind: 'world-detail-with-agents',
    worldId: requireWorldId(input.worldId),
    ...(input.recommendedAgentLimit === undefined ? {} : { recommendedAgentLimit: input.recommendedAgentLimit }),
  };
  validateWorldWorkflowStep(step);
  return step;
}

export function worldHistoryStep(worldId: string): WorldWorkflowReadStep {
  return { kind: 'world-history', worldId: requireWorldId(worldId) };
}

export function listWorldsStep(status?: WorldWorkflowStatusFilter): WorldWorkflowReadStep {
  return status === undefined ? { kind: 'world-list' } : { kind: 'world-list', status };
}

function validateWorldWorkflowStep(step: WorldWorkflowReadStep | null | undefined): void {
  if (!step || typeof step !== 'object') {
    workflowError('SDK_WORLD_WORKFLOW_STEP_INVALID', 'world workflow step is required', 'provide_world_workflow_step');
  }
  if (!['main-world', 'world-summary', 'world-detail-with-agents', 'world-history', 'world-list'].includes(step.kind)) {
    workflowError('SDK_WORLD_WORKFLOW_STEP_INVALID', `unsupported world workflow step kind: ${String(step.kind)}`, 'use_supported_world_workflow_step');
  }
  if (['world-summary', 'world-detail-with-agents', 'world-history'].includes(step.kind)) {
    requireWorldId(step.worldId);
  }
  if (step.recommendedAgentLimit !== undefined && (!Number.isInteger(step.recommendedAgentLimit) || step.recommendedAgentLimit < 0)) {
    workflowError('SDK_WORLD_WORKFLOW_STEP_INVALID', 'recommendedAgentLimit must be a non-negative integer', 'fix_recommended_agent_limit');
  }
}

function requireWorldId(value: unknown): string {
  return requireText(value, 'worldId is required', 'provide_world_id');
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
