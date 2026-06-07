import type {
  AIProviderHealthEvent,
  AIProviderHealthSnapshot,
  GetRuntimeHealthResponse,
  RuntimeHealthEvent,
} from '../core-generated/runtime-typed-client';
import { RuntimeHealthStatus } from '../core-generated/runtime-typed-client';
import { toNimiRuntimeIsoFromTimestamp } from './runtime-agent-values';

const HEALTH_STALE_MS = 60_000;
const HEALTH_WATCHDOG_INTERVAL_MS = 60_000;

export interface NimiRuntimeHealthCoordinatorDeps {
  fetchRuntimeHealth(): Promise<GetRuntimeHealthResponse>;
  fetchProviderHealth(): Promise<{ providers: AIProviderHealthSnapshot[] }>;
  subscribeRuntimeHealth(): Promise<AsyncIterable<RuntimeHealthEvent>>;
  subscribeProviderHealth(): Promise<AsyncIterable<AIProviderHealthEvent>>;
  subscribeRuntimeConnected(listener: () => void): () => void;
  subscribeRuntimeDisconnected(listener: () => void): () => void;
  now?: () => number;
  setInterval?: (callback: () => void, intervalMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

type ResolvedNimiRuntimeHealthCoordinatorDeps =
  Required<NimiRuntimeHealthCoordinatorDeps>;

export interface NimiRuntimeHealthCoordinatorState {
  runtimeHealth: GetRuntimeHealthResponse | null;
  providerHealth: AIProviderHealthSnapshot[];
  streamConnected: boolean;
  healthStreamConnected: boolean;
  providerStreamConnected: boolean;
  lastFetchedAt: string | null;
  lastStreamAt: string | null;
  stale: boolean;
  refreshing: boolean;
  error: string | null;
  streamError: string | null;
  started: boolean;
}

export type NimiRuntimeHealthProjectionStatus = 'healthy' | 'degraded' | 'unreachable' | 'idle';

export type NimiRuntimeHealthStatusName = 'STOPPED' | 'STARTING' | 'READY' | 'DEGRADED' | 'STOPPING';

export interface NimiRuntimeHealthProjection {
  health: {
    status: Exclude<NimiRuntimeHealthProjectionStatus, 'idle'>;
    detail: string;
    checkedAt: string;
  };
  normalizedStatus: NimiRuntimeHealthProjectionStatus;
}

function buildDefaultState(): NimiRuntimeHealthCoordinatorState {
  return {
    runtimeHealth: null,
    providerHealth: [],
    streamConnected: false,
    healthStreamConnected: false,
    providerStreamConnected: false,
    lastFetchedAt: null,
    lastStreamAt: null,
    stale: true,
    refreshing: false,
    error: null,
    streamError: null,
    started: false,
  };
}

function toIsoString(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const next = error.message.trim();
    if (next) {
      return next;
    }
  }
  return fallback;
}

function timestampToIsoString(ts?: Parameters<typeof toNimiRuntimeIsoFromTimestamp>[0]): string {
  return toNimiRuntimeIsoFromTimestamp(ts) ?? new Date().toISOString();
}

export function projectNimiRuntimeHealthStatus(status: unknown): NimiRuntimeHealthProjectionStatus {
  if (status === RuntimeHealthStatus.READY) {
    return 'healthy';
  }
  if (status === RuntimeHealthStatus.DEGRADED) {
    return 'degraded';
  }
  if (status === RuntimeHealthStatus.STOPPED || status === RuntimeHealthStatus.STOPPING) {
    return 'unreachable';
  }
  return 'idle';
}

export function projectNimiRuntimeHealthStatusName(status: unknown): NimiRuntimeHealthStatusName | undefined {
  if (status === RuntimeHealthStatus.STOPPED) {
    return 'STOPPED';
  }
  if (status === RuntimeHealthStatus.STARTING) {
    return 'STARTING';
  }
  if (status === RuntimeHealthStatus.READY) {
    return 'READY';
  }
  if (status === RuntimeHealthStatus.DEGRADED) {
    return 'DEGRADED';
  }
  if (status === RuntimeHealthStatus.STOPPING) {
    return 'STOPPING';
  }
  return undefined;
}

export function projectNimiRuntimeHealthSummary(
  result: GetRuntimeHealthResponse,
): NimiRuntimeHealthProjection {
  const normalizedStatus = projectNimiRuntimeHealthStatus(result.status);
  return {
    health: {
      status: normalizedStatus === 'idle' ? 'healthy' : normalizedStatus,
      detail: String(result.reason || '').trim() || `runtime health ${normalizedStatus}`,
      checkedAt: timestampToIsoString(result.sampledAt),
    },
    normalizedStatus,
  };
}

function mapRuntimeHealthEventToSnapshot(event: RuntimeHealthEvent): GetRuntimeHealthResponse {
  return {
    status: event.status,
    reason: event.reason,
    queueDepth: event.queueDepth,
    activeWorkflows: event.activeWorkflows,
    activeInferenceJobs: event.activeInferenceJobs,
    cpuMilli: event.cpuMilli,
    memoryBytes: event.memoryBytes,
    vramBytes: event.vramBytes,
    sampledAt: event.sampledAt,
  };
}

function mapProviderHealthEventToSnapshot(event: AIProviderHealthEvent): AIProviderHealthSnapshot {
  return {
    providerName: event.providerName,
    state: event.state,
    reason: event.reason,
    consecutiveFailures: event.consecutiveFailures,
    lastChangedAt: event.lastChangedAt,
    lastCheckedAt: event.lastCheckedAt,
    subHealth: event.subHealth,
  };
}

function mergeProviderSnapshot(
  current: AIProviderHealthSnapshot[],
  next: AIProviderHealthSnapshot,
): AIProviderHealthSnapshot[] {
  const existing = current.findIndex((item) => item.providerName === next.providerName);
  if (existing < 0) {
    return [...current, next].sort((left, right) => left.providerName.localeCompare(right.providerName));
  }
  const merged = [...current];
  merged[existing] = next;
  return merged;
}

function computeStale(state: NimiRuntimeHealthCoordinatorState, now: number): boolean {
  if (!state.streamConnected) {
    return true;
  }
  const activityTimes = [state.lastStreamAt, state.lastFetchedAt]
    .map((value) => value ? new Date(value).getTime() : Number.NaN)
    .filter(Number.isFinite);
  if (activityTimes.length === 0) {
    return true;
  }
  const lastActivityMs = Math.max(...activityTimes);
  return now - lastActivityMs > HEALTH_STALE_MS;
}

function defaultSetInterval(callback: () => void, intervalMs: number): unknown {
  return globalThis.setInterval(callback, intervalMs);
}

function defaultClearInterval(handle: unknown): void {
  globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>);
}

export class NimiRuntimeHealthCoordinator {
  private readonly deps: ResolvedNimiRuntimeHealthCoordinatorDeps;

  private readonly listeners = new Set<() => void>();

  private state: NimiRuntimeHealthCoordinatorState = buildDefaultState();

  private startRefs = 0;

  private refreshPromise: Promise<NimiRuntimeHealthCoordinatorState> | null = null;

  private watchdogHandle: unknown = null;

  private streamGeneration = 0;

  private waitForRuntimeReconnect = false;

  private runtimeEventUnsubscribers: Array<() => void> = [];

  private streamCancellers: Array<() => void> = [];

  constructor(deps: NimiRuntimeHealthCoordinatorDeps) {
    this.deps = {
      ...deps,
      now: deps.now ?? (() => Date.now()),
      setInterval: deps.setInterval ?? defaultSetInterval,
      clearInterval: deps.clearInterval ?? defaultClearInterval,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): NimiRuntimeHealthCoordinatorState => this.state;

  start(): void {
    this.startRefs += 1;
    this.ensureStarted();
  }

  stop(): void {
    this.startRefs = Math.max(0, this.startRefs - 1);
    if (this.startRefs > 0) {
      return;
    }
    this.streamGeneration += 1;
    this.cancelStreams();
    if (this.watchdogHandle !== null) {
      this.deps.clearInterval(this.watchdogHandle);
      this.watchdogHandle = null;
    }
    for (const unsubscribe of this.runtimeEventUnsubscribers) {
      unsubscribe();
    }
    this.runtimeEventUnsubscribers = [];
    this.waitForRuntimeReconnect = false;
    this.updateState((current) => ({
      ...current,
      started: false,
      streamConnected: false,
      healthStreamConnected: false,
      providerStreamConnected: false,
      refreshing: false,
    }));
  }

  async forceRefresh(_reason = 'manual'): Promise<NimiRuntimeHealthCoordinatorState> {
    this.ensureStarted();
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.updateState((current) => ({
      ...current,
      refreshing: true,
      error: null,
    }));

    this.refreshPromise = (async () => {
      try {
        const [runtimeHealth, providerHealth] = await Promise.all([
          this.deps.fetchRuntimeHealth(),
          this.deps.fetchProviderHealth(),
        ]);
        const fetchedAt = toIsoString(this.deps.now());
        this.updateState((current) => ({
          ...current,
          runtimeHealth,
          providerHealth: [...providerHealth.providers]
            .sort((left, right) => left.providerName.localeCompare(right.providerName)),
          lastFetchedAt: fetchedAt,
          refreshing: false,
          error: null,
        }));
        return this.state;
      } catch (error) {
        this.updateState((current) => ({
          ...current,
          refreshing: false,
          error: toErrorMessage(error, 'runtime health unavailable'),
        }));
        throw error;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private ensureStarted(): void {
    if (this.state.started) {
      return;
    }
    this.runtimeEventUnsubscribers = [
      this.deps.subscribeRuntimeDisconnected(() => {
        this.handleRuntimeDisconnected();
      }),
      this.deps.subscribeRuntimeConnected(() => {
        void this.handleRuntimeConnected();
      }),
    ];
    this.updateState((current) => ({
      ...current,
      started: true,
    }));
    this.restartStreams();
    this.watchdogHandle = this.deps.setInterval(() => {
      void this.runWatchdog();
    }, HEALTH_WATCHDOG_INTERVAL_MS);
    void this.forceRefresh('startup').catch(() => undefined);
  }

  private async runWatchdog(): Promise<void> {
    if (!this.state.started) {
      return;
    }
    if (this.waitForRuntimeReconnect) {
      return;
    }
    if (!this.state.streamConnected) {
      this.restartStreams();
    }
    const stale = computeStale(this.state, this.deps.now());
    if (stale !== this.state.stale) {
      this.updateState((current) => ({
        ...current,
        stale,
      }));
    }
    if (stale) {
      await this.forceRefresh('watchdog').catch(() => undefined);
    }
  }

  private restartStreams(): void {
    this.cancelStreams();
    const generation = ++this.streamGeneration;
    this.updateState((current) => ({
      ...current,
      healthStreamConnected: false,
      providerStreamConnected: false,
      streamConnected: false,
    }));
    this.startRuntimeHealthStream(generation);
    this.startProviderHealthStream(generation);
  }

  private handleRuntimeDisconnected(): void {
    this.waitForRuntimeReconnect = true;
    this.streamGeneration += 1;
    this.cancelStreams();
    this.updateState((current) => ({
      ...current,
      streamConnected: false,
      healthStreamConnected: false,
      providerStreamConnected: false,
      streamError: null,
    }));
  }

  private async handleRuntimeConnected(): Promise<void> {
    this.waitForRuntimeReconnect = false;
    if (!this.state.started) {
      return;
    }
    this.restartStreams();
    await this.forceRefresh('runtime-connected').catch(() => undefined);
  }

  private startRuntimeHealthStream(generation: number): void {
    void this.deps.subscribeRuntimeHealth()
      .then(async (stream) => {
        const iterator = stream[Symbol.asyncIterator]();
        const untrack = this.trackStreamIterator(iterator);
        if (!this.isCurrentGeneration(generation)) {
          untrack();
          await Promise.resolve(iterator.return?.()).catch(() => undefined);
          return;
        }
        try {
          this.updateState((current) => ({
            ...current,
            healthStreamConnected: true,
            streamError: null,
          }));
          while (this.isCurrentGeneration(generation)) {
            const next = await iterator.next();
            if (next.done) {
              break;
            }
            this.updateState((current) => ({
              ...current,
              runtimeHealth: mapRuntimeHealthEventToSnapshot(next.value),
              lastStreamAt: toIsoString(this.deps.now()),
              healthStreamConnected: true,
              streamError: null,
            }));
          }
          if (this.isCurrentGeneration(generation)) {
            this.updateState((current) => ({
              ...current,
              healthStreamConnected: false,
            }));
          }
        } finally {
          untrack();
        }
      })
      .catch((error) => {
        if (!this.isCurrentGeneration(generation)) {
          return;
        }
        this.updateState((current) => ({
          ...current,
          healthStreamConnected: false,
          streamError: toErrorMessage(error, 'runtime health stream unavailable'),
        }));
      });
  }

  private startProviderHealthStream(generation: number): void {
    void this.deps.subscribeProviderHealth()
      .then(async (stream) => {
        const iterator = stream[Symbol.asyncIterator]();
        const untrack = this.trackStreamIterator(iterator);
        if (!this.isCurrentGeneration(generation)) {
          untrack();
          await Promise.resolve(iterator.return?.()).catch(() => undefined);
          return;
        }
        try {
          this.updateState((current) => ({
            ...current,
            providerStreamConnected: true,
            streamError: null,
          }));
          while (this.isCurrentGeneration(generation)) {
            const next = await iterator.next();
            if (next.done) {
              break;
            }
            const nextSnapshot = mapProviderHealthEventToSnapshot(next.value);
            this.updateState((current) => ({
              ...current,
              providerHealth: mergeProviderSnapshot(current.providerHealth, nextSnapshot),
              lastStreamAt: toIsoString(this.deps.now()),
              providerStreamConnected: true,
              streamError: null,
            }));
          }
          if (this.isCurrentGeneration(generation)) {
            this.updateState((current) => ({
              ...current,
              providerStreamConnected: false,
            }));
          }
        } finally {
          untrack();
        }
      })
      .catch((error) => {
        if (!this.isCurrentGeneration(generation)) {
          return;
        }
        this.updateState((current) => ({
          ...current,
          providerStreamConnected: false,
          streamError: toErrorMessage(error, 'provider health stream unavailable'),
        }));
      });
  }

  private isCurrentGeneration(generation: number): boolean {
    return this.state.started && this.streamGeneration === generation;
  }

  private trackStreamIterator(iterator: AsyncIterator<unknown>): () => void {
    let active = true;
    const cancel = () => {
      if (!active) {
        return;
      }
      active = false;
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
    };
    this.streamCancellers.push(cancel);
    return () => {
      active = false;
      const index = this.streamCancellers.indexOf(cancel);
      if (index >= 0) {
        this.streamCancellers.splice(index, 1);
      }
    };
  }

  private cancelStreams(): void {
    const cancellers = this.streamCancellers;
    this.streamCancellers = [];
    for (const cancel of cancellers) {
      cancel();
    }
  }

  private updateState(
    nextState:
      | NimiRuntimeHealthCoordinatorState
      | ((current: NimiRuntimeHealthCoordinatorState) => NimiRuntimeHealthCoordinatorState),
  ): void {
    const candidate = typeof nextState === 'function'
      ? nextState(this.state)
      : nextState;
    const computed: NimiRuntimeHealthCoordinatorState = {
      ...candidate,
      streamConnected: candidate.healthStreamConnected && candidate.providerStreamConnected,
    };
    computed.stale = computeStale(computed, this.deps.now());
    this.state = computed;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
