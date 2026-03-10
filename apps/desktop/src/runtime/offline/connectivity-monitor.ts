import type { ConnectivityStatus } from './types.js';

type ConnectivityListener = (status: ConnectivityStatus) => void;

/**
 * Tracks Realm and Runtime connectivity state.
 * Fed by: Socket.IO events, REST request results, bootstrap status.
 */
export class ConnectivityMonitor {
  private realmReachable = true;
  private runtimeReachable = true;
  private realmLastCheckedAt = Date.now();
  private runtimeLastCheckedAt = Date.now();
  private readonly listeners = new Set<ConnectivityListener>();

  setRealmSocketConnected(connected: boolean): void {
    this.realmReachable = connected;
    this.realmLastCheckedAt = Date.now();
    this.emit();
  }

  setRealmRestReachable(reachable: boolean): void {
    this.realmReachable = reachable;
    this.realmLastCheckedAt = Date.now();
    this.emit();
  }

  setRuntimeReachable(reachable: boolean): void {
    this.runtimeReachable = reachable;
    this.runtimeLastCheckedAt = Date.now();
    this.emit();
  }

  getStatus(): ConnectivityStatus {
    return {
      realm: { reachable: this.realmReachable, lastCheckedAt: this.realmLastCheckedAt },
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
