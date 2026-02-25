import type { TurnHookPoint, TurnHookResult } from '../contracts/types.js';
import { HookRegistry } from '../registry/hook-registry.js';

const DEFAULT_HOOK_TIMEOUT_MS = 10_000;

export class TurnHookOrchestrator {
  private defaultTimeoutMs: number = DEFAULT_HOOK_TIMEOUT_MS;

  constructor(private readonly registry: HookRegistry) {}

  setDefaultTimeout(ms: number): void {
    this.defaultTimeoutMs = ms;
  }

  async invoke(
    point: TurnHookPoint,
    context: Record<string, unknown>,
    options?: { abortSignal?: AbortSignal },
  ): Promise<TurnHookResult> {
    const hooks = this.registry.listTurnHooks(point);
    let current = { ...context };
    const errors: TurnHookResult['errors'] = [];
    let aborted = false;

    for (const item of hooks) {
      if (options?.abortSignal?.aborted) {
        aborted = true;
        break;
      }

      try {
        const resolved = await this.invokeWithTimeout(
          () => item.handler(current),
          this.defaultTimeoutMs,
        );
        if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
          current = resolved;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ modId: item.modId, point, error: message });
        // Continue with next hook - error isolation
      }
    }

    return { context: current, errors, aborted };
  }

  private invokeWithTimeout(
    fn: () => Promise<Record<string, unknown>> | Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('HOOK_TURN_HANDLER_TIMEOUT'));
      }, timeoutMs);

      Promise.resolve(fn())
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
