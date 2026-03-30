import { useEffect, useState } from 'react';
import { desktopBridge } from '@renderer/bridge';
import type { SystemResourceSnapshot as BridgeSystemResourceSnapshot } from '@renderer/bridge';

export type SystemResourceSnapshot = BridgeSystemResourceSnapshot;
export type SystemResourceStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'stale';
export type SystemResourceState = {
  status: SystemResourceStatus;
  snapshot: SystemResourceSnapshot | null;
  errorMessage: string | null;
};

function normalizeSnapshot(raw: SystemResourceSnapshot): SystemResourceSnapshot {
  return {
    cpuPercent: Math.max(0, Math.min(100, Number(raw.cpuPercent) || 0)),
    memoryUsedBytes: Math.max(0, Number(raw.memoryUsedBytes) || 0),
    memoryTotalBytes: Math.max(0, Number(raw.memoryTotalBytes) || 0),
    diskUsedBytes: Math.max(0, Number(raw.diskUsedBytes) || 0),
    diskTotalBytes: Math.max(0, Number(raw.diskTotalBytes) || 0),
    temperatureCelsius: Number.isFinite(Number(raw.temperatureCelsius))
      ? Number(raw.temperatureCelsius)
      : undefined,
    capturedAtMs: Number(raw.capturedAtMs) > 0 ? Number(raw.capturedAtMs) : Date.now(),
    source: String(raw.source || '').trim() || 'tauri-unknown',
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'SYSTEM_RESOURCES_UNAVAILABLE';
}

export function useSystemResources(pollIntervalMs = 5000): SystemResourceState {
  const [state, setState] = useState<SystemResourceState>({
    status: 'idle',
    snapshot: null,
    errorMessage: null,
  });

  useEffect(() => {
    let canceled = false;
    const load = async () => {
      setState((prev) => (
        prev.snapshot
          ? prev
          : { status: 'loading', snapshot: null, errorMessage: null }
      ));
      try {
        const payload = await desktopBridge.getSystemResourceSnapshot();
        if (canceled) {
          return;
        }
        setState({
          status: 'ready',
          snapshot: normalizeSnapshot(payload),
          errorMessage: null,
        });
      } catch (error) {
        if (canceled) {
          return;
        }
        setState((prev) => ({
          status: prev.snapshot ? 'stale' : 'unavailable',
          snapshot: prev.snapshot,
          errorMessage: toErrorMessage(error),
        }));
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, Math.max(1500, pollIntervalMs));

    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [pollIntervalMs]);

  return state;
}
