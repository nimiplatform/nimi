import type { AgentDataBundle } from '../driver/types.js';
import type { EmbodimentProjectionApi } from './embodiment-projection-api.js';
import type { HandlerRegistry } from './handler-registry.js';

export type ContinuousUpdateStatus = 'success' | 'error' | 'async_contract_violation' | 'over_budget' | 'skipped_reentrant';

export type ContinuousUpdateResult = {
  id: string;
  status: ContinuousUpdateStatus;
  elapsedMs: number;
  error: string | null;
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

export class ContinuousScheduler {
  private timerId: number | null = null;
  private readonly lastRun = new Map<string, number>();
  private readonly running = new Set<string>();
  private readonly skipUntil = new Map<string, number>();
  private readonly results: ContinuousUpdateResult[] = [];

  constructor(
    private readonly registry: HandlerRegistry,
    private readonly getBundle: () => AgentDataBundle | null,
    private readonly projection: EmbodimentProjectionApi,
  ) {}

  start(): void {
    if (this.timerId !== null) return;
    const tick = () => {
      this.tick(performance.now());
      this.timerId = requestAnimationFrame(tick);
    };
    this.timerId = requestAnimationFrame(tick);
  }

  tick(now = performance.now()): ContinuousUpdateResult[] {
    const before = this.results.length;
    const bundle = this.getBundle();
    if (!bundle) return [];
    const keys = Array.from(this.registry.continuous.keys()).sort();
    for (const key of keys) {
      const entry = this.registry.continuous.get(key);
      if (!entry || entry.handler.enabled === false) continue;
      const interval = 1000 / entry.fps;
      const prev = this.lastRun.get(key) ?? 0;
      if (now - prev < interval) continue;
      if (now < (this.skipUntil.get(key) ?? 0)) continue;
      if (this.running.has(key)) {
        this.record({
          id: key,
          status: 'skipped_reentrant',
          elapsedMs: 0,
          error: 'previous continuous update is still running',
        });
        this.skipUntil.set(key, now + interval);
        continue;
      }
      this.lastRun.set(key, now);
      this.runUpdate(key, entry.fps, bundle);
    }
    return this.results.slice(before);
  }

  stop(): void {
    if (this.timerId !== null) {
      cancelAnimationFrame(this.timerId);
      this.timerId = null;
    }
    this.lastRun.clear();
    this.running.clear();
    this.skipUntil.clear();
  }

  getResults(): ContinuousUpdateResult[] {
    return [...this.results];
  }

  private runUpdate(key: string, fps: number, bundle: AgentDataBundle): void {
    const entry = this.registry.continuous.get(key);
    if (!entry) return;
    const started = performance.now();
    let keepRunningUntilAsyncSettles = false;
    this.running.add(key);
    try {
      const returned = entry.handler.update(bundle, this.projection);
      const elapsedMs = performance.now() - started;
      if (isPromiseLike(returned)) {
        const error = 'NAS continuous update must be synchronous and must not return a Promise';
        this.record({ id: key, status: 'async_contract_violation', elapsedMs, error });
        console.warn(`[nas:continuous] ${key} ${error}`);
        keepRunningUntilAsyncSettles = true;
        void Promise.resolve(returned).catch((err: unknown) => {
          console.warn(`[nas:continuous] ${key} async update rejected after contract violation: ${err instanceof Error ? err.message : String(err)}`);
        }).finally(() => {
          this.running.delete(key);
        });
        return;
      }
      const budgetMs = Math.max(1, (1000 / fps) * 0.5);
      if (elapsedMs > budgetMs) {
        const error = `continuous update exceeded frame budget: ${elapsedMs.toFixed(2)}ms > ${budgetMs.toFixed(2)}ms`;
        this.skipUntil.set(key, performance.now() + (1000 / fps));
        this.record({ id: key, status: 'over_budget', elapsedMs, error });
        console.warn(`[nas:continuous] ${key} ${error}`);
        return;
      }
      this.record({ id: key, status: 'success', elapsedMs, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.record({ id: key, status: 'error', elapsedMs: performance.now() - started, error: message });
      console.warn(`[nas:continuous] ${key} threw: ${message}`);
    } finally {
      if (!keepRunningUntilAsyncSettles) {
        this.running.delete(key);
      }
    }
  }

  private record(result: ContinuousUpdateResult): void {
    this.results.push(result);
    if (this.results.length > 200) {
      this.results.splice(0, this.results.length - 200);
    }
  }
}
