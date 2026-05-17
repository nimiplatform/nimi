import type { ActivitySource, AgentDataBundle, AgentDataDriver, AgentEvent } from '../driver/types.js';
import type {
  BackendProjection,
  Live2DBackendExtension,
} from '../carrier/backend-branch.js';
import { isAvatarUserInteractionEvent, type InteractionPhysicsController } from '../live2d/interaction-physics.js';
import { activityHandlerKey } from './activity-naming.js';
import { createDefaultActivityHandler } from './default-fallback.js';
import type {
  EmbodimentProjectionApi,
  NasHandlerExtension,
} from './embodiment-projection-api.js';
import { HandlerExecutor } from './handler-executor.js';
import type { HandlerRegistry } from './handler-registry.js';
export { ContinuousScheduler } from './continuous-scheduler.js';

export type DispatchContext = {
  driver: AgentDataDriver;
  registry: HandlerRegistry;
  executor: HandlerExecutor;
  /** Backend-neutral cue surface passed through to handlers, the sandbox,
   *  and default-activity fallback. */
  projection: EmbodimentProjectionApi;
  /** Ontology surface (BackendProjection). When provided, runtime
   *  expression / activity events are projected through this surface
   *  before falling back to the cue-level `setExpression` path. New
   *  callers MUST supply this; existing tests omit it for
   *  behavior-equivalent dispatch. */
  backendProjection?: BackendProjection;
  /** Live2D-only extension surface. Passed through to the executor
   *  only when a registered handler entry's
   *  `requiresLive2DExtension` flag is true. The registry rejects
   *  mismatched (VRM + live2d-extension) handlers up-front, so by
   *  construction this is non-null only for Live2D-loaded models. */
  live2dExtension?: Live2DBackendExtension;
  interactionPhysics?: InteractionPhysicsController;
};

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

function parseRuntimeActivityProjection(event: AgentEvent): NonNullable<AgentDataBundle['activity']> | null {
  const activityName = typeof event.detail['activity_name'] === 'string' ? event.detail['activity_name'].trim() : '';
  const category = event.detail['category'];
  const intensity = event.detail['intensity'];
  const source = event.detail['source'];
  if (!activityName || (category !== 'emotion' && category !== 'interaction' && category !== 'state')) {
    return null;
  }
  if (source !== 'apml_output' && source !== 'direct_api' && source !== 'mock') {
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

function parseRuntimeProjectionSource(value: unknown): ActivitySource {
  return value === 'direct_api' || value === 'mock' ? value : 'apml_output';
}

function parseRuntimeExpressionProjection(event: AgentEvent): string | null {
  const expressionId = typeof event.detail['expression_id'] === 'string'
    ? event.detail['expression_id'].trim()
    : '';
  return expressionId || null;
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
  // `backendProjection` is part of DispatchContext for ontology-level
  // dispatch. Ignore at runtime here to keep behavior equivalence with the
  // cue-level command-bus path used by the current handler sandbox.
  void context.backendProjection;
  const defaultActivity = createDefaultActivityHandler();
  const extensionBag: NasHandlerExtension | undefined = live2dExtension
    ? { live2d: live2dExtension }
    : undefined;
  function runOptionsFor(entry: { requiresLive2DExtension?: boolean } | null): {
    requiresLive2DExtension?: boolean;
    extension?: NasHandlerExtension;
  } {
    if (entry?.requiresLive2DExtension) {
      return {
        requiresLive2DExtension: true,
        extension: extensionBag,
      };
    }
    return {};
  }

  const unsubscribe = driver.onEvent((event) => {
    if (event.name === 'runtime.agent.presentation.activity_requested') {
      const activity = parseRuntimeActivityProjection(event);
      if (!activity) return;
      const ctx = bundleForEvent({ ...driver.getBundle(), activity }, event);
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
      // BackendProjection.applyActivity is intentionally not invoked here:
      // the default-activity fallback already routes through the Live2D
      // plugin-api command bus, and the Live2D BackendProjection adapter writes
      // to the same bus. Calling both would produce duplicate motion commands.
      // The BackendProjection surface is exposed to NAS handlers through the
      // executor; only `applyExpression` short-circuits the cue-level fallback
      // below.
      void executor.run(key, handler, ctx, projection, runOptionsFor(entry)).then((result) => {
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
          runOptionsFor(entry),
        );
        return;
      }
      // Behavior-equivalent path: continue routing through the cue-level
      // setExpression (which writes the same Cubism command-bus event
      // the BackendProjection adapter would emit). Switching this
      // dispatch path to BackendProjection.applyExpression requires the
      // projection adapter and plugin API to share one owner.
      void projection.setExpression(expressionId).then(() => {
        driver.emit({
          name: 'avatar.expression.change',
          detail: {
            expression_id: expressionId,
            source: parseRuntimeProjectionSource(event.detail['source']),
          },
        });
      }).catch((err: unknown) => {
        console.warn(`[nas:fallback] runtime expression projection failed for ${expressionId}: ${err instanceof Error ? err.message : String(err)}`);
      });
      return;
    }

    if (interactionPhysics && isAvatarUserInteractionEvent(event.name)) {
      interactionPhysics.handle(event, driver.getBundle());
    }

    const entry = registry.event.get(event.name) ?? null;
    if (!entry) return;
    const ctx = bundleForEvent(driver.getBundle(), event);
    const key = `event:${event.name}`;
    void executor.run(key, entry.handler, ctx, projection, runOptionsFor(entry));
  });

  return unsubscribe;
}
