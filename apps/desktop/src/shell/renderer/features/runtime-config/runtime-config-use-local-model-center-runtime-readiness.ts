import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  localRuntime,
  type LocalRuntimeAssetRecord,
  type LocalRuntimeEnvironmentDependencyJob,
  type LocalRuntimeEnvironmentPlan,
  type LocalRuntimeEnvironmentPlanDependency,
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
  const [sharedRuntimeEnvironmentPlan, setSharedRuntimeEnvironmentPlan] = useState<LocalRuntimeEnvironmentPlan | undefined>(undefined);
  const [sharedRuntimeDependencyJobs, setSharedRuntimeDependencyJobs] = useState<LocalRuntimeEnvironmentDependencyJob[]>([]);
  const [dependencyResolutionNonce, setDependencyResolutionNonce] = useState(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void localRuntime.resolveEnvironmentPlan({
      packId: 'local-gpu-support',
      consumerScope: 'desktop.local-model-center',
    }).then((dependency) => {
      if (!cancelled && mountedRef.current) {
        setSharedRuntimeEnvironmentPlan(dependency);
      }
    }).catch(() => {
      if (!cancelled && mountedRef.current) {
        setSharedRuntimeEnvironmentPlan(undefined);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dependencyResolutionNonce]);

  const sharedRuntimeDependency = useMemo(() => (
    sharedRuntimeEnvironmentPlan?.dependencies.find((dependency) => (
      dependency.dependencyId === 'nvidia-cuda-user-space-runtime'
    ))
  ), [sharedRuntimeEnvironmentPlan]);

  const refreshRuntimeDependencyJobs = useCallback(async (
    dependency: LocalRuntimeEnvironmentPlanDependency | undefined,
  ) => {
    if (!dependency?.environmentKey) {
      setSharedRuntimeDependencyJobs([]);
      return;
    }
    try {
      const jobs = await localRuntime.listEnvironmentDependencyJobs({
        environmentKey: dependency.environmentKey,
      });
      if (mountedRef.current) {
        setSharedRuntimeDependencyJobs(jobs.filter((job) => (
          job.dependencyFamily === dependency.dependencyFamily
          && job.dependencyId === dependency.dependencyId
        )));
      }
    } catch {
      if (mountedRef.current) {
        setSharedRuntimeDependencyJobs([]);
      }
    }
  }, []);

  useEffect(() => {
    void refreshRuntimeDependencyJobs(sharedRuntimeDependency);
  }, [refreshRuntimeDependencyJobs, sharedRuntimeDependency]);

  const runtimeDependencyByAssetId = useMemo(() => {
    if (!sharedRuntimeDependency) {
      return {};
    }
    const next: Record<string, LocalRuntimeEnvironmentPlanDependency> = {};
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
    if (!sharedRuntimeDependency) {
      return;
    }
    setAssetBusy(true);
    try {
      await localRuntime.startEnvironmentDependencyJob({
        environmentKey: sharedRuntimeDependency.environmentKey,
        dependencyFamily: sharedRuntimeDependency.dependencyFamily,
        dependencyId: sharedRuntimeDependency.dependencyId,
        sourceKind: sharedRuntimeDependency.sourceKind,
        confirmed: true,
      }, { caller: 'core' });
      await refreshAssetInventorySections();
      refreshRuntimeDependencies();
      await refreshRuntimeDependencyJobs(sharedRuntimeDependency);
    } finally {
      setAssetBusy(false);
    }
  }, [
    refreshAssetInventorySections,
    refreshRuntimeDependencies,
    refreshRuntimeDependencyJobs,
    setAssetBusy,
    sharedRuntimeDependency,
  ]);

  const cancelRuntimeDependencyJob = useCallback(async (jobId: string) => {
    setAssetBusy(true);
    try {
      await localRuntime.cancelEnvironmentDependencyJob({ jobId }, { caller: 'core' });
      refreshRuntimeDependencies();
      await refreshRuntimeDependencyJobs(sharedRuntimeDependency);
    } finally {
      setAssetBusy(false);
    }
  }, [refreshRuntimeDependencies, refreshRuntimeDependencyJobs, setAssetBusy, sharedRuntimeDependency]);

  const retryRuntimeDependencyJob = useCallback(async (jobId: string) => {
    setAssetBusy(true);
    try {
      await localRuntime.retryEnvironmentDependencyJob({
        jobId,
        confirmed: true,
      }, { caller: 'core' });
      refreshRuntimeDependencies();
      await refreshRuntimeDependencyJobs(sharedRuntimeDependency);
    } finally {
      setAssetBusy(false);
    }
  }, [refreshRuntimeDependencies, refreshRuntimeDependencyJobs, setAssetBusy, sharedRuntimeDependency]);

  const repairRuntimeDependency = useCallback(async () => {
    if (!sharedRuntimeDependency) {
      return;
    }
    setAssetBusy(true);
    try {
      await localRuntime.repairEnvironmentDependency({
        environmentKey: sharedRuntimeDependency.environmentKey,
        dependencyFamily: sharedRuntimeDependency.dependencyFamily,
        dependencyId: sharedRuntimeDependency.dependencyId,
        confirmed: true,
        reasonCode: sharedRuntimeDependency.reasonCode,
      }, { caller: 'core' });
      refreshRuntimeDependencies();
      await refreshRuntimeDependencyJobs(sharedRuntimeDependency);
    } finally {
      setAssetBusy(false);
    }
  }, [refreshRuntimeDependencies, refreshRuntimeDependencyJobs, setAssetBusy, sharedRuntimeDependency]);

  return {
    cancelRuntimeDependencyJob,
    refreshRuntimeDependencies,
    repairRuntimeDependency,
    retryRuntimeDependencyJob,
    runtimeDependencyByAssetId,
    setupRuntimeDependency,
    sharedRuntimeDependency,
    sharedRuntimeDependencyJobs,
    sharedRuntimeEnvironmentPlan,
  };
}
