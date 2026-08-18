import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  type NimiRuntimeLocalEnvironmentDependencyJob,
  type NimiRuntimeLocalEnvironmentPlan,
  type NimiRuntimeLocalEnvironmentPlanInput,
  type NimiRuntimeLocalEnvironmentPlanDependency,
  type NimiRuntimeLocalAssetAdminClient,
} from '@nimiplatform/sdk/runtime';
import { ConfirmDialog, Surface, cn } from '@nimiplatform/kit/ui';

import { Button } from './runtime-config-primitives.js';
import { useRuntimeConfigLocalAssetAdminClient } from './runtime-config-local-model-center-sdk-service.js';
import { formatBytes } from './runtime-config-model-center-utils.js';
import {
  resolveRuntimeConfigLocalEnvironmentPlan,
  type RuntimeConfigLocalCapabilityContract,
} from './runtime-config-local-capability-environment-service.js';
import {
  TOKEN_PANEL_CARD,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
} from './runtime-config-runtime-page-ui.js';

const LOCAL_ENVIRONMENT_CAPABILITIES = [
  { slice: 'text', capabilityContract: 'text.generate' },
  { slice: 'image', capabilityContract: 'image.generate' },
  { slice: 'tts', capabilityContract: 'audio.synthesize' },
  { slice: 'stt', capabilityContract: 'audio.transcribe' },
  { slice: 'voice', capabilityContract: 'voice.create' },
] as const satisfies readonly {
  readonly slice: string;
  readonly capabilityContract: RuntimeConfigLocalCapabilityContract;
}[];

type LocalCapabilitySlice = (typeof LOCAL_ENVIRONMENT_CAPABILITIES)[number]['slice'];

type PendingCapabilityAction = {
  readonly slice: LocalCapabilitySlice;
  readonly plan: NimiRuntimeLocalEnvironmentPlan;
  readonly resolution: NimiRuntimeLocalEnvironmentPlanInput;
};

type LocalCapabilityPlan = {
  readonly slice: LocalCapabilitySlice;
  readonly plan: NimiRuntimeLocalEnvironmentPlan;
  readonly resolution: NimiRuntimeLocalEnvironmentPlanInput;
};

type LocalCapabilityError = {
  readonly slice?: LocalCapabilitySlice;
  readonly detail: string;
};

function latestDependencyJob(
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
  dependency: NimiRuntimeLocalEnvironmentPlanDependency,
): NimiRuntimeLocalEnvironmentDependencyJob | undefined {
  return jobs
    .filter((job) => job.environmentKey === dependency.environmentKey
      && job.dependencyFamily === dependency.dependencyFamily
      && job.dependencyId === dependency.dependencyId
      && job.consumerScope === dependency.consumerScope)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function hasRuntimeOwnedCapabilityConfirmation(plan: NimiRuntimeLocalEnvironmentPlan): boolean {
  const confirmedFamilies = new Set(plan.requiredDependencyFamilies);
  return plan.noSystemMutation
    && plan.requiredDependencyFamilies.length > 0
    && plan.dependencies.every((dependency) => !dependency.required || confirmedFamilies.has(dependency.dependencyFamily))
    && plan.storageCategories.length > 0
    && plan.sourceOwners.length > 0;
}

export function canSubmitRuntimeConfigLocalCapabilityEnvironmentPlan(
  plan: NimiRuntimeLocalEnvironmentPlan,
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
): boolean {
  if (!hasRuntimeOwnedCapabilityConfirmation(plan) || plan.state === 'unsupported') return false;
  return plan.dependencies.some((dependency) => {
    if (!dependency.required || isNimiRuntimeLocalEnvironmentDependencyReadyState(dependency.state)) return false;
    const job = latestDependencyJob(jobs, dependency);
    return !job || !isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state);
  });
}

export function resolveRuntimeConfigLocalCapabilityConfirmationProjection(
  plan: NimiRuntimeLocalEnvironmentPlan,
): {
  readonly families: string;
  readonly aggregateSizeKnown: boolean;
  readonly aggregateSizeBytes: number;
  readonly storageCategories: string;
  readonly sourceOwners: string;
  readonly noSystemMutation: boolean;
} {
  return {
    families: plan.requiredDependencyFamilies.join(', '),
    aggregateSizeKnown: plan.aggregateSizeKnown,
    aggregateSizeBytes: plan.aggregateSizeBytes,
    storageCategories: plan.storageCategories.join(', '),
    sourceOwners: plan.sourceOwners.join(', '),
    noSystemMutation: plan.noSystemMutation,
  };
}

export async function submitRuntimeConfigLocalCapabilityEnvironmentPlan(
  localEnvironment: Pick<NimiRuntimeLocalAssetAdminClient, 'applyEnvironmentPlan'>,
  resolution: NimiRuntimeLocalEnvironmentPlanInput,
  plan: NimiRuntimeLocalEnvironmentPlan,
) {
  return localEnvironment.applyEnvironmentPlan({
    resolution,
    expectedPlanId: plan.planId,
    confirmed: true,
  }, { caller: 'core' });
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'LOCAL_CAPABILITY_ENVIRONMENT_UNAVAILABLE');
}

export function RuntimeConfigLocalCapabilityEnvironmentPanel(props: {
  readonly writesDisabled: boolean;
}) {
  const { t } = useTranslation();
  const localEnvironment = useRuntimeConfigLocalAssetAdminClient();
  const [plans, setPlans] = useState<readonly LocalCapabilityPlan[]>([]);
  const [jobs, setJobs] = useState<readonly NimiRuntimeLocalEnvironmentDependencyJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [errors, setErrors] = useState<readonly LocalCapabilityError[]>([]);
  const [pending, setPending] = useState<PendingCapabilityAction | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setErrors([]);
    try {
      const results = await Promise.allSettled(LOCAL_ENVIRONMENT_CAPABILITIES.map(({ capabilityContract }) => (
        resolveRuntimeConfigLocalEnvironmentPlan({ capabilityContract, localEnvironment })
      )));
      const nextPlans: LocalCapabilityPlan[] = [];
      const nextErrors: LocalCapabilityError[] = [];
      results.forEach((result, index) => {
        const slice = LOCAL_ENVIRONMENT_CAPABILITIES[index]?.slice;
        if (!slice) return;
        if (result.status === 'fulfilled') {
          nextPlans.push({ slice, plan: result.value.plan, resolution: result.value.resolution });
          return;
        }
        const detail = errorDetail(result.reason);
        if (!detail.endsWith('_SELECTION_NOT_FOUND')) {
          nextErrors.push({ slice, detail });
        }
      });
      const environmentKeys = new Set(
        nextPlans.flatMap(({ plan: nextPlan }) => nextPlan.dependencies.map((dependency) => dependency.environmentKey)),
      );
      const nextJobs = (await localEnvironment.listEnvironmentDependencyJobs())
        .filter((job) => environmentKeys.has(job.environmentKey));
      setPlans(nextPlans);
      setJobs(nextJobs);
      setErrors(nextErrors);
    } catch (nextError) {
      setPlans([]);
      setJobs([]);
      setErrors([{ detail: errorDetail(nextError) }]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [localEnvironment]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasActiveJob = jobs.some((job) => isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state));
  useEffect(() => {
    if (!hasActiveJob) return undefined;
    const timer = window.setInterval(() => void refresh(true), 1_000);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, refresh]);

  const runConfirmedAction = useCallback(async () => {
    if (!pending) return;
    const key = `${pending.slice}:setup`;
    setBusyKey(key);
    setErrors([]);
    try {
      await submitRuntimeConfigLocalCapabilityEnvironmentPlan(localEnvironment, pending.resolution, pending.plan);
      setPending(null);
      await refresh(true);
    } catch (nextError) {
      setErrors([{ slice: pending.slice, detail: errorDetail(nextError) }]);
    } finally {
      setBusyKey('');
    }
  }, [localEnvironment, pending, refresh]);

  const cancelJobs = useCallback(async (
    slice: LocalCapabilitySlice,
    activeJobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
  ) => {
    setBusyKey(`${slice}:cancel`);
    setErrors([]);
    try {
      const results = await Promise.allSettled(activeJobs.map((job) => (
        localEnvironment.cancelEnvironmentDependencyJob({ jobId: job.jobId }, { caller: 'core' })
      )));
      await refresh(true);
      const failures = results.flatMap((result) => (
        result.status === 'rejected' ? [{ slice, detail: errorDetail(result.reason) }] : []
      ));
      if (failures.length > 0) setErrors(failures);
    } catch (nextError) {
      setErrors([{ slice, detail: errorDetail(nextError) }]);
    } finally {
      setBusyKey('');
    }
  }, [localEnvironment, refresh]);

  return (
    <>
      <Surface
        tone="card"
        data-testid="runtime-local-capability-environment"
        className={cn(TOKEN_PANEL_CARD, 'overflow-hidden p-5')}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className={cn('text-base font-semibold', TOKEN_TEXT_PRIMARY)}>
              {t('runtimeConfig.environment.localCapabilityTitle')}
            </h2>
            <p className={cn('mt-1 text-xs', TOKEN_TEXT_MUTED)}>
              {t('runtimeConfig.environment.localCapabilityDescription')}
            </p>
          </div>
          <Button variant="secondary" size="sm" disabled={loading || Boolean(busyKey)} onClick={() => void refresh()}>
            {loading
              ? t('runtimeConfig.environment.localCapabilityLoading')
              : t('runtimeConfig.environment.localCapabilityRefresh')}
          </Button>
        </div>

        {errors.map((failure) => (
          <div
            key={`${failure.slice || 'capability'}:${failure.detail}`}
            className="mt-4 rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]"
          >
            {t('runtimeConfig.environment.localCapabilityPreflightFailure', {
              capability: failure.slice ? t(`runtimeConfig.environment.localCapability${failure.slice.toUpperCase()}`) : t('runtimeConfig.environment.localCapabilityLabel'),
              detail: failure.detail,
            })}
          </div>
        ))}

        {!loading && plans.length === 0 && errors.length === 0 ? (
          <div className={cn('mt-4 text-xs', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.environment.localCapabilityNotConfigured')}
          </div>
        ) : null}

        {plans.map(({ slice, plan, resolution }) => {
          const activeJobs = plan.dependencies.flatMap((dependency) => {
            const job = latestDependencyJob(jobs, dependency);
            return job && isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state) ? [job] : [];
          });
          const capabilityBusy = busyKey.startsWith(`${slice}:`);
          const canApply = canSubmitRuntimeConfigLocalCapabilityEnvironmentPlan(plan, jobs);
          return (
          <div key={slice} className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
                {t('runtimeConfig.environment.localCapabilitySliceTitle', {
                  capability: t(`runtimeConfig.environment.localCapability${slice.toUpperCase()}`),
                })}
              </h3>
              <div className="flex shrink-0 gap-2">
              {activeJobs.length > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={capabilityBusy || props.writesDisabled}
                  onClick={() => void cancelJobs(slice, activeJobs)}
                >
                  {t('runtimeConfig.environment.localCapabilityCancel')}
                </Button>
              ) : null}
              {canApply ? (
                <Button
                  size="sm"
                  disabled={capabilityBusy || props.writesDisabled}
                  onClick={() => setPending({ slice, plan, resolution })}
                >
                  {t('runtimeConfig.environment.localCapabilitySetup')}
                </Button>
              ) : null}
              </div>
            </div>
            {plan.dependencies.map((dependency) => {
              const job = latestDependencyJob(jobs, dependency);
              const active = Boolean(job && isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state));
              const ready = isNimiRuntimeLocalEnvironmentDependencyReadyState(dependency.state);
              const state = active && job ? job.state : dependency.state;
              const progress = active && job && job.bytesTotal > 0
                ? t('runtimeConfig.environment.localCapabilityProgress', { percent: Math.round(job.percent) })
                : '';
              return (
                <div
                  key={`${slice}:${dependency.environmentKey}:${dependency.dependencyId}`}
                  className="rounded-xl border border-[var(--nimi-border-subtle)] px-3 py-3"
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0">
                      <div className={cn('text-sm font-medium', TOKEN_TEXT_PRIMARY)}>
                        {dependency.dependencyFamily}
                      </div>
                      <div className={cn('mt-0.5 break-all text-xs', TOKEN_TEXT_MUTED)}>
                        {dependency.dependencyId}
                      </div>
                      <div className={cn('mt-1 text-xs', ready ? 'text-[var(--nimi-status-success)]' : TOKEN_TEXT_MUTED)}>
                        {state}{progress ? ` · ${progress}` : ''}
                        {dependency.reasonCode ? ` · ${dependency.reasonCode}` : ''}
                      </div>
                      <div className={cn('mt-1 break-all text-xs', TOKEN_TEXT_MUTED)} data-testid="runtime-environment-dependency-supply">
                        {dependency.sourceKind} · {dependency.consumerScope}
                        {dependency.dependencyFamily.startsWith('python.') ? ` · ${t('runtimeConfig.environment.localCapabilityExactLock')}` : ''}
                        {dependency.canonicalRoot ? ` · ${dependency.canonicalRoot}` : ''}
                      </div>
                      {dependency.detail || (active ? job?.failureDetail : '') ? (
                        <div className="mt-1 text-xs text-[var(--nimi-status-danger)]">
                          {t('runtimeConfig.environment.localCapabilityDependencyFailure', {
                            capability: t(`runtimeConfig.environment.localCapability${slice.toUpperCase()}`),
                            detail: dependency.detail || (active ? job?.failureDetail : ''),
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          );
        })}
      </Surface>

      <ConfirmDialog
        open={Boolean(pending)}
        title={t('runtimeConfig.environment.localCapabilityConfirmTitle')}
        message={pending
          ? (() => {
              const projection = resolveRuntimeConfigLocalCapabilityConfirmationProjection(pending.plan);
              return t('runtimeConfig.environment.localCapabilityConfirmMessage', {
                family: projection.families,
                aggregateSize: projection.aggregateSizeKnown
                  ? formatBytes(projection.aggregateSizeBytes)
                  : t('runtimeConfig.environment.localCapabilityAggregateSizeUnknown'),
                storageCategory: projection.storageCategories,
                sourceOwner: projection.sourceOwners,
                mutationPolicy: projection.noSystemMutation
                  ? t('runtimeConfig.environment.localCapabilityNoSystemMutation')
                  : t('runtimeConfig.environment.localCapabilitySystemMutationPolicyUnknown'),
                root: pending.plan.runtimeDataRoot || '-',
              });
            })()
          : ''}
        confirmLabel={t('runtimeConfig.environment.localCapabilityConfirm')}
        cancelLabel={t('runtimeConfig.environment.localCapabilityCancel')}
        pending={Boolean(busyKey)}
        onConfirm={() => void runConfirmedAction()}
        onClose={() => setPending(null)}
      />
    </>
  );
}
