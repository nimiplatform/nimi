import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyJobRetryableState,
  isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState,
  isNimiRuntimeLocalEnvironmentDependencyStartableState,
  type NimiRuntimeLocalEnvironmentDependencyJob,
  type NimiRuntimeLocalEnvironmentPlan,
  type NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import { ConfirmDialog, Surface, cn } from '@nimiplatform/kit/ui';

import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { Button } from './runtime-config-primitives.js';
import { useRuntimeConfigLocalAssetAdminClient } from './runtime-config-local-model-center-sdk-service.js';
import {
  resolveRuntimeConfigLocalASREnvironmentPlan,
  resolveRuntimeConfigLocalTTSEnvironmentPlan,
} from './runtime-config-local-speech-environment-service.js';
import {
  TOKEN_PANEL_CARD,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
} from './runtime-config-runtime-page-ui.js';

type PendingDependencyAction = {
  readonly kind: 'start' | 'repair' | 'retry';
  readonly slice: LocalSpeechSlice;
  readonly plan: NimiRuntimeLocalEnvironmentPlan;
  readonly dependency: NimiRuntimeLocalEnvironmentPlanDependency;
  readonly job?: NimiRuntimeLocalEnvironmentDependencyJob;
};

type LocalSpeechSlice = 'tts' | 'stt';

type LocalSpeechPlan = {
  readonly slice: LocalSpeechSlice;
  readonly plan: NimiRuntimeLocalEnvironmentPlan;
};

type LocalSpeechError = {
  readonly slice?: LocalSpeechSlice;
  readonly detail: string;
};

function latestDependencyJob(
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
  dependency: NimiRuntimeLocalEnvironmentPlanDependency,
): NimiRuntimeLocalEnvironmentDependencyJob | undefined {
  return jobs
    .filter((job) => job.environmentKey === dependency.environmentKey
      && job.dependencyFamily === dependency.dependencyFamily
      && job.dependencyId === dependency.dependencyId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'LOCAL_SPEECH_ENVIRONMENT_UNAVAILABLE');
}

export function RuntimeConfigLocalSpeechEnvironmentPanel(props: {
  readonly writesDisabled: boolean;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const localEnvironment = useRuntimeConfigLocalAssetAdminClient();
  const machineConfiguration = useMemo(
    () => sdk.machineProduct().local.aiConfiguration,
    [sdk],
  );
  const [plans, setPlans] = useState<readonly LocalSpeechPlan[]>([]);
  const [jobs, setJobs] = useState<readonly NimiRuntimeLocalEnvironmentDependencyJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [errors, setErrors] = useState<readonly LocalSpeechError[]>([]);
  const [pending, setPending] = useState<PendingDependencyAction | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setErrors([]);
    try {
      const results = await Promise.allSettled([
        resolveRuntimeConfigLocalTTSEnvironmentPlan({ machineConfiguration, localEnvironment }),
        resolveRuntimeConfigLocalASREnvironmentPlan({ machineConfiguration, localEnvironment }),
      ]);
      const slices: readonly LocalSpeechSlice[] = ['tts', 'stt'];
      const nextPlans: LocalSpeechPlan[] = [];
      const nextErrors: LocalSpeechError[] = [];
      results.forEach((result, index) => {
        const slice = slices[index];
        if (!slice) return;
        if (result.status === 'fulfilled') {
          nextPlans.push({ slice, plan: result.value });
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
  }, [localEnvironment, machineConfiguration]);

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
    const key = `${pending.dependency.environmentKey}:${pending.kind}`;
    setBusyKey(key);
    setErrors([]);
    try {
      if (pending.kind === 'retry') {
        if (!pending.job) throw new Error('LOCAL_SPEECH_DEPENDENCY_RETRY_JOB_REQUIRED');
        await localEnvironment.retryEnvironmentDependencyJob({
          jobId: pending.job.jobId,
          confirmed: true,
        }, { caller: 'core' });
      } else if (pending.kind === 'repair') {
        await localEnvironment.repairEnvironmentDependency({
          environmentKey: pending.dependency.environmentKey,
          dependencyFamily: pending.dependency.dependencyFamily,
          dependencyId: pending.dependency.dependencyId,
          confirmed: true,
          reasonCode: pending.dependency.reasonCode,
          consumerScope: pending.dependency.consumerScope,
        }, { caller: 'core' });
      } else {
        await localEnvironment.startEnvironmentDependencyJob({
          environmentKey: pending.dependency.environmentKey,
          dependencyFamily: pending.dependency.dependencyFamily,
          dependencyId: pending.dependency.dependencyId,
          sourceKind: pending.dependency.sourceKind,
          confirmed: true,
          consumerScope: pending.dependency.consumerScope,
        }, { caller: 'core' });
      }
      setPending(null);
      await refresh(true);
    } catch (nextError) {
      setErrors([{ slice: pending.slice, detail: errorDetail(nextError) }]);
    } finally {
      setBusyKey('');
    }
  }, [localEnvironment, pending, refresh]);

  const cancelJob = useCallback(async (job: NimiRuntimeLocalEnvironmentDependencyJob) => {
    setBusyKey(`${job.environmentKey}:cancel`);
    setErrors([]);
    try {
      await localEnvironment.cancelEnvironmentDependencyJob({ jobId: job.jobId }, { caller: 'core' });
      await refresh(true);
    } catch (nextError) {
      setErrors([{ detail: errorDetail(nextError) }]);
    } finally {
      setBusyKey('');
    }
  }, [localEnvironment, refresh]);

  return (
    <>
      <Surface
        tone="card"
        data-testid="runtime-local-speech-environment"
        className={cn(TOKEN_PANEL_CARD, 'overflow-hidden p-5')}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className={cn('text-base font-semibold', TOKEN_TEXT_PRIMARY)}>
              {t('runtimeConfig.environment.localSpeechTitle')}
            </h2>
            <p className={cn('mt-1 text-xs', TOKEN_TEXT_MUTED)}>
              {t('runtimeConfig.environment.localSpeechDescription')}
            </p>
          </div>
          <Button variant="secondary" size="sm" disabled={loading || Boolean(busyKey)} onClick={() => void refresh()}>
            {loading
              ? t('runtimeConfig.environment.localSpeechLoading')
              : t('runtimeConfig.environment.localSpeechRefresh')}
          </Button>
        </div>

        {errors.map((failure) => (
          <div
            key={`${failure.slice || 'speech'}:${failure.detail}`}
            className="mt-4 rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]"
          >
            {t('runtimeConfig.environment.localSpeechPreflightFailure', {
              capability: failure.slice ? t(`runtimeConfig.environment.localSpeech${failure.slice.toUpperCase()}`) : t('runtimeConfig.environment.localSpeechCapability'),
              detail: failure.detail,
            })}
          </div>
        ))}

        {!loading && plans.length === 0 && errors.length === 0 ? (
          <div className={cn('mt-4 text-xs', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.environment.localSpeechNotConfigured')}
          </div>
        ) : null}

        {plans.map(({ slice, plan }) => (
          <div key={slice} className="mt-4 space-y-2">
            <h3 className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
              {t('runtimeConfig.environment.localSpeechSliceTitle', {
                capability: t(`runtimeConfig.environment.localSpeech${slice.toUpperCase()}`),
              })}
            </h3>
            {plan.dependencies.map((dependency) => {
              const job = latestDependencyJob(jobs, dependency);
              const active = Boolean(job && isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state));
              const ready = isNimiRuntimeLocalEnvironmentDependencyReadyState(dependency.state);
              const repair = isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState(dependency.state);
              const retry = Boolean(job && isNimiRuntimeLocalEnvironmentDependencyJobRetryableState(job.state));
              const start = isNimiRuntimeLocalEnvironmentDependencyStartableState(dependency.state)
                && !repair && !retry;
              const state = job?.state || dependency.state;
              const progress = job && job.bytesTotal > 0
                ? t('runtimeConfig.environment.localSpeechProgress', { percent: Math.round(job.percent) })
                : '';
              const rowBusy = busyKey.startsWith(`${dependency.environmentKey}:`);
              return (
                <div
                  key={`${slice}:${dependency.environmentKey}:${dependency.dependencyId}`}
                  className="rounded-xl border border-[var(--nimi-border-subtle)] px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
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
                      {dependency.detail || job?.failureDetail ? (
                        <div className="mt-1 text-xs text-[var(--nimi-status-danger)]">
                          {t('runtimeConfig.environment.localSpeechDependencyFailure', {
                            capability: t(`runtimeConfig.environment.localSpeech${slice.toUpperCase()}`),
                            detail: dependency.detail || job?.failureDetail,
                          })}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {active && job ? (
                        <Button variant="secondary" size="sm" disabled={rowBusy || props.writesDisabled} onClick={() => void cancelJob(job)}>
                          {t('runtimeConfig.environment.localSpeechCancel')}
                        </Button>
                      ) : null}
                      {!active && repair ? (
                        <Button size="sm" disabled={rowBusy || props.writesDisabled} onClick={() => setPending({ kind: 'repair', slice, plan, dependency })}>
                          {t('runtimeConfig.environment.localSpeechRepair')}
                        </Button>
                      ) : null}
                      {!active && retry && job ? (
                        <Button size="sm" disabled={rowBusy || props.writesDisabled} onClick={() => setPending({ kind: 'retry', slice, plan, dependency, job })}>
                          {t('runtimeConfig.environment.localSpeechRetry')}
                        </Button>
                      ) : null}
                      {!active && start ? (
                        <Button size="sm" disabled={rowBusy || props.writesDisabled} onClick={() => setPending({ kind: 'start', slice, plan, dependency })}>
                          {isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState(dependency.state)
                            ? t('runtimeConfig.environment.localSpeechSetup')
                            : t('runtimeConfig.environment.localSpeechStart')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </Surface>

      <ConfirmDialog
        open={Boolean(pending)}
        title={t('runtimeConfig.environment.localSpeechConfirmTitle')}
        message={pending
          ? t('runtimeConfig.environment.localSpeechConfirmMessage', {
              family: pending.dependency.dependencyFamily,
              source: pending.dependency.sourceKind,
              root: pending.dependency.canonicalRoot || pending.plan.runtimeDataRoot || '-',
            })
          : ''}
        confirmLabel={t('runtimeConfig.environment.localSpeechConfirm')}
        cancelLabel={t('runtimeConfig.environment.localSpeechCancel')}
        pending={Boolean(busyKey)}
        onConfirm={() => void runConfirmedAction()}
        onClose={() => setPending(null)}
      />
    </>
  );
}
