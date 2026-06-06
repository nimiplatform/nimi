import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  isNimiRuntimeLocalEnvironmentDependencyStartableState,
  resolveNimiRuntimeLocalImageNativeEnvironmentPlan,
  type NimiRuntimeLocalAssetRecord,
  type NimiRuntimeLocalEnvironmentDependencyJob,
  type NimiRuntimeLocalEnvironmentPlan,
  type NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import { runtimeConfigLocalModelCenterClient } from './runtime-config-local-model-center-sdk-service';

type RuntimeDependencyInput = {
  assets: NimiRuntimeLocalAssetRecord[];
  refreshAssetInventorySections: () => Promise<void>;
  setAssetBusy: (busy: boolean) => void;
};

function firstImageAsset(assets: NimiRuntimeLocalAssetRecord[]): NimiRuntimeLocalAssetRecord | undefined {
  return assets.find((asset) => asset.kind === 'image');
}

function dependencyBlocksSetup(dependency: NimiRuntimeLocalEnvironmentPlanDependency): boolean {
  if (!dependency.required) {
    return false;
  }
  return !isNimiRuntimeLocalEnvironmentDependencyReadyState(dependency.state);
}

function firstBlockingDependency(plan: NimiRuntimeLocalEnvironmentPlan | undefined): NimiRuntimeLocalEnvironmentPlanDependency | undefined {
  return plan?.dependencies.find(dependencyBlocksSetup);
}

function dependencyStartable(
  dependency: NimiRuntimeLocalEnvironmentPlanDependency,
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
): boolean {
  if (!dependency.required || !dependency.environmentKey) {
    return false;
  }
  if (!isNimiRuntimeLocalEnvironmentDependencyStartableState(dependency.state)) {
    return false;
  }
  return !jobs.some((job) => (
    runtimeDependencyJobMatchesDependency(job, dependency)
    && isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state)
  ));
}

function runtimeDependencyJobMatchesDependency(
  job: NimiRuntimeLocalEnvironmentDependencyJob,
  dependency: NimiRuntimeLocalEnvironmentPlanDependency,
): boolean {
  return (
    job.environmentKey === dependency.environmentKey
    && job.dependencyFamily === dependency.dependencyFamily
    && job.dependencyId === dependency.dependencyId
  );
}

function runtimeDependenciesWithEnvironment(
  dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[] | undefined,
): NimiRuntimeLocalEnvironmentPlanDependency[] {
  return (dependencies || []).filter((dependency) => Boolean(dependency.environmentKey));
}

function dedupeRuntimeDependencyJobs(
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
): NimiRuntimeLocalEnvironmentDependencyJob[] {
  const seen = new Set<string>();
  const next: NimiRuntimeLocalEnvironmentDependencyJob[] = [];
  for (const job of jobs) {
    const id = String(job.jobId || '').trim();
    if (id && seen.has(id)) {
      continue;
    }
    if (id) {
      seen.add(id);
    }
    next.push(job);
  }
  return next;
}

function upsertRuntimeDependencyJob(
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
  nextJob: NimiRuntimeLocalEnvironmentDependencyJob | undefined,
): NimiRuntimeLocalEnvironmentDependencyJob[] {
  if (!nextJob?.jobId) {
    return [...jobs];
  }
  return dedupeRuntimeDependencyJobs([nextJob, ...jobs]);
}

export function useLocalModelCenterRuntimeDependencies({
  assets,
  refreshAssetInventorySections,
  setAssetBusy,
}: RuntimeDependencyInput) {
  const mountedRef = useRef(true);
  const [sharedRuntimeEnvironmentPlan, setSharedRuntimeEnvironmentPlan] = useState<NimiRuntimeLocalEnvironmentPlan | undefined>(undefined);
  const [sharedRuntimeDependencyJobs, setSharedRuntimeDependencyJobs] = useState<NimiRuntimeLocalEnvironmentDependencyJob[]>([]);
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
        return runtimeConfigLocalModelCenterClient.resolveEnvironmentPlan({
          packId: 'local-gpu-support',
          consumerScope: 'desktop.local-model-center',
        });
      }
      return resolveNimiRuntimeLocalImageNativeEnvironmentPlan({
        runtime: runtimeConfigLocalModelCenterClient,
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
    dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[] | undefined,
  ) => {
    const scopedDependencies = runtimeDependenciesWithEnvironment(dependencies);
    if (scopedDependencies.length === 0) {
      setSharedRuntimeDependencyJobs([]);
      return;
    }
    try {
      const jobGroups = await Promise.all(scopedDependencies.map((dependency) =>
        runtimeConfigLocalModelCenterClient.listEnvironmentDependencyJobs({ environmentKey: dependency.environmentKey })));
      const jobs = dedupeRuntimeDependencyJobs(jobGroups.flat()).filter((job) => (
        scopedDependencies.some((dependency) => runtimeDependencyJobMatchesDependency(job, dependency))
      ));
      if (mountedRef.current) {
        setSharedRuntimeDependencyJobs(jobs);
      }
    } catch {
      if (mountedRef.current) {
        setSharedRuntimeDependencyJobs([]);
      }
    }
  }, []);

  useEffect(() => {
    const dependencies = runtimeDependenciesWithEnvironment(sharedRuntimeEnvironmentPlan?.dependencies);
    if (dependencies.length === 0) {
      setSharedRuntimeDependencyJobs([]);
      return;
    }
    let cancelled = false;
    void refreshRuntimeDependencyJobs(dependencies).finally(() => {
      if (cancelled) {
        return;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refreshRuntimeDependencyJobs, sharedRuntimeEnvironmentPlan]);

  const hasActiveRuntimeDependencyJob = useMemo(() => (
    sharedRuntimeDependencyJobs.some((job) => isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state))
  ), [sharedRuntimeDependencyJobs]);

  const refreshRuntimeDependencies = useCallback(() => {
    setDependencyResolutionNonce((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!hasActiveRuntimeDependencyJob || !sharedRuntimeEnvironmentPlan) {
      return undefined;
    }
    let cancelled = false;
    const tick = async () => {
      const dependencies = runtimeDependenciesWithEnvironment(sharedRuntimeEnvironmentPlan.dependencies);
      await refreshRuntimeDependencyJobs(dependencies);
      await refreshAssetInventorySections();
      if (!cancelled && mountedRef.current) {
        refreshRuntimeDependencies();
      }
    };
    const interval = window.setInterval(() => {
      void tick();
    }, 2000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    hasActiveRuntimeDependencyJob,
    refreshAssetInventorySections,
    refreshRuntimeDependencies,
    refreshRuntimeDependencyJobs,
    sharedRuntimeEnvironmentPlan,
  ]);

  const runtimeDependencyByAssetId = useMemo(() => {
    const next: Record<string, NimiRuntimeLocalEnvironmentPlanDependency> = {};
    for (const asset of assets) {
      if (asset.kind === 'image' && sharedRuntimeDependency) {
        next[asset.localAssetId] = sharedRuntimeDependency;
      }
    }
    return next;
  }, [assets, sharedRuntimeDependency]);

  const setupRuntimeDependency = useCallback(async () => {
    const dependencies = sharedRuntimeEnvironmentPlan?.dependencies || [];
    const startable = dependencies.filter((dependency) => dependencyStartable(dependency, sharedRuntimeDependencyJobs));
    if (startable.length === 0) {
      return;
    }
    setAssetBusy(true);
    try {
      const startedJobs = await Promise.all(startable.map((dependency) => runtimeConfigLocalModelCenterClient.startEnvironmentDependencyJob({
        environmentKey: dependency.environmentKey,
        dependencyFamily: dependency.dependencyFamily,
        dependencyId: dependency.dependencyId,
        sourceKind: dependency.sourceKind,
        confirmed: true,
      }, { caller: 'core' })));
      if (mountedRef.current) {
        setSharedRuntimeDependencyJobs((prev) => dedupeRuntimeDependencyJobs([...startedJobs, ...prev]));
      }
      await refreshAssetInventorySections();
      refreshRuntimeDependencies();
      await refreshRuntimeDependencyJobs(sharedRuntimeEnvironmentPlan?.dependencies);
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
  ]);

  const prepareAssetRuntimeDependencies = useCallback(async (asset: NimiRuntimeLocalAssetRecord) => {
    if (asset.kind !== 'image') {
      return;
    }
    setAssetBusy(true);
    try {
      const plan = await resolveNimiRuntimeLocalImageNativeEnvironmentPlan({
        runtime: runtimeConfigLocalModelCenterClient,
        asset,
      });
      const jobGroups = await Promise.all(plan.dependencies
        .filter((dependency) => dependency.environmentKey)
        .map((dependency) => runtimeConfigLocalModelCenterClient.listEnvironmentDependencyJobs({ environmentKey: dependency.environmentKey })));
      const jobs = jobGroups.flat();
      const startable = plan.dependencies.filter((dependency) => dependencyStartable(dependency, jobs));
      await Promise.all(startable.map((dependency) => runtimeConfigLocalModelCenterClient.startEnvironmentDependencyJob({
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
      const cancelledJob = await runtimeConfigLocalModelCenterClient.cancelEnvironmentDependencyJob({ jobId }, { caller: 'core' });
      if (mountedRef.current) {
        setSharedRuntimeDependencyJobs((prev) => upsertRuntimeDependencyJob(prev, cancelledJob));
      }
      refreshRuntimeDependencies();
      await refreshRuntimeDependencyJobs(sharedRuntimeEnvironmentPlan?.dependencies);
    } finally {
      setAssetBusy(false);
    }
  }, [refreshRuntimeDependencies, refreshRuntimeDependencyJobs, setAssetBusy, sharedRuntimeEnvironmentPlan]);

  const retryRuntimeDependencyJob = useCallback(async (jobId: string) => {
    setAssetBusy(true);
    try {
      const retryJob = await runtimeConfigLocalModelCenterClient.retryEnvironmentDependencyJob({
        jobId,
        confirmed: true,
      }, { caller: 'core' });
      if (mountedRef.current) {
        setSharedRuntimeDependencyJobs((prev) => upsertRuntimeDependencyJob(prev, retryJob));
      }
      refreshRuntimeDependencies();
      await refreshRuntimeDependencyJobs(sharedRuntimeEnvironmentPlan?.dependencies);
    } finally {
      setAssetBusy(false);
    }
  }, [refreshRuntimeDependencies, refreshRuntimeDependencyJobs, setAssetBusy, sharedRuntimeEnvironmentPlan]);

  const repairRuntimeDependency = useCallback(async () => {
    if (!sharedRuntimeDependency) {
      return;
    }
    setAssetBusy(true);
    try {
      const repairJob = await runtimeConfigLocalModelCenterClient.repairEnvironmentDependency({
        environmentKey: sharedRuntimeDependency.environmentKey,
        dependencyFamily: sharedRuntimeDependency.dependencyFamily,
        dependencyId: sharedRuntimeDependency.dependencyId,
        confirmed: true,
        reasonCode: sharedRuntimeDependency.reasonCode,
      }, { caller: 'core' });
      if (mountedRef.current) {
        setSharedRuntimeDependencyJobs((prev) => upsertRuntimeDependencyJob(prev, repairJob));
      }
      refreshRuntimeDependencies();
      await refreshRuntimeDependencyJobs(sharedRuntimeEnvironmentPlan?.dependencies);
    } finally {
      setAssetBusy(false);
    }
  }, [refreshRuntimeDependencies, refreshRuntimeDependencyJobs, setAssetBusy, sharedRuntimeDependency, sharedRuntimeEnvironmentPlan]);

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
