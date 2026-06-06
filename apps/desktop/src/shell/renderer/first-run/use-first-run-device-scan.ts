import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NimiRuntimeLocalDeviceProfile } from '@nimiplatform/sdk/runtime';
import { projectDeviceSummary } from './first-run-device-summary.js';
import { firstRunRuntimeLocalClient } from './first-run-runtime-local-client.js';

type UseFirstRunDeviceScanResult = {
  readonly deviceSummary: ReturnType<typeof projectDeviceSummary>;
  readonly deviceScanSettled: boolean;
  readonly retryDeviceScan: () => void;
};

export function useFirstRunDeviceScan(
  selectedDataRoot: string | null,
): UseFirstRunDeviceScanResult {
  const [deviceProfile, setDeviceProfile] = useState<NimiRuntimeLocalDeviceProfile | null>(null);
  const [deviceScanSettled, setDeviceScanSettled] = useState(false);
  const [deviceScanAttempt, setDeviceScanAttempt] = useState(0);

  // Device-scan evidence for the spec-owned `data_root_selected` phase. The
  // scan is bounded by a timeout so a hung or unavailable Runtime fails closed
  // instead of leaving the phase spinning.
  useEffect(() => {
    if (!selectedDataRoot) {
      setDeviceProfile(null);
      setDeviceScanSettled(true);
      return;
    }
    let disposed = false;
    setDeviceProfile(null);
    setDeviceScanSettled(false);
    void (async () => {
      try {
        const next = await Promise.race([
          firstRunRuntimeLocalClient.collectDeviceProfile(),
          new Promise<NimiRuntimeLocalDeviceProfile | null>((resolve) => {
            window.setTimeout(() => resolve(null), 8_000);
          }),
        ]);
        if (!disposed) setDeviceProfile(next);
      } catch {
        if (!disposed) setDeviceProfile(null);
      } finally {
        if (!disposed) setDeviceScanSettled(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [selectedDataRoot, deviceScanAttempt]);

  return {
    deviceSummary: useMemo(() => projectDeviceSummary(deviceProfile), [deviceProfile]),
    deviceScanSettled,
    retryDeviceScan: useCallback(() => {
      setDeviceScanAttempt((current) => current + 1);
    }, []),
  };
}
