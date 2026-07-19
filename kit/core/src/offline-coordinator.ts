export type OfflineTier = 'L0' | 'L1' | 'L2';
export type ConnectivityReachability = 'unknown' | 'reachable' | 'unreachable';

export type OfflineTierChangeReason =
  | 'realm_offline'
  | 'realm_reconnect'
  | 'realm_unknown'
  | 'runtime_offline'
  | 'runtime_reconnect'
  | 'runtime_unknown';

export type OfflineTierChange = {
  from: OfflineTier;
  to: OfflineTier;
  timestamp: number;
  reason: OfflineTierChangeReason;
};

export type ConnectivityStatus = {
  realm: {
    rest: ConnectivityReachability;
    socket: ConnectivityReachability;
    lastRestCheckedAt: number;
    lastSocketCheckedAt: number;
  };
  runtime: { reachability: ConnectivityReachability; lastCheckedAt: number };
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
  setTimeout: (callback, delayMs) => {
    const handle = globalThis.setTimeout(callback, delayMs);
    // Reconnect probes are background recovery work. In Node-based shell tests
    // and native-host tooling they must not retain an otherwise completed
    // process; browser timer handles intentionally have no unref surface.
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class ConnectivityMonitor {
  private realmRestReachability: ConnectivityReachability = 'unknown';
  private realmSocketReachability: ConnectivityReachability = 'unknown';
  private runtimeReachability: ConnectivityReachability = 'unknown';
  private realmRestLastCheckedAt = Date.now();
  private realmSocketLastCheckedAt = Date.now();
  private runtimeLastCheckedAt = Date.now();
  private readonly listeners = new Set<ConnectivityListener>();

  setRealmSocketReachability(reachability: ConnectivityReachability): void {
    this.realmSocketReachability = reachability;
    this.realmSocketLastCheckedAt = Date.now();
    this.emit();
  }

  setRealmRestReachability(reachability: ConnectivityReachability): void {
    this.realmRestReachability = reachability;
    this.realmRestLastCheckedAt = Date.now();
    this.emit();
  }

  setRuntimeReachability(reachability: ConnectivityReachability): void {
    this.runtimeReachability = reachability;
    this.runtimeLastCheckedAt = Date.now();
    this.emit();
  }

  getStatus(): ConnectivityStatus {
    return {
      realm: {
        rest: this.realmRestReachability,
        socket: this.realmSocketReachability,
        lastRestCheckedAt: this.realmRestLastCheckedAt,
        lastSocketCheckedAt: this.realmSocketLastCheckedAt,
      },
      runtime: { reachability: this.runtimeReachability, lastCheckedAt: this.runtimeLastCheckedAt },
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
    const nextTier: OfflineTier = runtime.reachability === 'unreachable'
      ? 'L2'
      : realm.rest === 'unreachable'
        ? 'L1'
        : 'L0';

    if (nextTier === this.currentTier) return;

    const previousTier = this.currentTier;
    this.currentTier = nextTier;

    const change: OfflineTierChange = {
      from: previousTier,
      to: nextTier,
      timestamp: Date.now(),
      reason: this.inferReason(previousTier, nextTier, realm.rest, runtime.reachability),
    };

    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch {
        // Listener failures must not corrupt the shared tier projection.
      }
    }
  }

  private inferReason(
    from: OfflineTier,
    to: OfflineTier,
    realmReachability: ConnectivityReachability,
    runtimeReachability: ConnectivityReachability,
  ): OfflineTierChangeReason {
    if (to === 'L2') return 'runtime_offline';
    if (from === 'L2') {
      return runtimeReachability === 'reachable' ? 'runtime_reconnect' : 'runtime_unknown';
    }
    if (to === 'L1') return 'realm_offline';
    return realmReachability === 'reachable' ? 'realm_reconnect' : 'realm_unknown';
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
  private realmReconnectScheduleEpoch = 0;
  private realmReconnectSchedulePending = false;
  private realmReconnectScheduleRequested = false;
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
        if (this.getStatus().realm.socket !== 'unreachable') {
          this.clearRealmReconnectTimer();
          this.realmReconnectDelayMs = OFFLINE_RECONNECT_INITIAL_DELAY_MS;
        } else {
          void this.scheduleRealmReconnect();
        }
        void this.emitRealmReconnect();
      }
      if (change.reason === 'realm_unknown') {
        this.cacheFallbackActive = false;
        if (this.getStatus().realm.socket !== 'unreachable') {
          this.clearRealmReconnectTimer();
          this.realmReconnectDelayMs = OFFLINE_RECONNECT_INITIAL_DELAY_MS;
        } else {
          void this.scheduleRealmReconnect();
        }
      }
      if (change.reason === 'runtime_offline') {
        void this.scheduleRuntimeReconnect();
      }
      if (change.reason === 'runtime_reconnect') {
        this.clearRuntimeReconnectTimer();
        this.runtimeReconnectDelayMs = OFFLINE_RECONNECT_INITIAL_DELAY_MS;
        void this.emitRuntimeReconnect();
      }
      if (change.reason === 'runtime_unknown') {
        this.clearRuntimeReconnectTimer();
        this.runtimeReconnectDelayMs = OFFLINE_RECONNECT_INITIAL_DELAY_MS;
      }
    });
    this.stateManager.start();
  }

  configureReconnectHandlers(input: OfflineCoordinatorReconnectHandlers): void {
    this.reconnectHandlers = input;
  }

  markCacheFallbackUsed(): void {
    this.cacheFallbackActive = true;
    this.markRealmRestReachability('unreachable');
  }

  markRuntimeReachability(reachability: ConnectivityReachability): void {
    this.start();
    this.monitor.setRuntimeReachability(reachability);
    if (reachability === 'unknown') {
      this.clearRuntimeReconnectTimer();
      this.runtimeReconnectDelayMs = OFFLINE_RECONNECT_INITIAL_DELAY_MS;
    }
  }

  markRealmSocketReachability(reachability: ConnectivityReachability): void {
    this.start();
    const previous = this.monitor.getStatus().realm.socket;
    this.monitor.setRealmSocketReachability(reachability);
    if (reachability === 'unreachable') {
      void this.scheduleRealmReconnect();
      return;
    }
    if (this.monitor.getStatus().realm.rest !== 'unreachable') {
      this.clearRealmReconnectTimer();
      this.realmReconnectDelayMs = OFFLINE_RECONNECT_INITIAL_DELAY_MS;
      if (previous === 'unreachable' && reachability === 'reachable') {
        void this.emitRealmReconnect();
      }
    }
  }

  markRealmRestReachability(reachability: ConnectivityReachability): void {
    this.start();
    this.monitor.setRealmRestReachability(reachability);
    if (reachability !== 'unreachable') {
      this.cacheFallbackActive = false;
      if (this.monitor.getStatus().realm.socket !== 'unreachable') {
        this.clearRealmReconnectTimer();
        this.realmReconnectDelayMs = OFFLINE_RECONNECT_INITIAL_DELAY_MS;
      }
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
    const status = this.getStatus();
    if (status.realm.rest === 'unreachable') {
      return true;
    }
    if (this.cacheFallbackActive) {
      return true;
    }
    if (status.realm.socket === 'unreachable') {
      return true;
    }
    if (this.getTier() !== 'L1') {
      return false;
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
    if (this.realmReconnectSchedulePending) {
      this.realmReconnectScheduleRequested = true;
      return;
    }
    this.realmReconnectSchedulePending = true;
    const scheduleEpoch = this.realmReconnectScheduleEpoch;
    try {
      if (!await this.shouldReconnectRealm()
        || scheduleEpoch !== this.realmReconnectScheduleEpoch
        || this.realmReconnectTimer) {
        return;
      }
      this.realmReconnectTimer = this.timer.setTimeout(() => {
        this.realmReconnectTimer = null;
        void this.tryRealmReconnect();
      }, this.realmReconnectDelayMs);
    } finally {
      this.realmReconnectSchedulePending = false;
      if (this.realmReconnectScheduleRequested) {
        this.realmReconnectScheduleRequested = false;
        void this.scheduleRealmReconnect();
      }
    }
  }

  private async tryRealmReconnect(): Promise<void> {
    const status = this.getStatus();
    const restProbe = this.reconnectHandlers.probeRealmReachability;
    const socketProbe = this.reconnectHandlers.probeRealmSocketReachability;
    const restRecoveryRequired = status.realm.rest === 'unreachable' || this.cacheFallbackActive;
    const socketRecoveryRequired = status.realm.socket === 'unreachable';
    if (!restRecoveryRequired && !socketRecoveryRequired) {
      return;
    }
    try {
      const restReachable = !restRecoveryRequired || (restProbe ? await restProbe() : false);
      if (restRecoveryRequired && restReachable && status.realm.rest !== 'reachable') {
        this.markRealmRestReachability('reachable');
      }

      const nextStatus = this.getStatus();
      const socketReachable = !socketRecoveryRequired || (socketProbe ? await socketProbe() : false);
      if (socketRecoveryRequired && socketReachable && nextStatus.realm.socket !== 'reachable') {
        this.markRealmSocketReachability('reachable');
      }

      if (restReachable && socketReachable) {
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
    if (this.runtimeReconnectTimer || this.getStatus().runtime.reachability !== 'unreachable') {
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
        this.markRuntimeReachability('reachable');
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
    this.realmReconnectScheduleEpoch += 1;
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
