import type { AgentDataBundle } from '../driver/types.js';
import type { EmbodimentProjectionApi } from './embodiment-projection-api.js';
import type { ActivityOrEventHandler } from './handler-types.js';

export type HandlerRunStatus = 'success' | 'error' | 'timeout' | 'cancelled' | 'shutdown';

export type HandlerRunResult = {
  key: string;
  status: HandlerRunStatus;
  error: string | null;
};

export class HandlerExecutor {
  private readonly inFlight = new Map<string, AbortController>();
  private shuttingDown = false;

  async run(
    key: string,
    handler: ActivityOrEventHandler,
    ctx: AgentDataBundle,
    projection: EmbodimentProjectionApi,
  ): Promise<HandlerRunResult> {
    const prev = this.inFlight.get(key);
    if (prev) {
      prev.abort();
    }
    const controller = new AbortController();
    this.inFlight.set(key, controller);
    try {
      await handler.execute(ctx, projection, { signal: controller.signal });
      if (controller.signal.aborted) {
        return {
          key,
          status: this.shuttingDown ? 'shutdown' : 'cancelled',
          error: null,
        };
      }
      return { key, status: 'success', error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (controller.signal.aborted) {
        return {
          key,
          status: this.shuttingDown ? 'shutdown' : 'cancelled',
          error: message,
        };
      }
      const status: HandlerRunStatus = /\btimed out\b/i.test(message) ? 'timeout' : 'error';
      console.error(`[nas] handler ${key} ${status}: ${message}`);
      return { key, status, error: message };
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
    this.shuttingDown = true;
    for (const controller of this.inFlight.values()) {
      controller.abort();
    }
    this.inFlight.clear();
  }
}
