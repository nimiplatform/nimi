import type { ConnectivityMonitor } from './connectivity-monitor.js';
import type { OfflineTier, OfflineTierChange } from './types.js';

type TierChangeListener = (change: OfflineTierChange) => void;

/**
 * D-OFFLINE-001: Manages L0/L1/L2 degradation tier.
 * L0: realm + runtime reachable
 * L1: runtime reachable, realm unreachable
 * L2: runtime unreachable (realm state irrelevant)
 */
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
    let nextTier: OfflineTier;

    if (!runtime.reachable) {
      nextTier = 'L2';
    } else if (!realm.reachable) {
      nextTier = 'L1';
    } else {
      nextTier = 'L0';
    }

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
        // swallow listener errors
      }
    }
  }

  private inferReason(from: OfflineTier, to: OfflineTier): OfflineTierChange['reason'] {
    if (to === 'L2') return 'runtime_offline';
    if (from === 'L2') return 'runtime_reconnect';
    if (to === 'L1') return 'realm_offline';
    return 'realm_reconnect';
  }
}
