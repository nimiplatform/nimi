import type { ConnectivityStatus } from './types.js';

type ConnectivityListener = (status: ConnectivityStatus) => void;

/**
 * Tracks Realm and Runtime connectivity state.
 * Fed by: Socket.IO events, REST request results, bootstrap status.
 */
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
        // swallow listener errors
      }
    }
  }
}
