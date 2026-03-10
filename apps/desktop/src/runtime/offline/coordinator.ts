import {
  RECONNECT_INITIAL_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  type ConnectivityStatus,
  type OfflineTier,
  type OfflineTierChange,
} from './types.js';
import { ConnectivityMonitor } from './connectivity-monitor.js';
import { OfflineStateManager } from './offline-state-manager.js';

type TierListener = (change: OfflineTierChange) => void;
type RuntimeReconnectListener = () => Promise<void> | void;
type RealmReconnectListener = () => Promise<void> | void;
type OfflineTimerHandle = unknown;

type OfflineReconnectHandlers = {
  probeRealmReachability?: () => Promise<boolean>;
  probeRuntimeReachability?: () => Promise<boolean>;
  hasPendingRealmRecoveryWork?: () => Promise<boolean>;
};

export type OfflineCoordinatorTimer = {
  setTimeout: (callback: () => void, delayMs: number) => OfflineTimerHandle;
  clearTimeout: (handle: OfflineTimerHandle) => void;
};

const defaultOfflineCoordinatorTimer: OfflineCoordinatorTimer = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class OfflineCoordinator {
  private readonly monitor: ConnectivityMonitor;
  private readonly stateManager: OfflineStateManager;
  private readonly timer: OfflineCoordinatorTimer;
  private readonly tierListeners = new Set<TierListener>();
  private readonly runtimeReconnectListeners = new Set<RuntimeReconnectListener>();
  private readonly realmReconnectListeners = new Set<RealmReconnectListener>();
  private readonly statusListeners = new Set<(status: ConnectivityStatus) => void>();
  private started = false;
  private realmReconnectTimer: OfflineTimerHandle | null = null;
  private runtimeReconnectTimer: OfflineTimerHandle | null = null;
  private realmReconnectDelayMs = RECONNECT_INITIAL_DELAY_MS;
  private runtimeReconnectDelayMs = RECONNECT_INITIAL_DELAY_MS;
  private reconnectHandlers: OfflineReconnectHandlers = {};
  private cacheFallbackActive = false;

  constructor(input: { timer?: OfflineCoordinatorTimer } = {}) {
    this.monitor = new ConnectivityMonitor();
    this.stateManager = new OfflineStateManager(this.monitor);
    this.timer = input.timer || defaultOfflineCoordinatorTimer;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.monitor.onChange((status) => {
      for (const listener of this.statusListeners) {
        try {
          listener(status);
        } catch {
          // swallow listener errors
        }
      }
    });
    this.stateManager.onChange((change) => {
      for (const listener of this.tierListeners) {
        try {
          listener(change);
        } catch {
          // swallow listener errors
        }
      }
      if (change.reason === 'realm_offline') {
        void this.scheduleRealmReconnect();
      }
      if (change.reason === 'realm_reconnect') {
        this.cacheFallbackActive = false;
        this.clearRealmReconnectTimer();
        this.realmReconnectDelayMs = RECONNECT_INITIAL_DELAY_MS;
        void this.emitRealmReconnect();
      }
      if (change.reason === 'runtime_offline') {
        void this.scheduleRuntimeReconnect();
      }
      if (change.reason === 'runtime_reconnect') {
        this.clearRuntimeReconnectTimer();
        this.runtimeReconnectDelayMs = RECONNECT_INITIAL_DELAY_MS;
        void this.emitRuntimeReconnect();
      }
    });
    this.stateManager.start();
  }

  configureReconnectHandlers(input: OfflineReconnectHandlers): void {
    this.reconnectHandlers = input;
  }

  markCacheFallbackUsed(): void {
    this.cacheFallbackActive = true;
    if (this.getTier() === 'L1') {
      void this.scheduleRealmReconnect();
    }
  }

  markRuntimeReachable(reachable: boolean): void {
    this.start();
    this.monitor.setRuntimeReachable(reachable);
  }

  markRealmSocketReachable(reachable: boolean): void {
    this.start();
    this.monitor.setRealmSocketConnected(reachable);
  }

  markRealmRestReachable(reachable: boolean): void {
    this.start();
    this.monitor.setRealmRestReachable(reachable);
    if (!reachable) {
      void this.scheduleRealmReconnect();
    }
  }

  getTier(): OfflineTier {
    this.start();
    return this.stateManager.getCurrentTier();
  }

  getStatus(): ConnectivityStatus {
    this.start();
    return this.monitor.getStatus();
  }

  subscribeTier(listener: TierListener): () => void {
    this.start();
    this.tierListeners.add(listener);
    return () => this.tierListeners.delete(listener);
  }

  subscribeStatus(listener: (status: ConnectivityStatus) => void): () => void {
    this.start();
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  subscribeRuntimeReconnect(listener: RuntimeReconnectListener): () => void {
    this.start();
    this.runtimeReconnectListeners.add(listener);
    return () => this.runtimeReconnectListeners.delete(listener);
  }

  subscribeRealmReconnect(listener: RealmReconnectListener): () => void {
    this.start();
    this.realmReconnectListeners.add(listener);
    return () => this.realmReconnectListeners.delete(listener);
  }

  private async shouldReconnectRealm(): Promise<boolean> {
    if (this.getTier() !== 'L1') {
      return false;
    }
    if (this.cacheFallbackActive) {
      return true;
    }
    const probe = this.reconnectHandlers.hasPendingRealmRecoveryWork;
    if (!probe) {
      return true;
    }
    try {
      return await probe();
    } catch {
      return true;
    }
  }

  private async scheduleRealmReconnect(): Promise<void> {
    if (this.realmReconnectTimer) {
      return;
    }
    if (!await this.shouldReconnectRealm()) {
      return;
    }
    this.realmReconnectTimer = this.timer.setTimeout(() => {
      this.realmReconnectTimer = null;
      void this.tryRealmReconnect();
    }, this.realmReconnectDelayMs);
  }

  private async tryRealmReconnect(): Promise<void> {
    const probe = this.reconnectHandlers.probeRealmReachability;
    if (!probe) {
      return;
    }
    try {
      const reachable = await probe();
      if (reachable) {
        this.markRealmRestReachable(true);
        this.markRealmSocketReachable(true);
        return;
      }
    } catch {
      // keep offline until a probe succeeds
    }
    this.realmReconnectDelayMs = Math.min(
      this.realmReconnectDelayMs * 2,
      RECONNECT_MAX_DELAY_MS,
    );
    void this.scheduleRealmReconnect();
  }

  private async scheduleRuntimeReconnect(): Promise<void> {
    if (this.runtimeReconnectTimer || this.getStatus().runtime.reachable) {
      return;
    }
    this.runtimeReconnectTimer = this.timer.setTimeout(() => {
      this.runtimeReconnectTimer = null;
      void this.tryRuntimeReconnect();
    }, this.runtimeReconnectDelayMs);
  }

  private async tryRuntimeReconnect(): Promise<void> {
    const probe = this.reconnectHandlers.probeRuntimeReachability;
    if (!probe) {
      return;
    }
    try {
      const reachable = await probe();
      if (reachable) {
        this.markRuntimeReachable(true);
        return;
      }
    } catch {
      // keep offline until a probe succeeds
    }
    this.runtimeReconnectDelayMs = Math.min(
      this.runtimeReconnectDelayMs * 2,
      RECONNECT_MAX_DELAY_MS,
    );
    void this.scheduleRuntimeReconnect();
  }

  private clearRealmReconnectTimer(): void {
    if (this.realmReconnectTimer) {
      this.timer.clearTimeout(this.realmReconnectTimer);
      this.realmReconnectTimer = null;
    }
  }

  private clearRuntimeReconnectTimer(): void {
    if (this.runtimeReconnectTimer) {
      this.timer.clearTimeout(this.runtimeReconnectTimer);
      this.runtimeReconnectTimer = null;
    }
  }

  private async emitRuntimeReconnect(): Promise<void> {
    for (const listener of this.runtimeReconnectListeners) {
      try {
        await listener();
      } catch {
        // swallow listener errors
      }
    }
  }

  private async emitRealmReconnect(): Promise<void> {
    for (const listener of this.realmReconnectListeners) {
      try {
        await listener();
      } catch {
        // swallow listener errors
      }
    }
  }
}

let offlineCoordinator: OfflineCoordinator | null = null;

export function getOfflineCoordinator(): OfflineCoordinator {
  if (!offlineCoordinator) {
    offlineCoordinator = new OfflineCoordinator();
  }
  offlineCoordinator.start();
  return offlineCoordinator;
}
