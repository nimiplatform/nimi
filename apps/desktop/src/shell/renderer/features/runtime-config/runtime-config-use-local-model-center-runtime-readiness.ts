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
import {
  retryableInterruptedRuntimeDependencyJobs,
  runtimeDependencyAutoRetryKey,
} from './runtime-config-local-model-center-runtime-dependency-recovery';

type RuntimeDependencyInput = {
  assets: NimiRuntimeLocalAssetRecord[];
  refreshAssetInventorySections: () => Promise<void>;
  setAssetBusy: (busy: boolean) => void;
};

function imageAssets(assets: NimiRuntimeLocalAssetRecord[]): NimiRuntimeLocalAssetRecord[] {
  return assets.filter((asset) => asset.kind === 'image');
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
    && job.consumerScope === dependency.consumerScope
  );
}

function runtimeDependenciesWithEnvironment(
  dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[] | undefined,
): NimiRuntimeLocalEnvironmentPlanDependency[] {
  return (dependencies || []).filter((dependency) => Boolean(dependency.environmentKey));
}

function dedupeRuntimeDependencies(
  dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[],
): NimiRuntimeLocalEnvironmentPlanDependency[] {
  const seen = new Set<string>();
  const next: NimiRuntimeLocalEnvironmentPlanDependency[] = [];
  for (const dependency of dependencies) {
    const key = [
      dependency.environmentKey,
      dependency.dependencyFamily,
      dependency.dependencyId,
      dependency.consumerScope,
    ].join('\u0000');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(dependency);
  }
  return next;
}

function firstPlanWithBlockingDependency(
  plans: readonly NimiRuntimeLocalEnvironmentPlan[],
): NimiRuntimeLocalEnvironmentPlan | undefined {
  return plans.find((plan) => Boolean(firstBlockingDependency(plan)));
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

function runtimeDependencyErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return fallback;
}

export function useLocalModelCenterRuntimeDependencies({
  assets,
  refreshAssetInventorySections,
  setAssetBusy,
}: RuntimeDependencyInput) {
  const mountedRef = useRef(true);
  const autoRetryAttemptedKeysRef = useRef<Set<string>>(new Set());
  const [sharedRuntimeEnvironmentPlan, setSharedRuntimeEnvironmentPlan] = useState<NimiRuntimeLocalEnvironmentPlan | undefined>(undefined);
  const [runtimeEnvironmentPlanByAssetId, setRuntimeEnvironmentPlanByAssetId] = useState<Record<string, NimiRuntimeLocalEnvironmentPlan | undefined>>({});
  const [sharedRuntimeDependencyJobs, setSharedRuntimeDependencyJobs] = useState<NimiRuntimeLocalEnvironmentDependencyJob[]>([]);
  const [runtimeDependencyError, setRuntimeDependencyError] = useState('');
  const [dependencyResolutionNonce, setDependencyResolutionNonce] = useState(0);
  const imageAssetSignature = useMemo(() => (
    imageAssets(assets).map((asset) => asset.localAssetId).sort().join('|')
  ), [assets]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    autoRetryAttemptedKeysRef.current.clear();
  }, [imageAssetSignature]);

  useEffect(() => {
    let cancelled = false;
    const currentImageAssets = imageAssets(assets);
    const resolvePlan = async () => {
      if (currentImageAssets.length === 0) {
        const plan = await runtimeConfigLocalModelCenterClient.resolveEnvironmentPlan({
          packId: 'local-gpu-support',
          consumerScope: 'desktop.local-model-center',
        });
        return { sharedPlan: plan, byAssetId: {} };
      }
      const resolved = await Promise.all(currentImageAssets.map(async (asset) => ({
        assetId: asset.localAssetId,
        plan: await resolveNimiRuntimeLocalImageNativeEnvironmentPlan({
          runtime: runtimeConfigLocalModelCenterClient,
          asset,
        }),
      })));
      const byAssetId: Record<string, NimiRuntimeLocalEnvironmentPlan | undefined> = {};
      const plans: NimiRuntimeLocalEnvironmentPlan[] = [];
      for (const item of resolved) {
        byAssetId[item.assetId] = item.plan;
        plans.push(item.plan);
      }
      return {
        sharedPlan: firstPlanWithBlockingDependency(plans) || plans[0],
        byAssetId,
      };
    };
    void resolvePlan().then((resolution) => {
      if (!cancelled && mountedRef.current) {
        setSharedRuntimeEnvironmentPlan(resolution.sharedPlan);
        setRuntimeEnvironmentPlanByAssetId(resolution.byAssetId);
        setRuntimeDependencyError('');
      }
    }).catch((error: unknown) => {
      if (!cancelled && mountedRef.current) {
        setRuntimeDependencyError(runtimeDependencyErrorMessage(error, 'Runtime environment dependency plan failed.'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [assets, dependencyResolutionNonce]);

  const sharedRuntimeDependency = useMemo(() => (
    firstBlockingDependency(sharedRuntimeEnvironmentPlan)
  ), [sharedRuntimeEnvironmentPlan]);

  const allRuntimeEnvironmentPlans = useMemo(() => {
    const assetPlans = Object.values(runtimeEnvironmentPlanByAssetId).filter((plan): plan is NimiRuntimeLocalEnvironmentPlan => Boolean(plan));
    if (assetPlans.length > 0) {
      return assetPlans;
    }
    return sharedRuntimeEnvironmentPlan ? [sharedRuntimeEnvironmentPlan] : [];
  }, [runtimeEnvironmentPlanByAssetId, sharedRuntimeEnvironmentPlan]);

  const allRuntimeDependencies = useMemo(() => (
    dedupeRuntimeDependencies(allRuntimeEnvironmentPlans.flatMap((plan) => runtimeDependenciesWithEnvironment(plan.dependencies)))
  ), [allRuntimeEnvironmentPlans]);

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
        setRuntimeDependencyError('');
      }
    } catch (error) {
      if (mountedRef.current) {
        setRuntimeDependencyError(runtimeDependencyErrorMessage(error, 'Runtime environment dependency jobs failed.'));
      }
    }
  }, []);

  useEffect(() => {
    if (allRuntimeDependencies.length === 0) {
      setSharedRuntimeDependencyJobs([]);
      return;
    }
    let cancelled = false;
    void refreshRuntimeDependencyJobs(allRuntimeDependencies).finally(() => {
      if (cancelled) {
        return;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [allRuntimeDependencies, refreshRuntimeDependencyJobs]);

  const hasActiveRuntimeDependencyJob = useMemo(() => (
    sharedRuntimeDependencyJobs.some((job) => isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state))
  ), [sharedRuntimeDependencyJobs]);

  const refreshRuntimeDependencies = useCallback(() => {
    setDependencyResolutionNonce((prev) => prev + 1);
  }, []);

  const autoRetryRuntimeDependencyJobs = useMemo(() => (
    retryableInterruptedRuntimeDependencyJobs(allRuntimeDependencies, sharedRuntimeDependencyJobs)
  ), [allRuntimeDependencies, sharedRuntimeDependencyJobs]);

  useEffect(() => {
    const jobsToRetry = autoRetryRuntimeDependencyJobs.filter((job) => {
      const key = runtimeDependencyAutoRetryKey(job);
      if (autoRetryAttemptedKeysRef.current.has(key)) {
        return false;
      }
      autoRetryAttemptedKeysRef.current.add(key);
      return true;
    });
    if (jobsToRetry.length === 0) {
      return undefined;
    }
    let cancelled = false;
    const retryJobs = async () => {
      setAssetBusy(true);
      try {
        const retryJobs = await Promise.all(jobsToRetry.map((job) =>
          runtimeConfigLocalModelCenterClient.retryEnvironmentDependencyJob({
            jobId: job.jobId,
            confirmed: true,
          }, { caller: 'core' })));
        if (!cancelled && mountedRef.current) {
          setSharedRuntimeDependencyJobs((prev) => dedupeRuntimeDependencyJobs([...retryJobs, ...prev]));
          setRuntimeDependencyError('');
        }
        refreshRuntimeDependencies();
        await refreshRuntimeDependencyJobs(allRuntimeDependencies);
      } catch (error) {
        if (!cancelled && mountedRef.current) {
          setRuntimeDependencyError(runtimeDependencyErrorMessage(error, 'Runtime environment dependency retry failed.'));
        }
      } finally {
        if (!cancelled && mountedRef.current) {
          setAssetBusy(false);
        }
      }
    };
    void retryJobs();
    return () => {
      cancelled = true;
    };
  }, [
    allRuntimeDependencies,
    autoRetryRuntimeDependencyJobs,
    refreshRuntimeDependencies,
    refreshRuntimeDependencyJobs,
    setAssetBusy,
  ]);

  useEffect(() => {
    if (!hasActiveRuntimeDependencyJob || allRuntimeDependencies.length === 0) {
      return undefined;
    }
    let cancelled = false;
    const tick = async () => {
      await refreshRuntimeDependencyJobs(allRuntimeDependencies);
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
    allRuntimeDependencies,
    refreshAssetInventorySections,
    refreshRuntimeDependencies,
    refreshRuntimeDependencyJobs,
  ]);

  const runtimeDependencyByAssetId = useMemo(() => {
    const next: Record<string, NimiRuntimeLocalEnvironmentPlanDependency> = {};
    for (const asset of assets) {
      if (asset.kind !== 'image') {
        continue;
      }
      const assetDependency = firstBlockingDependency(runtimeEnvironmentPlanByAssetId[asset.localAssetId]);
      if (assetDependency) {
        next[asset.localAssetId] = assetDependency;
      }
    }
    return next;
  }, [assets, runtimeEnvironmentPlanByAssetId]);

  const setupRuntimeDependency = useCallback(async () => {
    const startable = allRuntimeDependencies.filter((dependency) => dependencyStartable(dependency, sharedRuntimeDependencyJobs));
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
        consumerScope: dependency.consumerScope,
      }, { caller: 'core' })));
      if (mountedRef.current) {
        setSharedRuntimeDependencyJobs((prev) => dedupeRuntimeDependencyJobs([...startedJobs, ...prev]));
      }
      await refreshAssetInventorySections();
      refreshRuntimeDependencies();
      await refreshRuntimeDependencyJobs(allRuntimeDependencies);
    } finally {
      setAssetBusy(false);
    }
  }, [
    allRuntimeDependencies,
    refreshAssetInventorySections,
    refreshRuntimeDependencies,
    refreshRuntimeDependencyJobs,
    setAssetBusy,
    sharedRuntimeDependencyJobs,
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
      const startable = plan.dependencies.filter((dependency) => (
        dependencyStartable(dependency, jobs) && !dependency.confirmationRequired
      ));
      await Promise.all(startable.map((dependency) => runtimeConfigLocalModelCenterClient.startEnvironmentDependencyJob({
        environmentKey: dependency.environmentKey,
        dependencyFamily: dependency.dependencyFamily,
        dependencyId: dependency.dependencyId,
        sourceKind: dependency.sourceKind,
        confirmed: false,
        consumerScope: dependency.consumerScope,
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
      await refreshRuntimeDependencyJobs(allRuntimeDependencies);
    } finally {
      setAssetBusy(false);
    }
  }, [allRuntimeDependencies, refreshRuntimeDependencies, refreshRuntimeDependencyJobs, setAssetBusy]);

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
      await refreshRuntimeDependencyJobs(allRuntimeDependencies);
    } finally {
      setAssetBusy(false);
    }
  }, [allRuntimeDependencies, refreshRuntimeDependencies, refreshRuntimeDependencyJobs, setAssetBusy]);

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
        consumerScope: sharedRuntimeDependency.consumerScope,
      }, { caller: 'core' });
      if (mountedRef.current) {
        setSharedRuntimeDependencyJobs((prev) => upsertRuntimeDependencyJob(prev, repairJob));
      }
      refreshRuntimeDependencies();
      await refreshRuntimeDependencyJobs(allRuntimeDependencies);
    } finally {
      setAssetBusy(false);
    }
  }, [allRuntimeDependencies, refreshRuntimeDependencies, refreshRuntimeDependencyJobs, setAssetBusy, sharedRuntimeDependency]);

  return {
    cancelRuntimeDependencyJob,
    refreshRuntimeDependencies,
    repairRuntimeDependency,
    prepareAssetRuntimeDependencies,
    retryRuntimeDependencyJob,
    runtimeDependencyByAssetId,
    runtimeDependencyError,
    setupRuntimeDependency,
    sharedRuntimeDependency,
    sharedRuntimeDependencyJobs,
    sharedRuntimeEnvironmentPlan,
  };
}
