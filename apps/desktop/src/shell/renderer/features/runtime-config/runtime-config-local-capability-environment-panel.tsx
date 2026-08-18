import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  type NimiRuntimeLocalEnvironmentDependencyJob,
  type NimiRuntimeLocalEnvironmentPlan,
  type NimiRuntimeLocalEnvironmentPlanInput,
  type NimiRuntimeLocalEnvironmentPlanDependency,
  type NimiRuntimeLocalEnvironmentClient,
} from '@nimiplatform/sdk/runtime';
import { ConfirmDialog, Surface, cn } from '@nimiplatform/kit/ui';

import { Button } from './runtime-config-primitives.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
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
  { slice: 'video', capabilityContract: 'video.generate' },
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

export function projectRuntimeConfigLocalCapabilityEnvironmentState(
  plan: NimiRuntimeLocalEnvironmentPlan,
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
): {
  readonly state: 'ready' | 'active' | 'attention' | 'unsupported';
  readonly requiredCount: number;
  readonly attentionCount: number;
  readonly activeJobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[];
} {
  const required = plan.dependencies.filter((dependency) => dependency.required);
  const activeJobs = required.flatMap((dependency) => {
    const job = latestDependencyJob(jobs, dependency);
    return job && isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state) ? [job] : [];
  });
  const attentionCount = required.filter(
    (dependency) => !isNimiRuntimeLocalEnvironmentDependencyReadyState(dependency.state),
  ).length;
  const state = plan.state === 'unsupported'
    ? 'unsupported'
    : activeJobs.length > 0
      ? 'active'
      : attentionCount > 0
        ? 'attention'
        : 'ready';
  return Object.freeze({ state, requiredCount: required.length, attentionCount, activeJobs: Object.freeze(activeJobs) });
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
  localEnvironment: Pick<NimiRuntimeLocalEnvironmentClient, 'applyEnvironmentPlan'>,
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
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const localEnvironment = useRuntimeConfigLocalEnvironmentClient();
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

  const planPresentations = plans.map((item) => ({
    ...item,
    presentation: projectRuntimeConfigLocalCapabilityEnvironmentState(item.plan, jobs),
  }));
  const readyCount = planPresentations.filter((item) => item.presentation.state === 'ready').length;
  const textReady = planPresentations.some((item) => item.slice === 'text' && item.presentation.state === 'ready');

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
            {!loading && planPresentations.length > 0 ? (
              <p className={cn('mt-2 text-xs font-semibold', readyCount === planPresentations.length ? 'text-[var(--nimi-status-success)]' : TOKEN_TEXT_MUTED)}>
                {readyCount === planPresentations.length
                  ? t('runtimeConfig.environment.localCapabilityAllReady', { count: readyCount })
                  : t('runtimeConfig.environment.localCapabilityReadyCount', { ready: readyCount, total: planPresentations.length })}
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={loading || Boolean(busyKey)} onClick={() => void refresh()}>
              {loading
                ? t('runtimeConfig.environment.localCapabilityLoading')
                : t('runtimeConfig.environment.localCapabilityRefresh')}
            </Button>
            {textReady ? (
              <Button size="sm" onClick={() => setActiveTab('chat')}>
                {t('runtimeConfig.environment.localCapabilityTryText')}
              </Button>
            ) : null}
          </div>
        </div>

        {errors.map((failure) => (
          <div
            key={`${failure.slice || 'capability'}:${failure.detail}`}
            className="mt-4 rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]"
          >
            <div className="font-semibold">
              {t('runtimeConfig.environment.localCapabilityUnavailable', {
                capability: failure.slice ? t(`runtimeConfig.environment.localCapability${failure.slice.toUpperCase()}`) : t('runtimeConfig.environment.localCapabilityLabel'),
              })}
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer font-semibold">{t('runtimeConfig.environment.localCapabilityTechnicalDetails')}</summary>
              <div className="mt-1 whitespace-pre-wrap break-all font-mono">{failure.detail}</div>
            </details>
          </div>
        ))}

        {!loading && plans.length === 0 && errors.length === 0 ? (
          <div className={cn('mt-4 text-xs', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.environment.localCapabilityNotConfigured')}
          </div>
        ) : null}

        {planPresentations.map(({ slice, plan, resolution, presentation }) => {
          const { activeJobs } = presentation;
          const capabilityBusy = busyKey.startsWith(`${slice}:`);
          const canApply = canSubmitRuntimeConfigLocalCapabilityEnvironmentPlan(plan, jobs);
          return (
          <div key={slice} className="mt-4 rounded-xl border border-[var(--nimi-border-subtle)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
                  {t(`runtimeConfig.environment.localCapability${slice.toUpperCase()}`)}
                </h3>
                <div className={cn('mt-1 text-xs', presentation.state === 'ready' ? 'text-[var(--nimi-status-success)]' : presentation.state === 'unsupported' || presentation.state === 'attention' ? 'text-[var(--nimi-status-danger)]' : TOKEN_TEXT_MUTED)}>
                  {presentation.state === 'ready'
                    ? t('runtimeConfig.environment.localCapabilityStateReady')
                    : presentation.state === 'active'
                      ? t('runtimeConfig.environment.localCapabilityStateInstalling')
                      : presentation.state === 'unsupported'
                        ? t('runtimeConfig.environment.localCapabilityStateUnsupported')
                        : t('runtimeConfig.environment.localCapabilityStateAttention', { count: presentation.attentionCount })}
                </div>
              </div>
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
            <details className="mt-3 text-xs text-[var(--nimi-text-muted)]">
              <summary className="cursor-pointer font-semibold">
                {t('runtimeConfig.environment.localCapabilityTechnicalDetailsCount', { count: plan.dependencies.length })}
              </summary>
              <div className="mt-2 grid gap-2">
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
                      className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-2"
                    >
                      <div className={cn('font-medium', TOKEN_TEXT_PRIMARY)}>{dependency.dependencyFamily}</div>
                      <div className="mt-0.5 break-all font-mono">{dependency.dependencyId}</div>
                      <div className={cn('mt-1', ready ? 'text-[var(--nimi-status-success)]' : TOKEN_TEXT_MUTED)}>
                        {state}{progress ? ` · ${progress}` : ''}{dependency.reasonCode ? ` · ${dependency.reasonCode}` : ''}
                      </div>
                      <div className="mt-1 break-all font-mono" data-testid="runtime-environment-dependency-supply">
                        {dependency.sourceKind} · {dependency.consumerScope}
                        {dependency.dependencyFamily.startsWith('python.') ? ` · ${t('runtimeConfig.environment.localCapabilityExactLock')}` : ''}
                        {dependency.canonicalRoot ? ` · ${dependency.canonicalRoot}` : ''}
                      </div>
                      {dependency.detail || (active ? job?.failureDetail : '') ? (
                        <div className="mt-1 whitespace-pre-wrap text-[var(--nimi-status-danger)]">
                          {dependency.detail || (active ? job?.failureDetail : '')}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </details>
          </div>
          );
        })}
      </Surface>

      <ConfirmDialog
        open={Boolean(pending)}
        title={t('runtimeConfig.environment.localCapabilityConfirmTitle', {
          capability: pending ? t(`runtimeConfig.environment.localCapability${pending.slice.toUpperCase()}`) : '',
        })}
        message={pending
          ? (() => {
              const projection = resolveRuntimeConfigLocalCapabilityConfirmationProjection(pending.plan);
              const attentionCount = pending.plan.dependencies.filter((dependency) => (
                dependency.required && !isNimiRuntimeLocalEnvironmentDependencyReadyState(dependency.state)
              )).length;
              return t('runtimeConfig.environment.localCapabilityConfirmMessage', {
                capability: t(`runtimeConfig.environment.localCapability${pending.slice.toUpperCase()}`),
                count: attentionCount,
                aggregateSize: projection.aggregateSizeKnown
                  ? formatBytes(projection.aggregateSizeBytes)
                  : t('runtimeConfig.environment.localCapabilityAggregateSizeUnknown'),
                mutationPolicy: projection.noSystemMutation
                  ? t('runtimeConfig.environment.localCapabilityNoSystemMutation')
                  : t('runtimeConfig.environment.localCapabilitySystemMutationPolicyUnknown'),
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
