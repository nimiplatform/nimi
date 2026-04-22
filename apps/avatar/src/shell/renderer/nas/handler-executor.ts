import type { AgentDataBundle } from '../driver/types.js';
import type { EmbodimentProjectionApi } from './embodiment-projection-api.js';
import type { ActivityOrEventHandler } from './handler-types.js';

export class HandlerExecutor {
  private readonly inFlight = new Map<string, AbortController>();

  async run(
    key: string,
    handler: ActivityOrEventHandler,
    ctx: AgentDataBundle,
    projection: EmbodimentProjectionApi,
  ): Promise<void> {
    const prev = this.inFlight.get(key);
    if (prev) {
      prev.abort();
    }
    const controller = new AbortController();
    this.inFlight.set(key, controller);
    try {
      await handler.execute(ctx, projection, { signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      console.error(`[nas] handler ${key} threw: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (this.inFlight.get(key) === controller) {
        this.inFlight.delete(key);
      }
    }
  }

  cancel(key: string): void {
    const existing = this.inFlight.get(key);
    if (existing) {
      existing.abort();
      this.inFlight.delete(key);
    }
  }

  cancelAll(): void {
    for (const controller of this.inFlight.values()) {
      controller.abort();
    }
    this.inFlight.clear();
  }
}
