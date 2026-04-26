import type { AgentDataBundle, AgentDataDriver, AgentEvent } from '../driver/types.js';
import { isAvatarUserInteractionEvent, type InteractionPhysicsController } from '../live2d/interaction-physics.js';
import { activityHandlerKey } from './activity-naming.js';
import { createDefaultActivityHandler } from './default-fallback.js';
import type { EmbodimentProjectionApi } from './embodiment-projection-api.js';
import { HandlerExecutor } from './handler-executor.js';
import type { HandlerRegistry } from './handler-registry.js';
export { ContinuousScheduler } from './continuous-scheduler.js';

export type DispatchContext = {
  driver: AgentDataDriver;
  registry: HandlerRegistry;
  executor: HandlerExecutor;
  projection: EmbodimentProjectionApi;
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
    source: 'runtime_projection',
  };
}

function parseRuntimeExpressionProjection(event: AgentEvent): string | null {
  const expressionId = typeof event.detail['expression_id'] === 'string'
    ? event.detail['expression_id'].trim()
    : '';
  return expressionId || null;
}

export function wireEventDispatch(context: DispatchContext): () => void {
  const { driver, registry, executor, projection, interactionPhysics } = context;
  const defaultActivity = createDefaultActivityHandler();

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
          source: 'runtime_projection',
          runtime_source: event.detail['source'],
        },
      });
      const activityName = activity.name;
      const entry = registry.activity.get(activityHandlerKey(activityName));
      const handler = entry?.handler ?? defaultActivity;
      const key = `activity:${activityName}`;
      void executor.run(key, handler, ctx, projection).then((result) => {
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
      const entry = registry.event.get(event.name);
      const ctx = bundleForEvent(driver.getBundle(), event);
      if (entry) {
        void executor.run(`event:${event.name}`, entry.handler, ctx, projection);
        return;
      }
      void projection.setExpression(expressionId).then(() => {
        driver.emit({
          name: 'avatar.expression.change',
          detail: {
            expression_id: expressionId,
            source: 'runtime_projection',
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

    const entry = registry.event.get(event.name);
    if (!entry) return;
    const ctx = bundleForEvent(driver.getBundle(), event);
    const key = `event:${event.name}`;
    void executor.run(key, entry.handler, ctx, projection);
  });

  return unsubscribe;
}
