export type OfflineTier = 'L0' | 'L1' | 'L2';

export type OfflineTierChangeReason =
  | 'realm_offline'
  | 'realm_reconnect'
  | 'runtime_offline'
  | 'runtime_reconnect';

export type OfflineTierChange = {
  from: OfflineTier;
  to: OfflineTier;
  timestamp: number;
  reason: OfflineTierChangeReason;
};

export type ConnectivityStatus = {
  realm: {
    restReachable: boolean;
    socketReachable: boolean;
    lastRestCheckedAt: number;
    lastSocketCheckedAt: number;
  };
  runtime: { reachable: boolean; lastCheckedAt: number };
};

export const OFFLINE_RECONNECT_INITIAL_DELAY_MS = 1000;
export const OFFLINE_RECONNECT_MAX_DELAY_MS = 30_000;

type ConnectivityListener = (status: ConnectivityStatus) => void;
type TierChangeListener = (change: OfflineTierChange) => void;
type RuntimeReconnectListener = () => Promise<void> | void;
type RealmReconnectListener = () => Promise<void> | void;
type OfflineTimerHandle = unknown;

export type OfflineCoordinatorReconnectHandlers = {
  probeRealmReachability?: () => Promise<boolean>;
  probeRealmSocketReachability?: () => Promise<boolean>;
  probeRuntimeReachability?: () => Promise<boolean>;
  recoverRuntimeReachability?: () => Promise<void>;
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

export class ConnectivityMonitor {
  private realmRestReachable = true;
  private realmSocketReachable = true;
  private runtimeReachable = true;
  private realmRestLastCheckedAt = Date.now();
  private realmSocketLastCheckedAt = Date.now();
  private runtimeLastCheckedAt = Date.now();
  private readonly listeners = new Set<ConnectivityListener>();

  setRealmSocketConnected(connected: boolean): void {
    this.realmSocketReachable = connected;
    this.realmSocketLastCheckedAt = Date.now();
    this.emit();
  }

  setRealmRestReachable(reachable: boolean): void {
    this.realmRestReachable = reachable;
    this.realmRestLastCheckedAt = Date.now();
    this.emit();
  }

  setRuntimeReachable(reachable: boolean): void {
    this.runtimeReachable = reachable;
    this.runtimeLastCheckedAt = Date.now();
    this.emit();
  }

  getStatus(): ConnectivityStatus {
    return {
      realm: {
        restReachable: this.realmRestReachable,
        socketReachable: this.realmSocketReachable,
        lastRestCheckedAt: this.realmRestLastCheckedAt,
        lastSocketCheckedAt: this.realmSocketLastCheckedAt,
      },
      runtime: { reachable: this.runtimeReachable, lastCheckedAt: this.runtimeLastCheckedAt },
    };
  }

  onChange(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch {
        // Listener failures must not corrupt the shared connectivity projection.
      }
    }
  }
}

export class OfflineStateManager {
  private currentTier: OfflineTier = 'L0';
  private readonly listeners = new Set<TierChangeListener>();
  private unsubscribeMonitor: (() => void) | null = null;

  constructor(private readonly monitor: ConnectivityMonitor) {}

  start(): void {
    this.recalculateTier();
    this.unsubscribeMonitor = this.monitor.onChange(() => this.recalculateTier());
  }

  stop(): void {
    if (this.unsubscribeMonitor) {
      this.unsubscribeMonitor();
      this.unsubscribeMonitor = null;
    }
  }

  getCurrentTier(): OfflineTier {
    return this.currentTier;
  }

  onChange(listener: TierChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private recalculateTier(): void {
    const { realm, runtime } = this.monitor.getStatus();
    const nextTier: OfflineTier = !runtime.reachable
      ? 'L2'
      : !realm.restReachable
        ? 'L1'
        : 'L0';

    if (nextTier === this.currentTier) return;

    const previousTier = this.currentTier;
    this.currentTier = nextTier;

    const change: OfflineTierChange = {
      from: previousTier,
      to: nextTier,
      timestamp: Date.now(),
      reason: this.inferReason(previousTier, nextTier),
    };

    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch {
        // Listener failures must not corrupt the shared tier projection.
      }
    }
  }

  private inferReason(from: OfflineTier, to: OfflineTier): OfflineTierChangeReason {
    if (to === 'L2') return 'runtime_offline';
    if (from === 'L2') return 'runtime_reconnect';
    if (to === 'L1') return 'realm_offline';
    return 'realm_reconnect';
  }
}

export class OfflineCoordinator {
  private readonly monitor: ConnectivityMonitor;
  private readonly stateManager: OfflineStateManager;
  private readonly timer: OfflineCoordinatorTimer;
  private readonly tierListeners = new Set<TierChangeListener>();
  private readonly runtimeReconnectListeners = new Set<RuntimeReconnectListener>();
  private readonly realmReconnectListeners = new Set<RealmReconnectListener>();
  private readonly statusListeners = new Set<ConnectivityListener>();
  private started = false;
  private realmReconnectTimer: OfflineTimerHandle | null = null;
  private runtimeReconnectTimer: OfflineTimerHandle | null = null;
  private realmReconnectDelayMs = OFFLINE_RECONNECT_INITIAL_DELAY_MS;
  private runtimeReconnectDelayMs = OFFLINE_RECONNECT_INITIAL_DELAY_MS;
  private reconnectHandlers: OfflineCoordinatorReconnectHandlers = {};
  private cacheFallbackActive = false;

  constructor(input: { timer?: OfflineCoordinatorTimer } = {}) {
    this.monitor = new ConnectivityMonitor();
    this.stateManager = new OfflineStateManager(this.monitor);
    this.timer = input.timer || defaultOfflineCoordinatorTimer;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.monitor.onChange((status) => {
      for (const listener of this.statusListeners) {
        try {
          listener(status);
        } catch {
          // Listener failures must not corrupt the shared status projection.
        }
      }
    });
    this.stateManager.onChange((change) => {
      for (const listener of this.tierListeners) {
        try {
          listener(change);
        } catch {
          // Listener failures must not corrupt the shared tier projection.
        }
      }
      if (change.reason === 'realm_offline') {
        void this.scheduleRealmReconnect();
      }
      if (change.reason === 'realm_reconnect') {
        this.cacheFallbackActive = false;
        this.clearRealmReconnectTimer();
        this.realmReconnectDelayMs = OFFLINE_RECONNECT_INITIAL_DELAY_MS;
        void this.emitRealmReconnect();
      }
      if (change.reason === 'runtime_offline') {
        void this.scheduleRuntimeReconnect();
      }
      if (change.reason === 'runtime_reconnect') {
        this.clearRuntimeReconnectTimer();
        this.runtimeReconnectDelayMs = OFFLINE_RECONNECT_INITIAL_DELAY_MS;
        void this.emitRuntimeReconnect();
      }
    });
    this.stateManager.start();
  }

  configureReconnectHandlers(input: OfflineCoordinatorReconnectHandlers): void {
    this.reconnectHandlers = input;
  }

  markCacheFallbackUsed(): void {
    this.cacheFallbackActive = true;
    this.markRealmRestReachable(false);
  }

  markRuntimeReachable(reachable: boolean): void {
    this.start();
    this.monitor.setRuntimeReachable(reachable);
  }

  markRealmSocketReachable(reachable: boolean): void {
    this.start();
    const wasReachable = this.monitor.getStatus().realm.socketReachable;
    this.monitor.setRealmSocketConnected(reachable);
    if (!reachable && !wasReachable) {
      void this.scheduleRealmReconnect();
    }
  }

  markRealmRestReachable(reachable: boolean): void {
    this.start();
    const wasReachable = this.monitor.getStatus().realm.restReachable;
    this.monitor.setRealmRestReachable(reachable);
    if (!reachable && !wasReachable) {
      void this.scheduleRealmReconnect();
    }
    if (reachable) {
      this.cacheFallbackActive = false;
      this.clearRealmReconnectTimer();
      this.realmReconnectDelayMs = OFFLINE_RECONNECT_INITIAL_DELAY_MS;
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

  subscribeTier(listener: TierChangeListener): () => void {
    this.start();
    this.tierListeners.add(listener);
    return () => this.tierListeners.delete(listener);
  }

  subscribeStatus(listener: ConnectivityListener): () => void {
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
    if (!this.getStatus().realm.restReachable) {
      return true;
    }
    if (this.cacheFallbackActive) {
      return true;
    }
    if (!this.getStatus().realm.socketReachable) {
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
    const status = this.getStatus();
    const restProbe = this.reconnectHandlers.probeRealmReachability;
    const socketProbe = this.reconnectHandlers.probeRealmSocketReachability;
    if (!restProbe && !socketProbe) {
      return;
    }
    try {
      const restReachable = status.realm.restReachable || (restProbe ? await restProbe() : false);
      if (restReachable && !status.realm.restReachable) {
        this.markRealmRestReachable(true);
      }

      const nextStatus = this.getStatus();
      const socketReachable = nextStatus.realm.socketReachable || (socketProbe ? await socketProbe() : false);
      if (socketReachable && !nextStatus.realm.socketReachable) {
        this.markRealmSocketReachable(true);
      }

      const finalStatus = this.getStatus();
      if (finalStatus.realm.restReachable && finalStatus.realm.socketReachable) {
        return;
      }
    } catch {
      // Keep offline until a probe succeeds.
    }
    this.realmReconnectDelayMs = Math.min(
      this.realmReconnectDelayMs * 2,
      OFFLINE_RECONNECT_MAX_DELAY_MS,
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
        const recover = this.reconnectHandlers.recoverRuntimeReachability;
        if (recover) {
          await recover();
        }
        this.markRuntimeReachable(true);
        return;
      }
    } catch {
      // Keep offline until a probe succeeds.
    }
    this.runtimeReconnectDelayMs = Math.min(
      this.runtimeReconnectDelayMs * 2,
      OFFLINE_RECONNECT_MAX_DELAY_MS,
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
        // Reconnect listener failures must stay app-local.
      }
    }
  }

  private async emitRealmReconnect(): Promise<void> {
    for (const listener of this.realmReconnectListeners) {
      try {
        await listener();
      } catch {
        // Reconnect listener failures must stay app-local.
      }
    }
  }
}
