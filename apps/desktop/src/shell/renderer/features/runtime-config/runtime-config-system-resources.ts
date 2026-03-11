import { useEffect, useState } from 'react';
import { desktopBridge } from '@renderer/bridge';
import type { SystemResourceSnapshot as BridgeSystemResourceSnapshot } from '@renderer/bridge';

export type SystemResourceSnapshot = BridgeSystemResourceSnapshot;

function fallbackSnapshot(source: string): SystemResourceSnapshot {
  return {
    cpuPercent: 0,
    memoryUsedBytes: 0,
    memoryTotalBytes: 0,
    diskUsedBytes: 0,
    diskTotalBytes: 0,
    temperatureCelsius: undefined,
    capturedAtMs: Date.now(),
    source,
  };
}

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

export function useSystemResources(pollIntervalMs = 5000): SystemResourceSnapshot {
  const [snapshot, setSnapshot] = useState<SystemResourceSnapshot>(() => fallbackSnapshot('initial'));

  useEffect(() => {
    let canceled = false;
    const load = async () => {
      try {
        const payload = await desktopBridge.getSystemResourceSnapshot();
        if (canceled) {
          return;
        }
        setSnapshot(normalizeSnapshot(payload));
      } catch {
        if (canceled) {
          return;
        }
        setSnapshot((prev: SystemResourceSnapshot) => ({
          ...prev,
          capturedAtMs: Date.now(),
          source: `${prev.source}:stale`,
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

  return snapshot;
}
