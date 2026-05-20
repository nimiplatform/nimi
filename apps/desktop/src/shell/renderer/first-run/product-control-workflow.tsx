import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { loadPlatformAIProfileFactoryRows } from '../../../runtime/platform-catalog/index.js';
import { desktopBridge, type ProductControlRecordProjection, type ProductControlState } from '@renderer/bridge';
import { FirstRunFinalization } from './first-run-finalization.js';
import { selectFactoryAIProfileForFirstRun, type FirstRunInstallLevel } from './install-level-policy.js';
import {
  cancelFirstRunMaterializationJob,
  repairFirstRunMaterializationDependency,
  resolveFirstRunMaterializationProjection,
  retryFirstRunMaterializationJob,
  startFirstRunMaterialization,
  type FirstRunMaterializationDependencyProjection,
  type FirstRunMaterializationProjection,
} from './runtime-materialization.js';

type ProductControlWorkflowProps = {
  readonly projection: ProductControlRecordProjection | null;
  readonly onProjectionChange: (projection: ProductControlRecordProjection) => void;
};

/**
 * Spec-admitted product copy floor (first-run-state-machine.yaml). The English
 * default values mirror the spec verbatim; i18n keys under `FirstRun.states.*`
 * carry the localized projections without collapsing the per-state semantics
 * (cold-start-authority-contract P-COLD-014: no generic `ready`/`done`
 * collapse, no enum names as primary copy).
 */
const PRODUCT_COPY_DEFAULTS: Record<ProductControlState, { title: string; body: string }> = {
  not_logged_in: {
    title: 'Sign in to use Nimi.',
    body: 'Normal product use starts after an authenticated account session exists.',
  },
  config_missing: {
    title: 'Nimi is creating its local product record.',
    body: 'This is an internal setup step. Data location selection appears after the product record exists.',
  },
  data_root_missing: {
    title: 'Choose where Nimi stores models, apps, and large local data.',
    body: 'Use an absolute folder path. Nimi creates models, dependencies, apps, logs, audit, and cache roots there.',
  },
  data_root_selected: {
    title: 'Nimi is checking this device.',
    body: 'The selected data root is recorded. Choose a local install level before heavy setup starts.',
  },
  ai_environment_unconfigured: {
    title: 'Choose how much of the local Nimi environment to install.',
    body: 'Minimal and Recommended are local-only baselines. Cloud connectors remain post-initialization settings.',
  },
  local_ai_profile_selected_assets_missing: {
    title: 'Nimi is downloading and verifying required local models and dependencies.',
    body: 'Runtime-owned materialization progress must finish before normal product use opens.',
  },
  local_ai_profile_selected_environment_not_ready: {
    title: 'Nimi is preparing its managed local environment.',
    body: 'Runtime activation evidence is still missing or incomplete.',
  },
  local_ai_assets_downloaded_environment_not_ready: {
    title: 'Nimi has the files, but the local environment still needs repair.',
    body: 'The local assets are present, but activation has not produced ready evidence.',
  },
  local_ai_ready: {
    title: 'Nimi is finishing your default AI setup.',
    body: 'Account Default Profile, built-in AIConfigs, and baseline execution evidence still need finalization.',
  },
  repair_required: {
    title: 'Nimi needs to repair a required local component before normal use.',
    body: 'Repair must restore the missing product-control, data-root, Runtime, profile, or execution evidence.',
  },
  blocked: {
    title: 'Nimi cannot continue safely yet.',
    body: 'Resolve the blocking cause, then Nimi will re-evaluate the first-run state machine.',
  },
  ready_for_use: {
    title: 'Nimi is ready.',
    body: 'Normal product use opens to Chat and Nimi Chat.',
  },
};

function productCopy(t: TFunction, state: ProductControlState): { title: string; body: string } {
  const defaults = PRODUCT_COPY_DEFAULTS[state];
  return {
    title: t(`FirstRun.states.${state}.title`, { defaultValue: defaults.title }),
    body: t(`FirstRun.states.${state}.body`, { defaultValue: defaults.body }),
  };
}

const ORDERED_STATES: readonly ProductControlState[] = [
  'not_logged_in',
  'config_missing',
  'data_root_missing',
  'data_root_selected',
  'ai_environment_unconfigured',
  'local_ai_profile_selected_assets_missing',
  'local_ai_profile_selected_environment_not_ready',
  'local_ai_assets_downloaded_environment_not_ready',
  'local_ai_ready',
  'repair_required',
  'blocked',
  'ready_for_use',
];

function isAbsolutePath(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed);
}

function firstRunStateIndex(state: ProductControlState): number {
  const index = ORDERED_STATES.indexOf(state);
  return index >= 0 ? index : 0;
}

function canChooseDataRoot(state: ProductControlState, projection: ProductControlRecordProjection | null): boolean {
  return (
    state === 'data_root_missing'
    || state === 'blocked'
  ) && !projection?.record?.dataRoot?.path;
}

function canChooseInstallLevel(state: ProductControlState, projection: ProductControlRecordProjection | null): boolean {
  return Boolean(projection?.record?.dataRoot?.path)
    && (
      state === 'data_root_selected'
      || state === 'ai_environment_unconfigured'
      || state === 'repair_required'
    );
}

const CAPABILITY_LABEL_DEFAULTS: Record<string, string> = {
  'text.generate': 'local chat',
  'text.embed': 'local retrieval',
  'audio.transcribe': 'basic STT',
  'audio.synthesize': 'basic TTS',
  'image.generate': 'local image',
  'image.edit': 'local image edit',
  'text.generate.vision': 'local vision text',
};

function capabilitySummary(t: TFunction, capabilities: readonly string[]): string {
  const labels = capabilities
    .filter((capability) => capability !== 'video.generate')
    .map((capability) => {
      const defaultLabel = CAPABILITY_LABEL_DEFAULTS[capability];
      if (!defaultLabel) return capability;
      return t(`FirstRun.capabilities.${capability}`, { defaultValue: defaultLabel });
    });
  return Array.from(new Set(labels)).join(', ');
}

function canPersistSetupState(state: ProductControlState): state is Exclude<ProductControlState, 'ready_for_use' | 'local_ai_ready' | 'config_missing' | 'data_root_missing' | 'data_root_selected' | 'ai_environment_unconfigured' | 'not_logged_in'> {
  return state === 'local_ai_profile_selected_assets_missing'
    || state === 'local_ai_profile_selected_environment_not_ready'
    || state === 'local_ai_assets_downloaded_environment_not_ready'
    || state === 'repair_required'
    || state === 'blocked';
}

export function ProductControlWorkflow(props: ProductControlWorkflowProps): ReactElement {
  const { t } = useTranslation();
  const projection = props.projection;
  const state = projection?.state ?? 'config_missing';
  const copy = productCopy(t, state);
  const [dataRoot, setDataRoot] = useState(projection?.record?.dataRoot?.path ?? '');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(projection?.error ?? null);
  const [materialization, setMaterialization] = useState<FirstRunMaterializationProjection | null>(null);
  const currentIndex = firstRunStateIndex(state);
  const rows = useMemo(() => loadPlatformAIProfileFactoryRows(), []);
  const installPlans = useMemo(() => ({
    minimal: selectFactoryAIProfileForFirstRun(rows, 'minimal'),
    recommended: selectFactoryAIProfileForFirstRun(rows, 'recommended'),
  }), [rows]);
  const selectedInstallLevel = projection?.record?.firstRun.installLevel ?? null;
  const selectedPlan = selectedInstallLevel ? installPlans[selectedInstallLevel] : null;
  const selectedDataRoot = projection?.record?.dataRoot?.path ?? null;
  const notifyProjectionChange = props.onProjectionChange;

  useEffect(() => {
    setDataRoot(projection?.record?.dataRoot?.path ?? '');
    setError(projection?.error ?? null);
  }, [projection]);

  useEffect(() => {
    // At `local_ai_ready` the Runtime materialization phase is already
    // complete; the renderer shows backend-driven finalization instead, so the
    // materialization observer is not active here.
    if (!selectedPlan || !selectedDataRoot || state === 'ai_environment_unconfigured' || state === 'local_ai_ready') {
      setMaterialization(null);
      return;
    }
    const observedPlan = selectedPlan;
    const observedDataRoot = selectedDataRoot;
    const observedProductState = state;
    let disposed = false;
    async function observeRuntimeMaterialization(): Promise<void> {
      try {
        const next = await resolveFirstRunMaterializationProjection({
          profile: observedPlan,
          runtimeDataRoot: observedDataRoot,
        });
        if (disposed) return;
        setMaterialization(next);
        if (next.productState !== observedProductState && canPersistSetupState(next.productState)) {
          notifyProjectionChange(await desktopBridge.setProductFirstRunSetupState({
            state: next.productState,
            reason: next.reason,
          }));
        }
      } catch (nextError) {
        if (!disposed) {
          setError(nextError instanceof Error ? nextError.message : t('FirstRun.errors.materializationObserveFailed', { defaultValue: 'Failed to observe Runtime materialization.' }));
        }
      }
    }
    void observeRuntimeMaterialization();
    const interval = window.setInterval(() => void observeRuntimeMaterialization(), 3_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [selectedPlan, selectedDataRoot, state, notifyProjectionChange]);

  async function selectDataRoot(): Promise<void> {
    if (!isAbsolutePath(dataRoot)) {
      setError(t('FirstRun.errors.dataRootAbsoluteRequired', { defaultValue: 'Enter an absolute nimi_data folder path.' }));
      return;
    }
    setPendingAction('data-root');
    setError(null);
    try {
      props.onProjectionChange(await desktopBridge.selectProductDataRoot(dataRoot));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('FirstRun.errors.dataRootRecordFailed', { defaultValue: 'Failed to record nimi_data.' }));
    } finally {
      setPendingAction(null);
    }
  }

  async function selectInstallLevel(installLevel: FirstRunInstallLevel): Promise<void> {
    const plan = installPlans[installLevel];
    if (!plan) {
      setError(t('FirstRun.errors.installLevelNoProfile', { installLevel, defaultValue: '{{installLevel}} has no admitted local first-run AIProfile.' }));
      return;
    }
    setPendingAction(installLevel);
    setError(null);
    try {
      props.onProjectionChange(await desktopBridge.setProductFirstRunInstallLevel({
        installLevel,
        aiProfileAlias: plan.alias,
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('FirstRun.errors.installLevelSelectFailed', { installLevel, defaultValue: 'Failed to select {{installLevel}}.' }));
    } finally {
      setPendingAction(null);
    }
  }

  async function projectMaterialization(next: FirstRunMaterializationProjection): Promise<void> {
    setMaterialization(next);
    if (!canPersistSetupState(next.productState)) return;
    props.onProjectionChange(await desktopBridge.setProductFirstRunSetupState({
      state: next.productState,
      reason: next.reason,
    }));
  }

  async function beginRuntimeMaterialization(): Promise<void> {
    if (!selectedPlan || !selectedDataRoot) {
      setError(t('FirstRun.errors.materializationPrerequisitesMissing', { defaultValue: 'Select a first-run install level and absolute nimi_data path before Runtime setup.' }));
      return;
    }
    setPendingAction('materialization-start');
    setError(null);
    try {
      const next = await startFirstRunMaterialization({
        profile: selectedPlan,
        runtimeDataRoot: selectedDataRoot,
        confirmed: true,
      });
      await projectMaterialization(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('FirstRun.errors.materializationStartFailed', { defaultValue: 'Failed to start Runtime materialization.' }));
    } finally {
      setPendingAction(null);
    }
  }

  async function cancelRuntimeJob(item: FirstRunMaterializationDependencyProjection): Promise<void> {
    if (!selectedPlan || !selectedDataRoot || !item.job) return;
    setPendingAction(`cancel-${item.job.jobId}`);
    setError(null);
    try {
      await projectMaterialization(await cancelFirstRunMaterializationJob({
        profile: selectedPlan,
        runtimeDataRoot: selectedDataRoot,
        jobId: item.job.jobId,
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('FirstRun.errors.materializationCancelFailed', { defaultValue: 'Failed to cancel Runtime job.' }));
    } finally {
      setPendingAction(null);
    }
  }

  async function retryRuntimeJob(item: FirstRunMaterializationDependencyProjection): Promise<void> {
    if (!selectedPlan || !selectedDataRoot || !item.job) return;
    setPendingAction(`retry-${item.job.jobId}`);
    setError(null);
    try {
      await projectMaterialization(await retryFirstRunMaterializationJob({
        profile: selectedPlan,
        runtimeDataRoot: selectedDataRoot,
        jobId: item.job.jobId,
        confirmed: true,
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('FirstRun.errors.materializationRetryFailed', { defaultValue: 'Failed to retry Runtime job.' }));
    } finally {
      setPendingAction(null);
    }
  }

  async function repairRuntimeDependency(item: FirstRunMaterializationDependencyProjection): Promise<void> {
    if (!selectedPlan || !selectedDataRoot) return;
    setPendingAction(`repair-${item.dependency.environmentKey}`);
    setError(null);
    try {
      await projectMaterialization(await repairFirstRunMaterializationDependency({
        profile: selectedPlan,
        runtimeDataRoot: selectedDataRoot,
        dependency: item.dependency,
        confirmed: true,
        reasonCode: item.dependency.reasonCode ?? item.job?.failureDetail ?? materialization?.reason,
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('FirstRun.errors.materializationRepairFailed', { defaultValue: 'Failed to repair Runtime dependency.' }));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section data-testid="product-first-run-workflow" data-product-state={state} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase text-[var(--nimi-text-secondary)]">{t('FirstRun.eyebrow', { defaultValue: 'First run' })}</p>
        <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">{copy.title}</h2>
        <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">{copy.body}</p>
      </div>

      {error ? (
        <p data-testid="product-first-run-error" className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,white)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,white)] px-3 py-2 text-sm text-[var(--nimi-status-danger)]">
          {error}
        </p>
      ) : null}

      <ol data-testid="product-first-run-state-list" className="grid gap-2 sm:grid-cols-2">
        {ORDERED_STATES.map((item, index) => {
          const reached = index <= currentIndex;
          const active = item === state;
          return (
            <li
              key={item}
              data-testid={`product-first-run-state-${item}`}
              data-active={active ? 'true' : 'false'}
              className={`min-h-10 rounded-lg border px-3 py-2 text-sm ${
                active
                  ? 'border-[color:var(--nimi-focus-ring)] bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] text-[var(--nimi-text-primary)]'
                  : reached
                    ? 'border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] text-[var(--nimi-text-secondary)]'
                    : 'border-[color:var(--nimi-border-subtle)] text-[var(--nimi-text-muted)]'
              }`}
            >
              {productCopy(t, item).title}
            </li>
          );
        })}
      </ol>

      {canChooseDataRoot(state, projection) ? (
        <div data-testid="product-first-run-data-root" className="flex flex-col gap-3 rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] p-3">
          <label className="text-sm font-medium text-[var(--nimi-text-primary)]" htmlFor="product-first-run-data-root-input">
            {t('FirstRun.dataRootLabel', { defaultValue: 'nimi_data' })}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="product-first-run-data-root-input"
              data-testid="product-first-run-data-root-input"
              value={dataRoot}
              onChange={(event) => setDataRoot(event.currentTarget.value)}
              placeholder="/absolute/path/to/nimi_data"
              className="min-h-10 flex-1 rounded-md border border-[color:var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 text-sm text-[var(--nimi-text-primary)] outline-none focus:border-[color:var(--nimi-focus-ring)]"
            />
            <button
              type="button"
              data-testid="product-first-run-data-root-submit"
              disabled={pendingAction !== null}
              onClick={() => void selectDataRoot()}
              className="min-h-10 rounded-md bg-[var(--nimi-accent)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('FirstRun.dataRootConfirm', { defaultValue: 'Confirm' })}
            </button>
          </div>
        </div>
      ) : null}

      {canChooseInstallLevel(state, projection) ? (
        <div data-testid="product-first-run-install-levels" className="grid gap-3 md:grid-cols-2">
          {(['minimal', 'recommended'] as const).map((installLevel) => {
            const plan = installPlans[installLevel];
            const selected = projection?.record?.firstRun.installLevel === installLevel;
            return (
              <button
                type="button"
                key={installLevel}
                data-testid={`product-first-run-install-level-${installLevel}`}
                data-selected={selected ? 'true' : 'false'}
                disabled={!plan || pendingAction !== null}
                onClick={() => void selectInstallLevel(installLevel)}
                className={`min-h-32 rounded-lg border p-4 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected
                    ? 'border-[color:var(--nimi-focus-ring)] bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)]'
                    : 'border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)]'
                }`}
              >
                <span className="block text-base font-semibold capitalize text-[var(--nimi-text-primary)]">{installLevel}</span>
                <span className="mt-2 block text-sm leading-6 text-[var(--nimi-text-secondary)]">
                  {plan ? capabilitySummary(t, plan.capabilitySet) : t('FirstRun.installLevelNoPlan', { defaultValue: 'No admitted local plan' })}
                </span>
                {plan ? (
                  <span className="mt-3 block text-xs font-medium text-[var(--nimi-text-muted)]">
                    {plan.alias}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {projection?.record?.firstRun.installLevel && state === 'ai_environment_unconfigured' ? (
        <div data-testid="product-first-run-materialization-confirmation" className="flex flex-col gap-3 rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] p-3">
          <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">
            {t('FirstRun.materializationConfirmationBody', { defaultValue: 'Runtime requires explicit confirmation before first network or storage-heavy local setup. Start local setup to materialize the selected AIProfile dependencies.' })}
          </p>
          <button
            type="button"
            data-testid="product-first-run-materialization-start"
            disabled={pendingAction !== null}
            onClick={() => void beginRuntimeMaterialization()}
            className="min-h-10 w-fit rounded-md bg-[var(--nimi-accent)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('FirstRun.materializationStart', { defaultValue: 'Start local setup' })}
          </button>
        </div>
      ) : null}

      {state === 'local_ai_ready' && projection ? (
        <FirstRunFinalization projection={projection} onProjectionChange={props.onProjectionChange} />
      ) : null}

      {materialization && state !== 'local_ai_ready' ? (
        <div data-testid="product-first-run-materialization-progress" data-materialization-status={materialization.status} className="flex flex-col gap-3 rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] p-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('FirstRun.materializationTitle', { defaultValue: 'Runtime local setup' })}</p>
            <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">
              {t('FirstRun.materializationEvidenceNote', { reason: materialization.reason, defaultValue: '{{reason}}. This progress is Runtime evidence only; ready_for_use still requires product-control completion evidence.' })}
            </p>
          </div>
          <div className="grid gap-2">
            {materialization.dependencies.map((item) => {
              const jobState = item.job?.state ?? item.dependency.state;
              const activeJob = item.job && ['needs_confirmation', 'queued', 'starting', 'running', 'in_progress', 'downloading', 'verifying', 'installing'].includes(item.job.state);
              const canRetry = item.job && (item.job.retryable || item.job.state === 'failed' || item.job.state === 'cancelled');
              const canRepair = item.dependency.state === 'repair_required' || item.job?.state === 'failed' || item.job?.state === 'repair_required';
              return (
                <div key={`${item.dependency.environmentKey}:${item.dependency.dependencyId}`} className="flex flex-col gap-2 rounded-md border border-[color:var(--nimi-border-subtle)] px-3 py-2">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-medium text-[var(--nimi-text-primary)]">{item.dependency.dependencyFamily}</span>
                    <span className="text-xs text-[var(--nimi-text-muted)]">{jobState}</span>
                  </div>
                  <p className="break-all text-xs text-[var(--nimi-text-muted)]">{item.dependency.environmentKey}</p>
                  <div className="flex flex-wrap gap-2">
                    {activeJob ? (
                      <button
                        type="button"
                        data-testid="product-first-run-materialization-cancel"
                        disabled={pendingAction !== null}
                        onClick={() => void cancelRuntimeJob(item)}
                        className="min-h-8 rounded-md border border-[color:var(--nimi-border-subtle)] px-3 text-xs font-medium text-[var(--nimi-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t('FirstRun.materializationCancel', { defaultValue: 'Cancel' })}
                      </button>
                    ) : null}
                    {canRetry ? (
                      <button
                        type="button"
                        data-testid="product-first-run-materialization-retry"
                        disabled={pendingAction !== null}
                        onClick={() => void retryRuntimeJob(item)}
                        className="min-h-8 rounded-md border border-[color:var(--nimi-border-subtle)] px-3 text-xs font-medium text-[var(--nimi-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t('FirstRun.materializationRetry', { defaultValue: 'Retry' })}
                      </button>
                    ) : null}
                    {canRepair ? (
                      <button
                        type="button"
                        data-testid="product-first-run-materialization-repair"
                        disabled={pendingAction !== null}
                        onClick={() => void repairRuntimeDependency(item)}
                        className="min-h-8 rounded-md border border-[color:var(--nimi-border-subtle)] px-3 text-xs font-medium text-[var(--nimi-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t('FirstRun.materializationRepair', { defaultValue: 'Repair' })}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
