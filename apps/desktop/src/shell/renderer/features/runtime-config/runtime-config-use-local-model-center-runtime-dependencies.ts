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
import { useRuntimeConfigLocalAssetAdminClient } from './runtime-config-local-model-center-sdk-service';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
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
  return assets.filter(isImageRuntimeMainAsset);
}

function isImageRuntimeMainAsset(asset: NimiRuntimeLocalAssetRecord): boolean {
  if (asset.kind !== 'image') {
    return false;
  }
  const artifactRoles = new Set((asset.artifactRoles || []).map((role) => String(role || '').trim().toLowerCase()));
  return !artifactRoles.has('uncond_diffusion_model');
}

export function localModelCenterDependencyBlocksSetup(
  dependency: NimiRuntimeLocalEnvironmentPlanDependency,
): boolean {
  // Model Center resolves one asset at a time and has no AI Config workflow
  // context. Companion selections are validated later from profile_entries.
  if (dependency.reasonCode === 'LOCAL_ENVIRONMENT_IMAGE_PROFILE_BINDINGS_REQUIRED') {
    return false;
  }
  if (!dependency.required) {
    return false;
  }
  return !isNimiRuntimeLocalEnvironmentDependencyReadyState(dependency.state);
}

function firstBlockingDependency(plan: NimiRuntimeLocalEnvironmentPlan | undefined): NimiRuntimeLocalEnvironmentPlanDependency | undefined {
  return plan?.dependencies.find(localModelCenterDependencyBlocksSetup);
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
  const runtimeConfigLocalAssetAdminClient = useRuntimeConfigLocalAssetAdminClient();
  const bindings = useDesktopRendererBindings();
  const mountedRef = useRef(true);
  const autoRetryAttemptedKeysRef = useRef<Set<string>>(new Set());
  const [sharedRuntimeEnvironmentPlan, setSharedRuntimeEnvironmentPlan] = useState<NimiRuntimeLocalEnvironmentPlan | undefined>(undefined);
  const [runtimeEnvironmentPlanByLocalAssetId, setRuntimeEnvironmentPlanByLocalAssetId] = useState<Record<string, NimiRuntimeLocalEnvironmentPlan | undefined>>({});
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
        const plan = await runtimeConfigLocalAssetAdminClient.resolveEnvironmentPlan({
          packId: 'local-gpu-support',
          consumerScope: 'desktop.local-model-center',
        });
        return { sharedPlan: plan, byLocalAssetId: {} };
      }
      const resolved = await Promise.all(currentImageAssets.map(async (asset) => ({
        localAssetId: asset.localAssetId,
        plan: await resolveNimiRuntimeLocalImageNativeEnvironmentPlan({
          runtime: runtimeConfigLocalAssetAdminClient,
          asset,
        }),
      })));
      const byLocalAssetId: Record<string, NimiRuntimeLocalEnvironmentPlan | undefined> = {};
      const plans: NimiRuntimeLocalEnvironmentPlan[] = [];
      for (const item of resolved) {
        byLocalAssetId[item.localAssetId] = item.plan;
        plans.push(item.plan);
      }
      return {
        sharedPlan: firstPlanWithBlockingDependency(plans) || plans[0],
        byLocalAssetId,
      };
    };
    void resolvePlan().then((resolution) => {
      if (!cancelled && mountedRef.current) {
        setSharedRuntimeEnvironmentPlan(resolution.sharedPlan);
        setRuntimeEnvironmentPlanByLocalAssetId(resolution.byLocalAssetId);
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
    const assetPlans = Object.values(runtimeEnvironmentPlanByLocalAssetId).filter((plan): plan is NimiRuntimeLocalEnvironmentPlan => Boolean(plan));
    if (assetPlans.length > 0) {
      return assetPlans;
    }
    return sharedRuntimeEnvironmentPlan ? [sharedRuntimeEnvironmentPlan] : [];
  }, [runtimeEnvironmentPlanByLocalAssetId, sharedRuntimeEnvironmentPlan]);

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
        runtimeConfigLocalAssetAdminClient.listEnvironmentDependencyJobs({ environmentKey: dependency.environmentKey })));
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
          runtimeConfigLocalAssetAdminClient.retryEnvironmentDependencyJob({
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
    let cancelNext: (() => void) | null = null;
    const tick = async () => {
      await refreshRuntimeDependencyJobs(allRuntimeDependencies);
      await refreshAssetInventorySections();
      if (cancelled || !mountedRef.current) return;
      refreshRuntimeDependencies();
      cancelNext = bindings.clock.schedule(2_000, (result) => {
        cancelNext = null;
        if (result.ok) void tick();
      });
    };
    void tick();
    return () => {
      cancelled = true;
      cancelNext?.();
      cancelNext = null;
    };
  }, [
    bindings.clock,
    hasActiveRuntimeDependencyJob,
    allRuntimeDependencies,
    refreshAssetInventorySections,
    refreshRuntimeDependencies,
    refreshRuntimeDependencyJobs,
  ]);

  const runtimeDependencyByLocalAssetId = useMemo(() => {
    const next: Record<string, NimiRuntimeLocalEnvironmentPlanDependency> = {};
    for (const asset of assets) {
      if (!isImageRuntimeMainAsset(asset)) {
        continue;
      }
      const assetDependency = firstBlockingDependency(runtimeEnvironmentPlanByLocalAssetId[asset.localAssetId]);
      if (assetDependency) {
        next[asset.localAssetId] = assetDependency;
      }
    }
    return next;
  }, [assets, runtimeEnvironmentPlanByLocalAssetId]);

  const setupRuntimeDependency = useCallback(async () => {
    const startable = allRuntimeDependencies.filter((dependency) => dependencyStartable(dependency, sharedRuntimeDependencyJobs));
    if (startable.length === 0) {
      return;
    }
    setAssetBusy(true);
    try {
      const startedJobs = await Promise.all(startable.map((dependency) => runtimeConfigLocalAssetAdminClient.startEnvironmentDependencyJob({
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
    if (!isImageRuntimeMainAsset(asset)) {
      return;
    }
    setAssetBusy(true);
    try {
      const plan = await resolveNimiRuntimeLocalImageNativeEnvironmentPlan({
        runtime: runtimeConfigLocalAssetAdminClient,
        asset,
      });
      const jobGroups = await Promise.all(plan.dependencies
        .filter((dependency) => dependency.environmentKey)
        .map((dependency) => runtimeConfigLocalAssetAdminClient.listEnvironmentDependencyJobs({ environmentKey: dependency.environmentKey })));
      const jobs = jobGroups.flat();
      const startable = plan.dependencies.filter((dependency) => (
        dependencyStartable(dependency, jobs) && !dependency.confirmationRequired
      ));
      await Promise.all(startable.map((dependency) => runtimeConfigLocalAssetAdminClient.startEnvironmentDependencyJob({
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
      const cancelledJob = await runtimeConfigLocalAssetAdminClient.cancelEnvironmentDependencyJob({ jobId }, { caller: 'core' });
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
      const retryJob = await runtimeConfigLocalAssetAdminClient.retryEnvironmentDependencyJob({
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
      const repairJob = await runtimeConfigLocalAssetAdminClient.repairEnvironmentDependency({
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
    runtimeDependencyByLocalAssetId,
    runtimeDependencyError,
    setupRuntimeDependency,
    sharedRuntimeDependency,
    sharedRuntimeDependencyJobs,
    sharedRuntimeEnvironmentPlan,
  };
}
