import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  localRuntime,
  type LocalRuntimeAssetRecord,
  type LocalRuntimeDependencyDescriptor,
} from '@runtime/local-runtime';

type RuntimeDependencyInput = {
  assets: LocalRuntimeAssetRecord[];
  refreshAssetInventorySections: () => Promise<void>;
  setAssetBusy: (busy: boolean) => void;
};

export function useLocalModelCenterRuntimeDependencies({
  assets,
  refreshAssetInventorySections,
  setAssetBusy,
}: RuntimeDependencyInput) {
  const mountedRef = useRef(true);
  const [sharedRuntimeDependency, setSharedRuntimeDependency] = useState<LocalRuntimeDependencyDescriptor | undefined>(undefined);
  const [dependencyResolutionNonce, setDependencyResolutionNonce] = useState(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void localRuntime.resolveDependency({
      dependencyId: 'nvidia-cuda-user-space-runtime',
    }).then((dependency) => {
      if (!cancelled && mountedRef.current) {
        setSharedRuntimeDependency(dependency);
      }
    }).catch(() => {
      if (!cancelled && mountedRef.current) {
        setSharedRuntimeDependency(undefined);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dependencyResolutionNonce]);

  const runtimeDependencyByAssetId = useMemo(() => {
    if (!sharedRuntimeDependency) {
      return {};
    }
    const next: Record<string, LocalRuntimeDependencyDescriptor> = {};
    for (const asset of assets) {
      if (asset.kind === 'image') {
        next[asset.localAssetId] = sharedRuntimeDependency;
      }
    }
    return next;
  }, [assets, sharedRuntimeDependency]);

  const refreshRuntimeDependencies = useCallback(() => {
    setDependencyResolutionNonce((prev) => prev + 1);
  }, []);

  const setupRuntimeDependency = useCallback(async () => {
    setAssetBusy(true);
    try {
      await localRuntime.startDependencySetup({
        dependencyId: 'nvidia-cuda-user-space-runtime',
      }, { caller: 'core' });
      await refreshAssetInventorySections();
      refreshRuntimeDependencies();
    } finally {
      setAssetBusy(false);
    }
  }, [refreshAssetInventorySections, refreshRuntimeDependencies, setAssetBusy]);

  return {
    refreshRuntimeDependencies,
    runtimeDependencyByAssetId,
    setupRuntimeDependency,
    sharedRuntimeDependency,
  };
}
