import type { AgentDataBundle, AgentDataDriver, AgentEvent } from '../driver/types.js';
import type { Live2DPluginApi } from '../live2d/plugin-api.js';
import { createDefaultActivityHandler } from './default-fallback.js';
import { HandlerExecutor } from './handler-executor.js';
import type { HandlerRegistry } from './handler-registry.js';

export type DispatchContext = {
  driver: AgentDataDriver;
  registry: HandlerRegistry;
  executor: HandlerExecutor;
  live2d: Live2DPluginApi;
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

export function wireEventDispatch(context: DispatchContext): () => void {
  const { driver, registry, executor, live2d } = context;
  const defaultActivity = createDefaultActivityHandler();

  const unsubscribe = driver.onEvent((event) => {
    if (event.name === 'apml.state.activity') {
      const activityName = typeof event.detail['activity_name'] === 'string' ? event.detail['activity_name'] : null;
      if (!activityName) return;
      const ctx = bundleForEvent(driver.getBundle(), event);
      const entry = registry.activity.get(activityName);
      const handler = entry?.handler ?? defaultActivity;
      const key = `activity:${activityName}`;
      void executor.run(key, handler, ctx, live2d);
      return;
    }

    const entry = registry.event.get(event.name);
    if (!entry) return;
    const ctx = bundleForEvent(driver.getBundle(), event);
    const key = `event:${event.name}`;
    void executor.run(key, entry.handler, ctx, live2d);
  });

  return unsubscribe;
}

export class ContinuousScheduler {
  private timerId: number | null = null;
  private readonly lastRun = new Map<string, number>();

  constructor(
    private readonly registry: HandlerRegistry,
    private readonly getBundle: () => AgentDataBundle | null,
    private readonly live2d: Live2DPluginApi,
  ) {}

  start(): void {
    if (this.timerId !== null) return;
    const tick = () => {
      const bundle = this.getBundle();
      if (bundle) {
        const now = performance.now();
        const keys = Array.from(this.registry.continuous.keys()).sort();
        for (const key of keys) {
          const entry = this.registry.continuous.get(key);
          if (!entry) continue;
          const interval = 1000 / entry.fps;
          const prev = this.lastRun.get(key) ?? 0;
          if (now - prev < interval) continue;
          this.lastRun.set(key, now);
          try {
            entry.handler.update(bundle, this.live2d);
          } catch (err) {
            console.warn(`[nas:continuous] ${key} threw: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      this.timerId = requestAnimationFrame(tick);
    };
    this.timerId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.timerId !== null) {
      cancelAnimationFrame(this.timerId);
      this.timerId = null;
    }
    this.lastRun.clear();
  }
}
