import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  localRuntime,
  type LocalRuntimeAssetRecord,
  type LocalRuntimeEnvironmentDependencyJob,
  type LocalRuntimeEnvironmentPlan,
  type LocalRuntimeEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import {
  isLocalRuntimeEnvironmentDependencyJobActiveState,
  isLocalRuntimeEnvironmentDependencyReadyState,
  isLocalRuntimeEnvironmentDependencyStartableState,
  resolveLocalRuntimeImageNativeEnvironmentPlan,
} from '@nimiplatform/sdk/runtime';

type RuntimeDependencyInput = {
  assets: LocalRuntimeAssetRecord[];
  refreshAssetInventorySections: () => Promise<void>;
  setAssetBusy: (busy: boolean) => void;
};

function firstImageAsset(assets: LocalRuntimeAssetRecord[]): LocalRuntimeAssetRecord | undefined {
  return assets.find((asset) => asset.kind === 'image');
}

function dependencyBlocksSetup(dependency: LocalRuntimeEnvironmentPlanDependency): boolean {
  if (!dependency.required) {
    return false;
  }
  return !isLocalRuntimeEnvironmentDependencyReadyState(dependency.state);
}

function firstBlockingDependency(plan: LocalRuntimeEnvironmentPlan | undefined): LocalRuntimeEnvironmentPlanDependency | undefined {
  return plan?.dependencies.find(dependencyBlocksSetup);
}

function dependencyStartable(
  dependency: LocalRuntimeEnvironmentPlanDependency,
  jobs: readonly LocalRuntimeEnvironmentDependencyJob[],
): boolean {
  if (!dependency.required || !dependency.environmentKey) {
    return false;
  }
  if (!isLocalRuntimeEnvironmentDependencyStartableState(dependency.state)) {
    return false;
  }
  return !jobs.some((job) => (
    job.environmentKey === dependency.environmentKey
    && job.dependencyFamily === dependency.dependencyFamily
    && job.dependencyId === dependency.dependencyId
    && isLocalRuntimeEnvironmentDependencyJobActiveState(job.state)
  ));
}

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
    const imageAsset = firstImageAsset(assets);
    const resolvePlan = async () => {
      if (!imageAsset) {
        return localRuntime.resolveEnvironmentPlan({
          packId: 'local-gpu-support',
          consumerScope: 'desktop.local-model-center',
        });
      }
      return resolveLocalRuntimeImageNativeEnvironmentPlan({
        runtime: localRuntime,
        asset: imageAsset,
      });
    };
    void resolvePlan().then((dependency) => {
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
  }, [assets, dependencyResolutionNonce]);

  const sharedRuntimeDependency = useMemo(() => (
    firstBlockingDependency(sharedRuntimeEnvironmentPlan)
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
    const dependencies = sharedRuntimeEnvironmentPlan?.dependencies.filter((dependency) => dependency.environmentKey) || [];
    if (dependencies.length === 0) {
      setSharedRuntimeDependencyJobs([]);
      return;
    }
    let cancelled = false;
    void Promise.all(dependencies.map((dependency) =>
      localRuntime.listEnvironmentDependencyJobs({ environmentKey: dependency.environmentKey }),
    )).then((jobGroups) => {
      if (!cancelled && mountedRef.current) {
        setSharedRuntimeDependencyJobs(jobGroups.flat());
      }
    }).catch(() => {
      if (!cancelled && mountedRef.current) {
        setSharedRuntimeDependencyJobs([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sharedRuntimeEnvironmentPlan]);

  const runtimeDependencyByAssetId = useMemo(() => {
    const next: Record<string, LocalRuntimeEnvironmentPlanDependency> = {};
    for (const asset of assets) {
      if (asset.kind === 'image' && sharedRuntimeDependency) {
        next[asset.localAssetId] = sharedRuntimeDependency;
      }
    }
    return next;
  }, [assets, sharedRuntimeDependency]);

  const refreshRuntimeDependencies = useCallback(() => {
    setDependencyResolutionNonce((prev) => prev + 1);
  }, []);

  const setupRuntimeDependency = useCallback(async () => {
    const dependencies = sharedRuntimeEnvironmentPlan?.dependencies || [];
    const startable = dependencies.filter((dependency) => dependencyStartable(dependency, sharedRuntimeDependencyJobs));
    if (startable.length === 0) {
      return;
    }
    setAssetBusy(true);
    try {
      await Promise.all(startable.map((dependency) => localRuntime.startEnvironmentDependencyJob({
        environmentKey: dependency.environmentKey,
        dependencyFamily: dependency.dependencyFamily,
        dependencyId: dependency.dependencyId,
        sourceKind: dependency.sourceKind,
        confirmed: true,
      }, { caller: 'core' })));
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
    sharedRuntimeDependencyJobs,
    sharedRuntimeEnvironmentPlan,
    sharedRuntimeDependency,
  ]);

  const prepareAssetRuntimeDependencies = useCallback(async (asset: LocalRuntimeAssetRecord) => {
    if (asset.kind !== 'image') {
      return;
    }
    setAssetBusy(true);
    try {
      const plan = await resolveLocalRuntimeImageNativeEnvironmentPlan({
        runtime: localRuntime,
        asset,
      });
      const jobGroups = await Promise.all(plan.dependencies
        .filter((dependency) => dependency.environmentKey)
        .map((dependency) => localRuntime.listEnvironmentDependencyJobs({ environmentKey: dependency.environmentKey })));
      const jobs = jobGroups.flat();
      const startable = plan.dependencies.filter((dependency) => dependencyStartable(dependency, jobs));
      await Promise.all(startable.map((dependency) => localRuntime.startEnvironmentDependencyJob({
        environmentKey: dependency.environmentKey,
        dependencyFamily: dependency.dependencyFamily,
        dependencyId: dependency.dependencyId,
        sourceKind: dependency.sourceKind,
        confirmed: true,
      }, { caller: 'core' })));
      refreshRuntimeDependencies();
      await refreshAssetInventorySections();
    } finally {
      setAssetBusy(false);
    }
  }, [refreshAssetInventorySections, refreshRuntimeDependencies, setAssetBusy]);

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
    prepareAssetRuntimeDependencies,
    retryRuntimeDependencyJob,
    runtimeDependencyByAssetId,
    setupRuntimeDependency,
    sharedRuntimeDependency,
    sharedRuntimeDependencyJobs,
    sharedRuntimeEnvironmentPlan,
  };
}
