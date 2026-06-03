// Wave 1 (step 3) of topic 2026-04-30-avatar-vrm-backend-branch.
//
// HandlerExecutor — invokes activity / event handler modules under an
// AbortController. Wave_1 step_3 adds the `extension` slot
// (design-04 §"NAS handler signature hard-cut"): when the handler
// module declared `requires: ['live2d-extension']` AND the loaded
// backend kind is Live2D, the executor passes
// `{ extension: { live2d: Live2DBackendExtension } }` through the
// existing options bag. Handlers that did not declare the
// requirement never see the extension surface — the registry
// already rejects mismatched (VRM + live2d-extension) entries before
// they reach the executor.

import type { AgentDataBundle } from '../driver/types.js';
import type {
  EmbodimentProjectionApi,
} from '@nimiplatform/kit/features/avatar/headless';
import type { ActivityOrEventHandler, NasHandlerExtension } from './handler-types.js';

export type HandlerRunStatus = 'success' | 'error' | 'timeout' | 'cancelled' | 'shutdown';

export type HandlerRunResult = {
  key: string;
  status: HandlerRunStatus;
  error: string | null;
};

export type HandlerRunOptions = {
  /** Controls extension materialization: when `requiresLive2DExtension`
   *  is true AND `extension.live2d` is present, the executor passes a
   *  `{ live2d }` extension surface to the handler. Otherwise the
   *  handler receives no extension. */
  requiresLive2DExtension?: boolean;
  extension?: NasHandlerExtension;
};

export class HandlerExecutor {
  private readonly inFlight = new Map<string, AbortController>();
  private shuttingDown = false;

  async run(
    key: string,
    handler: ActivityOrEventHandler,
    ctx: AgentDataBundle,
    projection: EmbodimentProjectionApi,
    options: HandlerRunOptions = {},
  ): Promise<HandlerRunResult> {
    const prev = this.inFlight.get(key);
    if (prev) {
      prev.abort();
    }
    const controller = new AbortController();
    this.inFlight.set(key, controller);
    const extension = options.requiresLive2DExtension
      ? options.extension?.live2d
        ? ({ live2d: options.extension.live2d } satisfies NasHandlerExtension)
        : undefined
      : undefined;
    try {
      await handler.execute(ctx, projection, {
        signal: controller.signal,
        ...(extension ? { extension } : {}),
      });
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
