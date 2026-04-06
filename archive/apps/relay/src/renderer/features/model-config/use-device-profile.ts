// RL-FEAT-008 — Device profile hook
// Calls runtime.local.collectDeviceProfile via IPC bridge

import { useEffect, useState } from 'react';
import { getBridge } from '../../bridge/electron-bridge.js';
import type { RelayInvokeResponse } from '../../../shared/ipc-contract.js';

type DeviceProfileData = RelayInvokeResponse<'relay:local:device-profile'>;

export interface DeviceProfile {
  data: DeviceProfileData | null;
  loading: boolean;
  error: string | null;
}

export function useDeviceProfile(): DeviceProfile {
  const [data, setData] = useState<DeviceProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      const bridge = getBridge();
      try {
        const result = await bridge.local.collectDeviceProfile();
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetch();
    return () => { cancelled = true; };
  }, []);

  return { data, loading, error };
}
