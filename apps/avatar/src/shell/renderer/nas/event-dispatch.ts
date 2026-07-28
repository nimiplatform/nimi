import type {
  ActivitySource,
  AgentDataBundle,
  AgentDataDriver,
  AgentEvent,
} from '../driver/types.js';
import type {
  BackendProjection,
  Live2DBackendExtension,
} from '../carrier/backend-branch.js';
import { isAvatarUserInteractionEvent, type InteractionPhysicsController } from '../live2d/interaction-physics.js';
import { activityHandlerKey, isKnownActivityId } from './activity-naming.js';
import { createDefaultActivityHandler } from './default-fallback.js';
import { HandlerExecutor } from './handler-executor.js';
import type { HandlerRegistry } from './handler-registry.js';
import type { NasHandlerExtension } from './handler-types.js';
export { ContinuousScheduler } from './continuous-scheduler.js';

export type DispatchContext = {
  driver: AgentDataDriver;
  registry: HandlerRegistry;
  executor: HandlerExecutor;
  /** Backend-neutral ontology surface passed through to NAS handlers. */
  projection: BackendProjection;
  /** Live2D-only extension surface used internally by the sandbox projection
   *  translator for cue signal methods. It is not exposed to creator code. */
  live2dExtension?: Live2DBackendExtension;
  interactionPhysics?: InteractionPhysicsController;
};

const RUNTIME_ACTIVITY_EVENT = 'runtime.agent.presentation.activity_requested';
const FIXTURE_ACTIVITY_EVENT = 'avatar.fixture.presentation.activity_requested';

function bundleForEvent(base: AgentDataBundle, event: AgentEvent): AgentDataBundle {
  return {
    ...base,
    event: {
      event_name: event.name,
      event_id: event.event_id,
      timestamp: event.timestamp,
      detail: event.detail,
    },
  };
}

function readRuntimeAdmissionRef(
  detail: Record<string, unknown>,
  key: string,
): string | null {
  const value = detail[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasRuntimePresentationEnvelope(detail: Record<string, unknown>): boolean {
  return Boolean(
    readRuntimeAdmissionRef(detail, 'agent_id')
    && readRuntimeAdmissionRef(detail, 'conversation_anchor_id')
    && readRuntimeAdmissionRef(detail, 'turn_id')
    && readRuntimeAdmissionRef(detail, 'stream_id'),
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
  if (source !== 'apml_output' && source !== 'direct_api') {
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

export function wireEventDispatch(context: DispatchContext): () => void {
  const {
    driver,
    registry,
    executor,
    projection,
    live2dExtension,
    interactionPhysics,
  } = context;
  const defaultActivity = createDefaultActivityHandler();
  const extensionBag: NasHandlerExtension | undefined = live2dExtension
    ? { live2d: live2dExtension }
    : undefined;
  function runOptionsFor(): {
    extension?: NasHandlerExtension;
  } {
    return extensionBag ? { extension: extensionBag } : {};
  }

  const unsubscribe = driver.onEvent((event) => {
    if (event.name === RUNTIME_ACTIVITY_EVENT || event.name === FIXTURE_ACTIVITY_EVENT) {
      const activity = parseActivityProjection(event);
      if (!activity) return;
      const ctx = bundleForEvent({ ...driver.getBundle(), activity }, event);
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
      applyActivityStartCancellationPolicy(ctx, beforeEvent);
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
      driver.emit({
        name: 'avatar.activity.start',
        detail: {
          activity_name: activity.name,
          category: activity.category,
          intensity: activity.intensity,
          source: activity.source,
        },
      });
      const activityName = activity.name;
      const entry = registry.activity.get(activityHandlerKey(activityName)) ?? null;
      const handler = entry?.handler ?? defaultActivity;
      const key = `activity:${activityName}`;
      void executor.run(key, handler, ctx, projection, runOptionsFor()).then((result) => {
        if (result.status === 'success') {
          driver.emit({
            name: 'avatar.activity.end',
            detail: {
              activity_name: activityName,
              source: entry ? 'nas_handler' : 'default_fallback',
            },
          });
          return;
        }
        if (result.status === 'cancelled' || result.status === 'shutdown') {
          driver.emit({
            name: 'avatar.activity.cancel',
            detail: {
              activity_name: activityName,
              reason: result.status,
            },
          });
        }
      });
      return;
    }

    if (event.name === 'runtime.agent.presentation.expression_requested') {
      const expressionId = parseRuntimeExpressionProjection(event);
      if (!expressionId) return;
      const entry = registry.event.get(event.name) ?? null;
      const ctx = bundleForEvent(driver.getBundle(), event);
      if (entry) {
        void executor.run(
          `event:${event.name}`,
          entry.handler,
          ctx,
          projection,
          runOptionsFor(),
        );
        return;
      }
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
        console.warn(`[nas:fallback] runtime expression projection failed for ${expressionId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (interactionPhysics && isAvatarUserInteractionEvent(event.name)) {
      interactionPhysics.handle(event, driver.getBundle());
    }

    const entry = registry.event.get(event.name) ?? null;
    if (!entry) return;
    const ctx = bundleForEvent(driver.getBundle(), event);
    const key = `event:${event.name}`;
    void executor.run(key, entry.handler, ctx, projection, runOptionsFor());
  });

  return unsubscribe;
}
