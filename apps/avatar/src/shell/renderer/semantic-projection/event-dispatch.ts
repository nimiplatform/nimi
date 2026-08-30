import type {
  ActivitySource,
  AgentDataBundle,
  AgentDataDriver,
  AgentEvent,
} from '../driver/types.js';
import type {
  BackendActivityProjectionResult,
  BackendActivityProjectionSettlement,
  BackendProjection,
} from '../carrier/backend-branch.js';
import { isAvatarUserInteractionEvent, type InteractionPhysicsController } from '../live2d/interaction-physics.js';
import { isKnownActivityId } from './activity-naming.js';
import {
  isAvatarLocalQuiet,
  subscribeAvatarLocalQuiet,
} from '../local-quiet-state.js';
export type DispatchContext = {
  driver: AgentDataDriver;
  /** Backend-neutral semantic projection owned by the active backend. */
  projection: BackendProjection;
  interactionPhysics?: InteractionPhysicsController;
};

const RUNTIME_ACTIVITY_EVENT = 'runtime.agent.presentation.activity_requested';
const FIXTURE_ACTIVITY_EVENT = 'avatar.fixture.presentation.activity_requested';

function readRuntimeAdmissionRef(
  detail: Record<string, unknown>,
  key: string,
): string | null {
  const value = detail[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasRuntimePresentationEnvelope(detail: Record<string, unknown>): boolean {
  return Boolean(
    readRuntimeAdmissionRef(detail, 'agent_handle')
    && readRuntimeAdmissionRef(detail, 'conversation_anchor_id')
  );
}

function parseRuntimeActivityProjection(event: AgentEvent): NonNullable<AgentDataBundle['activity']> | null {
  const activityName = typeof event.detail['activity_name'] === 'string' ? event.detail['activity_name'].trim() : '';
  const category = event.detail['category'];
  const intensity = event.detail['intensity'];
  const source = event.detail['source'];
  if (!activityName || (category !== 'emotion' && category !== 'interaction' && category !== 'state')) {
    return null;
  }
  if (!isKnownActivityId(activityName)) {
    return null;
  }
  if (source !== 'runtime' && source !== 'apml_output' && source !== 'direct_api') {
    return null;
  }
  if (intensity !== undefined && intensity !== null && intensity !== 'weak' && intensity !== 'moderate' && intensity !== 'strong') {
    return null;
  }
  if (!hasRuntimePresentationEnvelope(event.detail)) {
    return null;
  }
  return {
    name: activityName,
    category,
    intensity: intensity === undefined ? null : intensity,
    source,
  };
}

function parseFixtureActivityProjection(event: AgentEvent): NonNullable<AgentDataBundle['activity']> | null {
  const activityName = typeof event.detail['activity_name'] === 'string' ? event.detail['activity_name'].trim() : '';
  const category = event.detail['category'];
  const intensity = event.detail['intensity'];
  const source = event.detail['source'];
  if (!activityName || (category !== 'emotion' && category !== 'interaction' && category !== 'state')) {
    return null;
  }
  if (source !== 'mock') {
    return null;
  }
  if (intensity !== undefined && intensity !== null && intensity !== 'weak' && intensity !== 'moderate' && intensity !== 'strong') {
    return null;
  }
  return {
    name: activityName,
    category,
    intensity: intensity === undefined ? null : intensity,
    source,
  };
}

function parseActivityProjection(event: AgentEvent): NonNullable<AgentDataBundle['activity']> | null {
  if (event.name === RUNTIME_ACTIVITY_EVENT) {
    return parseRuntimeActivityProjection(event);
  }
  if (event.name === FIXTURE_ACTIVITY_EVENT) {
    return parseFixtureActivityProjection(event);
  }
  return null;
}

function parseRuntimeProjectionSource(value: unknown): ActivitySource {
  return value === 'direct_api' ? value : 'apml_output';
}

function parseRuntimeExpressionProjection(event: AgentEvent): string | null {
  if (!hasRuntimePresentationEnvelope(event.detail)) {
    return null;
  }
  const expressionId = typeof event.detail['expression_id'] === 'string'
    ? event.detail['expression_id'].trim()
    : '';
  return expressionId || null;
}

function emitCancelable(
  driver: AgentDataDriver,
  event: {
    name: string;
    detail: Record<string, unknown>;
  },
): AgentEvent {
  const emitted = driver.emitCancelable?.(event);
  if (emitted) {
    return emitted;
  }
  driver.emit(event);
  return {
    event_id: '',
    name: event.name,
    timestamp: '',
    detail: event.detail,
  };
}

function applyActivityStartCancellationPolicy(
  bundle: AgentDataBundle,
  beforeEvent: {
    detail: Record<string, unknown>;
  },
): void {
  if (bundle.execution_state === 'SUSPENDED') {
    beforeEvent.detail['cancelled'] = true;
    beforeEvent.detail['cancel_reason'] = 'runtime_execution_suspended';
  }
}

function isPendingActivityProjection(
  result: BackendActivityProjectionResult,
): result is Extract<BackendActivityProjectionResult, { status: 'pending' }> {
  return typeof result === 'object'
    && result !== null
    && result.status === 'pending';
}

function currentRuntimeEnvelopeMatches(
  driver: AgentDataDriver,
  expected: Readonly<{ agentHandle: string | null; conversationAnchorId: string | null }>,
): boolean {
  if (!expected.agentHandle || !expected.conversationAnchorId) return true;
  const custom = driver.getBundle().custom;
  return readRuntimeAdmissionRef(custom ?? {}, 'agent_handle') === expected.agentHandle
    && readRuntimeAdmissionRef(custom ?? {}, 'conversation_anchor_id') === expected.conversationAnchorId;
}

export function wireEventDispatch(context: DispatchContext): () => void {
  const {
    driver,
    projection,
    interactionPhysics,
  } = context;
  let activityGeneration = 0;
  let closed = false;

  const emitAppliedActivity = (input: Readonly<{
    activity: NonNullable<AgentDataBundle['activity']>;
    activityName: string;
    generation: number;
    runtimeEnvelope: Readonly<{
      agentHandle: string | null;
      conversationAnchorId: string | null;
    }>;
    settlement: BackendActivityProjectionSettlement;
  }>): void => {
    if (input.settlement !== 'applied'
      || closed
      || isAvatarLocalQuiet()
      || input.generation !== activityGeneration
      || !currentRuntimeEnvelopeMatches(driver, input.runtimeEnvelope)) return;
    driver.emit({
      name: 'avatar.activity.start',
      detail: {
        activity_name: input.activity.name,
        category: input.activity.category,
        intensity: input.activity.intensity,
        source: input.activity.source,
      },
    });
    driver.emit({
      name: 'avatar.activity.end',
      detail: {
        activity_name: input.activityName,
        source: 'default_projection',
      },
    });
  };

  const unsubscribe = driver.onEvent((event) => {
    if (isAvatarLocalQuiet()) return;
    if (event.name === RUNTIME_ACTIVITY_EVENT || event.name === FIXTURE_ACTIVITY_EVENT) {
      const activity = parseActivityProjection(event);
      if (!activity) return;
      const generation = ++activityGeneration;
      const runtimeEnvelope = event.name === RUNTIME_ACTIVITY_EVENT
        ? {
            agentHandle: readRuntimeAdmissionRef(event.detail, 'agent_handle'),
            conversationAnchorId: readRuntimeAdmissionRef(event.detail, 'conversation_anchor_id'),
          }
        : { agentHandle: null, conversationAnchorId: null };
      const bundle = { ...driver.getBundle(), activity };
      const beforeEvent = {
        name: 'avatar.before.activity.start',
        detail: {
          activity_name: activity.name,
          category: activity.category,
          intensity: activity.intensity,
          source: activity.source,
          cancelled: false,
        },
      };
      applyActivityStartCancellationPolicy(bundle, beforeEvent);
      const emittedBeforeEvent = emitCancelable(driver, beforeEvent);
      if (emittedBeforeEvent.detail['cancelled'] === true) {
        driver.emit({
          name: 'avatar.activity.cancel',
          detail: {
            activity_name: activity.name,
            reason: typeof emittedBeforeEvent.detail['cancel_reason'] === 'string'
              ? emittedBeforeEvent.detail['cancel_reason']
              : 'before_event_cancelled',
          },
        });
        return;
      }
      const activityName = activity.name;
      try {
        const result = projection.applyActivity({
          name: activityName,
          intensity: activity.intensity === 'weak'
            ? 0.25
            : activity.intensity === 'moderate'
              ? 0.5
              : activity.intensity === 'strong'
                ? 0.85
                : null,
        });
        if (isPendingActivityProjection(result)) {
          void result.completion.then((settlement) => {
            emitAppliedActivity({
              activity,
              activityName,
              generation,
              runtimeEnvelope,
              settlement,
            });
          }).catch((error: unknown) => {
            console.warn(`[avatar:projection] pending activity settlement failed for ${activityName}: ${error instanceof Error ? error.message : String(error)}`);
          });
          return;
        }
        emitAppliedActivity({
          activity,
          activityName,
          generation,
          runtimeEnvelope,
          settlement: result,
        });
      } catch (error) {
        console.warn(`[avatar:projection] activity projection failed for ${activityName}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }

    if (event.name === 'avatar.presentation.expression_requested') {
      const expressionId = parseRuntimeExpressionProjection(event);
      if (!expressionId) return;
      try {
        projection.applyExpression({ name: expressionId });
        driver.emit({
          name: 'avatar.expression.change',
          detail: {
            expression_id: expressionId,
            source: parseRuntimeProjectionSource(event.detail['source']),
          },
        });
      } catch (err) {
        console.warn(`[avatar:projection] runtime expression projection failed for ${expressionId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (interactionPhysics && isAvatarUserInteractionEvent(event.name)) {
      interactionPhysics.handle(event, driver.getBundle());
    }
  });
  const unsubscribeQuiet = subscribeAvatarLocalQuiet((quiet) => {
    if (!quiet) return;
    activityGeneration += 1;
    interactionPhysics?.reset();
    projection.reset();
  });

  return () => {
    closed = true;
    activityGeneration += 1;
    unsubscribeQuiet();
    unsubscribe();
  };
}
