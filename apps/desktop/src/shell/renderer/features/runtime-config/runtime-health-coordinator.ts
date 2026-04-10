import { useEffect, useSyncExternalStore } from 'react';
import type {
  AIProviderHealthEvent,
  AIProviderHealthSnapshot,
  GetRuntimeHealthResponse,
  RuntimeHealthEvent,
  RuntimeStreamCallOptions,
} from '@nimiplatform/sdk/runtime';
import { getPlatformClient } from '@nimiplatform/sdk';

const HEALTH_STALE_MS = 60_000;
const HEALTH_WATCHDOG_INTERVAL_MS = 60_000;

const HEALTH_METADATA = {
  callerKind: 'desktop-core' as const,
  callerId: 'runtime-health-coordinator',
  surfaceId: 'runtime.health',
};

const HEALTH_CALL_OPTIONS = {
  timeoutMs: 5000,
  metadata: HEALTH_METADATA,
};

const HEALTH_STREAM_OPTIONS: RuntimeStreamCallOptions = {
  metadata: HEALTH_METADATA,
};

type RuntimeHealthCoordinatorDeps = {
  fetchRuntimeHealth: () => Promise<GetRuntimeHealthResponse>;
  fetchProviderHealth: () => Promise<{ providers: AIProviderHealthSnapshot[] }>;
  subscribeRuntimeHealth: () => Promise<AsyncIterable<RuntimeHealthEvent>>;
  subscribeProviderHealth: () => Promise<AsyncIterable<AIProviderHealthEvent>>;
  subscribeRuntimeConnected: (listener: () => void) => () => void;
  subscribeRuntimeDisconnected: (listener: () => void) => () => void;
  now: () => number;
  setInterval: (callback: () => void, intervalMs: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

function runtimeAdmin() {
  return getPlatformClient().domains.runtimeAdmin;
}

export type RuntimeHealthCoordinatorState = {
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
};

function buildDefaultState(): RuntimeHealthCoordinatorState {
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

function computeStale(state: RuntimeHealthCoordinatorState, now: number): boolean {
  const lastActivity = state.lastStreamAt || state.lastFetchedAt;
  if (!state.streamConnected) {
    return true;
  }
  if (!lastActivity) {
    return true;
  }
  const lastActivityMs = new Date(lastActivity).getTime();
  if (Number.isNaN(lastActivityMs)) {
    return true;
  }
  return now - lastActivityMs > HEALTH_STALE_MS;
}

export class RuntimeHealthCoordinator {
  private readonly deps: RuntimeHealthCoordinatorDeps;

  private readonly listeners = new Set<() => void>();

  private state: RuntimeHealthCoordinatorState = buildDefaultState();

  private startRefs = 0;

  private refreshPromise: Promise<RuntimeHealthCoordinatorState> | null = null;

  private watchdogHandle: unknown = null;

  private streamGeneration = 0;

  private waitForRuntimeReconnect = false;

  private runtimeEventUnsubscribers: Array<() => void> = [];

  constructor(deps?: Partial<RuntimeHealthCoordinatorDeps>) {
    this.deps = {
      fetchRuntimeHealth: async () => {
        return runtimeAdmin().getRuntimeHealth({}, HEALTH_CALL_OPTIONS);
      },
      fetchProviderHealth: async () => {
        return runtimeAdmin().listAIProviderHealth({}, HEALTH_CALL_OPTIONS);
      },
      subscribeRuntimeHealth: async () => {
        return runtimeAdmin().healthEvents({}, HEALTH_STREAM_OPTIONS);
      },
      subscribeProviderHealth: async () => {
        return runtimeAdmin().providerHealthEvents({}, HEALTH_STREAM_OPTIONS);
      },
      subscribeRuntimeConnected: (listener) => getPlatformClient().runtime.events.on('runtime.connected', listener),
      subscribeRuntimeDisconnected: (listener) => getPlatformClient().runtime.events.on('runtime.disconnected', listener),
      now: () => Date.now(),
      setInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
      clearInterval: (handle) => window.clearInterval(handle as number),
      ...deps,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): RuntimeHealthCoordinatorState => this.state;

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

  async forceRefresh(_reason = 'manual'): Promise<RuntimeHealthCoordinatorState> {
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
          providerHealth: [...providerHealth.providers].sort((left, right) => left.providerName.localeCompare(right.providerName)),
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
    if (this.state.stale) {
      await this.forceRefresh('watchdog').catch(() => undefined);
    }
  }

  private restartStreams(): void {
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
        if (!this.isCurrentGeneration(generation)) {
          return;
        }
        this.updateState((current) => ({
          ...current,
          healthStreamConnected: true,
          streamError: null,
        }));
        for await (const event of stream) {
          if (!this.isCurrentGeneration(generation)) {
            break;
          }
          this.updateState((current) => ({
            ...current,
            runtimeHealth: mapRuntimeHealthEventToSnapshot(event),
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
        if (!this.isCurrentGeneration(generation)) {
          return;
        }
        this.updateState((current) => ({
          ...current,
          providerStreamConnected: true,
          streamError: null,
        }));
        for await (const event of stream) {
          if (!this.isCurrentGeneration(generation)) {
            break;
          }
          const nextSnapshot = mapProviderHealthEventToSnapshot(event);
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

  private updateState(
    nextState:
      | RuntimeHealthCoordinatorState
      | ((current: RuntimeHealthCoordinatorState) => RuntimeHealthCoordinatorState),
  ): void {
    const candidate = typeof nextState === 'function'
      ? nextState(this.state)
      : nextState;
    const computed: RuntimeHealthCoordinatorState = {
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

const runtimeHealthCoordinator = new RuntimeHealthCoordinator();

export function getRuntimeHealthCoordinator(): RuntimeHealthCoordinator {
  return runtimeHealthCoordinator;
}

export function useRuntimeHealthCoordinatorBootstrap(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const coordinator = getRuntimeHealthCoordinator();
    coordinator.start();
    return () => {
      coordinator.stop();
    };
  }, [enabled]);
}

export function useRuntimeHealthCoordinatorState(): RuntimeHealthCoordinatorState {
  const coordinator = getRuntimeHealthCoordinator();
  return useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );
}
