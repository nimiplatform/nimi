import { useEffect, useState } from 'react';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import type { DesktopSystemResourceSnapshot } from '../../renderer/system-resources-port.js';

export type SystemResourceSnapshot = DesktopSystemResourceSnapshot;
export type SystemResourceStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'stale';
export type SystemResourceState = {
  status: SystemResourceStatus;
  snapshot: SystemResourceSnapshot | null;
  errorMessage: string | null;
};

function normalizeSnapshot(raw: SystemResourceSnapshot, now: () => number): SystemResourceSnapshot {
  return {
    cpuPercent: Math.max(0, Math.min(100, Number(raw.cpuPercent) || 0)),
    memoryUsedBytes: Math.max(0, Number(raw.memoryUsedBytes) || 0),
    memoryTotalBytes: Math.max(0, Number(raw.memoryTotalBytes) || 0),
    diskUsedBytes: Math.max(0, Number(raw.diskUsedBytes) || 0),
    diskTotalBytes: Math.max(0, Number(raw.diskTotalBytes) || 0),
    temperatureCelsius: Number.isFinite(Number(raw.temperatureCelsius))
      ? Number(raw.temperatureCelsius)
      : undefined,
    capturedAtMs: Number(raw.capturedAtMs) > 0 ? Number(raw.capturedAtMs) : now(),
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
  const bindings = useDesktopRendererBindings();
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
        const payload = await bindings.app.commands.systemResources.load();
        if (canceled) {
          return;
        }
        setState({
          status: 'ready',
          snapshot: normalizeSnapshot(payload, bindings.clock.now),
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

    let cancelNext: (() => void) | null = null;
    const poll = async () => {
      await load();
      if (canceled) return;
      cancelNext = bindings.clock.schedule(Math.max(1500, pollIntervalMs), (result) => {
        cancelNext = null;
        if (!result.ok) {
          setState((previous) => ({
            status: previous.snapshot ? 'stale' : 'unavailable',
            snapshot: previous.snapshot,
            errorMessage: result.error,
          }));
          return;
        }
        void poll();
      });
    };
    void poll();

    return () => {
      canceled = true;
      cancelNext?.();
      cancelNext = null;
    };
  }, [bindings, pollIntervalMs]);

  return state;
}
