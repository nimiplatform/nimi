// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeLocalTransferProgressEvent,
} from '@nimiplatform/sdk/runtime';
import { Button, InlineAlert, LoadingSkeleton, StatusBadge } from '@nimiplatform/kit/ui';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import { formatKnownDownloadSize } from './runtime-config-model-center-utils.js';
import { loadoutCandidatePresentation } from './runtime-config-loadout-model-display.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import {
  useRuntimeSetupTasks,
  type RuntimeSetupTask,
  type RuntimeSetupTaskStore,
} from './runtime-setup-task-store.js';
import {
  createRuntimeSetupCandidate,
  reopenRuntimeSetupTask,
  resolveRuntimeSetupPreparation,
  reuseRuntimeSetupCurrent,
  resumeRuntimeSetupOwnerRoute,
  runRuntimeSetupPreparation,
  stopRuntimeSetupTask,
  type RuntimeSetupPreparationPlan,
  type RuntimeSetupRunnerPorts,
} from './runtime-setup-task-runner.js';
import { RuntimeSetupTaskCloudPanel } from './runtime-config-setup-task-cloud.js';
import { SetupTaskAdvancedSection } from './runtime-config-setup-task-advanced.js';

function useSetupTaskTransferProgress(
  installPlanIds: readonly string[],
): Readonly<Record<string, NimiRuntimeLocalTransferProgressEvent>> {
  const localEnvironment = useRuntimeConfigLocalEnvironmentClient();
  const planIdsKey = installPlanIds.join('|');
  const [progress, setProgress] = useState<Readonly<Record<string, NimiRuntimeLocalTransferProgressEvent>>>({});
  useEffect(() => {
    const planIds = new Set(planIdsKey ? planIdsKey.split('|') : []);
    if (planIds.size === 0) return undefined;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    void localEnvironment.watchTransferProgress((event) => {
      if (!event.planId || !planIds.has(event.planId)) return;
      setProgress((previous) => ({ ...previous, [event.planId!]: event }));
    }).then((unsub) => {
      if (disposed) unsub();
      else unsubscribe = unsub;
    }).catch(() => {});
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [localEnvironment, planIdsKey]);
  return progress;
}

function scopeSizeLabel(sizeBytes: number | null | undefined, unknownLabel: string): string {
  return formatKnownDownloadSize(sizeBytes ?? undefined, unknownLabel);
}

function SetupTaskScopeList(props: { readonly task: RuntimeSetupTask }) {
  const { t } = useTranslation();
  const authorization = props.task.authorization;
  if (!authorization) return null;
  const reuse = authorization.scope.items.filter((item) => item.kind === 'reuse-asset');
  const acquire = authorization.scope.items.filter((item) => item.kind === 'acquire-asset');
  const components = authorization.scope.items.filter((item) => item.kind === 'component');
  const options = authorization.scope.items.filter((item) => item.kind === 'option');
  const unknownSize = t('runtimeConfig.setupTask.unknownSize', { defaultValue: 'size unknown' });
  return (
    <div className="space-y-3" data-testid="runtime-setup-task-scope">
      {([
        ['reuse', reuse, t('runtimeConfig.setupTask.scope.reuse', { defaultValue: 'Reused resources' })],
        ['acquire', acquire, t('runtimeConfig.setupTask.scope.acquire', { defaultValue: 'To download' })],
        ['components', components, t('runtimeConfig.setupTask.scope.components', { defaultValue: 'Runtime components' })],
        ['options', options, t('runtimeConfig.setupTask.scope.options', { defaultValue: 'Optional features' })],
      ] as const).map(([key, items, title]) => (
        items.length === 0 ? null : (
          <div key={key}>
            <div className="text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">{title}</div>
            <ul className="mt-1 space-y-1">
              {items.map((item) => (
                <li key={`${item.kind}:${item.id}`} className="flex items-center justify-between gap-3 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
                  <span className="min-w-0 truncate">{item.label}</span>
                  <span className="shrink-0 text-xs text-[var(--nimi-text-muted)]">
                    {item.kind === 'acquire-asset' ? scopeSizeLabel(item.sizeBytes, unknownSize) : (item.detail ?? '')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      ))}
      <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
        {authorization.scope.usage.selectOnMachine
          ? t('runtimeConfig.setupTask.scope.usageSelectAndSave', { defaultValue: 'After preparation, this becomes the current model on this device.' })
          : t('runtimeConfig.setupTask.scope.usagePrepareOnly', { defaultValue: 'Prepare only: the current selection stays unchanged.' })}
        {authorization.scope.usage.saveOwnerRoute && authorization.scope.usage.ownerLabel ? (
          <span>
            {' '}
            {t('runtimeConfig.setupTask.scope.usageSaveOwner', {
              defaultValue: '{{owner}} will use the model selected on this device.',
              owner: authorization.scope.usage.ownerLabel,
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function installedRebindLabel(t: (key: string, options?: Record<string, unknown>) => string): string {
  return t('runtimeConfig.setupTask.scope.installedRebind', { defaultValue: 'Already on this machine' });
}

/**
 * Exported for direct render tests: the reviewed preparation list, including
 * the awaiting-choice pickers and the installed-rebind honesty label.
 */
export function SetupTaskPlanReview(props: {
  readonly plan: RuntimeSetupPreparationPlan;
  readonly choices: Readonly<Record<string, string>>;
  readonly onChoiceChange: (slotId: string, offerRef: string) => void;
  /** Source owner whose route is saved by the prepare-and-use confirmation. */
  readonly ownerLabel: string | null;
}) {
  const { t } = useTranslation();
  const unknownSize = t('runtimeConfig.setupTask.unknownSize', { defaultValue: 'size unknown' });
  const installedLabel = installedRebindLabel(t);
  return (
    <div className="space-y-3" data-testid="runtime-setup-task-plan">
      {props.plan.reuse.length > 0 ? (
        <div>
          <div className="text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.setupTask.scope.reuse', { defaultValue: 'Reused resources' })}
          </div>
          <ul className="mt-1 space-y-1">
            {props.plan.reuse.map((item) => (
              <li key={item.slotId} className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {props.plan.acquire.length > 0 ? (
        <div>
          <div className="text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.setupTask.scope.acquire', { defaultValue: 'To download' })}
          </div>
          <ul className="mt-1 space-y-1">
            {props.plan.acquire.map((item) => (
              <li key={item.slotId} className="flex items-center justify-between gap-3 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
                <span className="min-w-0 truncate">{item.offer.title}</span>
                <span className="shrink-0 text-xs text-[var(--nimi-text-muted)]">
                  {item.offer.installedModelAssetId ? installedLabel : scopeSizeLabel(item.offer.sizeBytes, unknownSize)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {props.plan.awaitingChoice.map((choice) => (
        <div key={choice.slotId} data-testid={`runtime-setup-task-choice:${choice.slotId}`}>
          <div className="text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">{choice.label}</div>
          <div className="mt-1 space-y-1">
            {choice.options.map((option) => {
              const presentation = loadoutCandidatePresentation({ title: option.title, variantLabel: option.variantLabel });
              const selected = props.choices[choice.slotId] === option.offerRef;
              return (
                <label key={option.offerRef} className="flex cursor-pointer items-center gap-2 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
                  <input
                    type="radio"
                    name={`runtime-setup-choice-${choice.slotId}`}
                    checked={selected}
                    onChange={() => props.onChoiceChange(choice.slotId, option.offerRef)}
                  />
                  <span className="min-w-0 truncate">{presentation.headline || option.title}</span>
                  {option.recommended ? <StatusBadge tone="info" shape="soft">{t('runtimeConfig.setupTask.deviceRecommended', { defaultValue: "Recommended for this device" })}</StatusBadge> : null}
                  <span className="shrink-0 text-xs text-[var(--nimi-text-muted)]">
                    {option.installedModelAssetId ? installedLabel : scopeSizeLabel(option.sizeBytes, unknownSize)}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      {props.plan.awaitingChoice.some((choice) => choice.options.some((option) => option.recommended)) ? (
        <Button tone="secondary" size="sm" data-testid="runtime-setup-accept-recommendations" onClick={() => {
          for (const choice of props.plan.awaitingChoice) {
            const recommended = choice.options.find((option) => option.recommended);
            if (recommended) props.onChoiceChange(choice.slotId, recommended.offerRef);
          }
        }}>{t('runtimeConfig.setupTask.acceptRecommendations', { defaultValue: "Use device recommendations" })}</Button>
      ) : null}
      {props.plan.unavailable.length > 0 ? (
        <InlineAlert tone="warning" data-testid="runtime-setup-unavailable">
          <div>{t('runtimeConfig.setupTask.resourcesUnavailable', { defaultValue: "Some required resources are unavailable. Choose another model or manage files in the model library." })}</div>
          <ul className="mt-2 list-disc pl-4">{props.plan.unavailable.map((item) => <li key={item.slotId}>{item.label}</li>)}</ul>
        </InlineAlert>
      ) : null}
      {props.plan.components.length > 0 ? (
        <div>
          <div className="text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.setupTask.scope.components', { defaultValue: 'Runtime components' })}
          </div>
          <ul className="mt-1 space-y-1">
            {props.plan.components.map((item) => (
              <li key={`${item.dependencyFamily}/${item.dependencyId}`} className="flex items-center justify-between gap-3 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
                <span className="min-w-0 truncate">{item.label}</span>
                <span className="shrink-0 text-xs text-[var(--nimi-text-muted)]">{item.state}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {props.plan.options.length > 0 ? (
        <div>
          <div className="text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.setupTask.scope.options', { defaultValue: 'Optional features' })}
          </div>
          <ul className="mt-1 space-y-1">
            {props.plan.options.map((item) => (
              <li key={item.slotId} className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
        {t('runtimeConfig.setupTask.scope.reviewModes', { defaultValue: "Prepare and use makes this the current model on this device. Prepare only keeps the current model unchanged." })}
        {props.ownerLabel ? (
          <span>
            {' '}
            {t('runtimeConfig.setupTask.scope.reviewOwner', {
              defaultValue: "When you choose Prepare and use, {{owner}} will use the model selected on this device.",
              owner: props.ownerLabel,
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function sourceOwnerLabel(task: RuntimeSetupTask, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (task.source.kind === 'app') return task.source.ownerAppId || task.source.kind;
  if (task.source.kind === 'local-agent') {
    return t('runtimeConfig.setupTask.sourceLocalAgent', { defaultValue: 'the shared LocalAgent' });
  }
  return task.source.kind;
}

/**
 * The shared setup task surface: route choice for consumer sources,
 * model/implementation selection, preparation review with the two distinct
 * confirmation actions, live progress, and the per-item result with a return
 * affordance. Advanced editing persists to the task draft.
 */
export function RuntimeConfigSetupTaskView(props: {
  readonly taskId: string;
  readonly store: RuntimeSetupTaskStore;
  readonly ports: RuntimeSetupRunnerPorts;
  readonly onClose: () => void;
  /** Result-page return affordance; defaults to onClose. */
  readonly onReturnToSource?: () => void;
}) {
  const { t } = useTranslation();
  const snapshot = useRuntimeSetupTasks(props.store);
  const task = snapshot.tasks.find((entry) => entry.taskId === props.taskId) ?? null;
  const [recipes, setRecipes] = useState<readonly NimiLoadoutRecipe[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [recipesError, setRecipesError] = useState('');
  const [recipesRetry, setRecipesRetry] = useState(0);
  const [selectedRecipeId, setSelectedRecipeId] = useState(task?.draft?.recipeId ?? '');
  const [plan, setPlan] = useState<RuntimeSetupPreparationPlan | null>(null);
  const [choices, setChoices] = useState<Readonly<Record<string, string>>>(task?.draft?.preferredOffers ?? {});
  const [busy, setBusy] = useState(false);
  const [reuseMessage, setReuseMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [candidateInfo, setCandidateInfo] = useState<{
    readonly candidate: NimiMachineLoadout | null;
    readonly recipe: NimiLoadoutRecipe | null;
  } | null>(null);
  const progress = useSetupTaskTransferProgress(task?.refs.installPlanIds ?? []);

  // The route is a draft fact: machine-scope tasks are always local, and a
  // consumer source chooses Local or Cloud explicitly.
  const route = task?.draft?.route ?? (task?.source.kind === 'runtime' ? 'local' : null);

  useEffect(() => {
    if (!task || task.status !== 'draft' || task.candidateLoadoutId || route === 'cloud') return;
    let active = true;
    setRecipesLoading(true);
    setRecipesError('');
    void props.ports.loadouts.listRecipes(task.capabilityContract)
      .then((items) => { if (active) setRecipes(items); })
      .catch((error: unknown) => { if (active) setRecipesError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (active) setRecipesLoading(false); });
    return () => { active = false; };
  }, [props.ports, route, task?.taskId, task?.status, task?.candidateLoadoutId, task?.capabilityContract, recipesRetry]);

  // Load the candidate + recipe for the advanced section once a candidate
  // exists; a baseline bump reloads it after an advanced apply.
  const candidateRevisionBaseline = task?.candidateRevisionBaseline;
  useEffect(() => {
    if (!task || !task.candidateLoadoutId || (task.status !== 'draft' && task.status !== 'review')) return undefined;
    let active = true;
    const candidateLoadoutId = task.candidateLoadoutId;
    void Promise.all([
      props.ports.loadouts.get(),
      props.ports.loadouts.listRecipes(task.capabilityContract),
    ]).then(([aggregate, nextRecipes]) => {
      if (!active) return;
      const candidate = aggregate.loadouts.find((loadout) => loadout.loadoutId === candidateLoadoutId) ?? null;
      setCandidateInfo({
        candidate,
        recipe: candidate ? nextRecipes.find((entry) => entry.recipeId === candidate.recipeId) ?? null : null,
      });
    }).catch(() => {
      if (active) setCandidateInfo(null);
    });
    return () => {
      active = false;
    };
  }, [props.ports, task, candidateRevisionBaseline]);

  const onChoiceChange = useCallback((slotId: string, offerRef: string) => {
    setChoices((previous) => ({ ...previous, [slotId]: offerRef }));
  }, []);

  const onSelectRoute = useCallback((nextRoute: 'local' | 'cloud') => {
    if (!task) return;
    props.store.updateTask(task.taskId, (current) => ({
      draft: { ...(current.draft ?? {}), route: nextRoute },
    }));
  }, [props.store, task]);

  const onReuseCurrent = useCallback(() => {
    if (!task) return;
    setBusy(true);
    setReuseMessage('');
    void reuseRuntimeSetupCurrent(props.store, task.taskId, props.ports)
      .then((result) => {
        if (result.status === 'blocked') {
          setReuseMessage(result.failure.message);
        }
      })
      .finally(() => setBusy(false));
  }, [props.ports, props.store, task]);

  const resolvePlan = useCallback(async (acceptExternalCandidateState?: boolean) => {
    setActionError('');
    const result = await resolveRuntimeSetupPreparation(props.store, props.taskId, props.ports, {
      acceptExternalCandidateState,
    });
    if (result.status === 'ok') {
      setPlan(result.value);
      return true;
    }
    if (result.status === 'blocked') setActionError(result.failure.message);
    return false;
  }, [props.ports, props.store, props.taskId]);

  // The reviewed plan lives only in this view's state, so reopening a
  // review-stage task within the same session would otherwise strand it with
  // disabled confirm actions. Recompute the plan from current Runtime state.
  const taskStatus = task?.status;
  useEffect(() => {
    if (taskStatus !== 'review' || plan) return;
    setBusy(true);
    void resolvePlan().finally(() => setBusy(false));
  }, [taskStatus, plan, resolvePlan]);

  const onReviewPreparation = useCallback(() => {
    if (!task || !selectedRecipeId) return;
    setBusy(true);
    void (async () => {
      if (!task.candidateLoadoutId) {
        const draft = task.draft;
        const created = await createRuntimeSetupCandidate(props.store, props.taskId, props.ports, {
          recipeId: selectedRecipeId,
          ...(draft?.options ? { options: draft.options } : {}),
          ...(draft?.axes && draft.axes.length > 0 ? { axes: draft.axes } : {}),
          ...(draft?.profileId ? { provenance: { source_profile_id: draft.profileId } } : {}),
        });
        if (created.status !== 'ok') {
          if (created.status === 'blocked') setActionError(created.failure.message);
          return;
        }
      }
      await resolvePlan();
    })().finally(() => setBusy(false));
  }, [props.ports, props.store, props.taskId, resolvePlan, selectedRecipeId, task]);

  const onConfirm = useCallback((mode: 'prepare-and-use' | 'prepare-only') => {
    if (!plan) return;
    setBusy(true);
    setActionError('');
    void runRuntimeSetupPreparation(props.store, props.taskId, props.ports, {
      mode,
      reviewedPlan: plan,
      choices,
    }).then((result) => {
      if (result.status === 'blocked') setActionError(result.failure.message);
    }).finally(() => setBusy(false));
  }, [choices, plan, props.ports, props.store, props.taskId]);

  const onReverify = useCallback(() => {
    setBusy(true);
    void (async () => {
      if (task?.failure?.machineSelected) {
        const result = await resumeRuntimeSetupOwnerRoute(props.store, props.taskId, props.ports);
        if (result.status === 'blocked') setActionError(result.failure.message);
        return;
      }
      if (task?.draft?.route === 'cloud') {
        // A cloud task has no candidate to re-resolve; reopening returns to
        // the kept draft with the current owner configuration re-read.
        reopenRuntimeSetupTask(props.store, props.taskId);
        return;
      }
      await resolvePlan(true);
    })().finally(() => setBusy(false));
  }, [props.store, props.taskId, props.ports, resolvePlan, task?.draft?.route, task?.failure?.machineSelected]);

  const stopInfo = t('runtimeConfig.setupTask.stopInfo', {
    defaultValue: 'Stopping blocks further automatic writes. Saved configurations and shared component jobs are kept and may continue.',
  });

  const renderRouteChoice = (currentTask: RuntimeSetupTask) => {
    const capabilityLabel = displayRuntimeConfigCapabilityLabel(currentTask.capabilityContract, t);
    return (
      <div className="space-y-3" data-testid="runtime-setup-task-route-choice">
        <p className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.setupTask.routeChoiceLead', {
            defaultValue: 'Set up {{capability}} for {{owner}}. Choose where requests should run.',
            capability: capabilityLabel,
            owner: sourceOwnerLabel(currentTask, t),
          })}
        </p>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          <button
            type="button"
            className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] px-4 py-3 text-left hover:border-[var(--nimi-border-strong)]"
            onClick={() => onSelectRoute('local')}
            data-testid="runtime-setup-route-local"
          >
            <span className="block text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.setupTask.routeLocalTitle', { defaultValue: "On this device" })}
            </span>
            <span className="mt-1 block text-xs text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.setupTask.routeLocalDescription', {
                defaultValue: "Prepare a model on this device or use one you already set up.",
              })}
            </span>
          </button>
          <button
            type="button"
            className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] px-4 py-3 text-left hover:border-[var(--nimi-border-strong)]"
            onClick={() => onSelectRoute('cloud')}
            data-testid="runtime-setup-route-cloud"
          >
            <span className="block text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.setupTask.routeCloudTitle', { defaultValue: "Cloud service" })}
            </span>
            <span className="mt-1 block text-xs text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.setupTask.routeCloudDescription', {
                defaultValue: "Connect to a cloud service and choose a model for this app.",
              })}
            </span>
          </button>
        </div>
        <div className="space-y-1">
          <Button
            tone="secondary"
            size="sm"
            disabled={busy}
            onClick={onReuseCurrent}
            data-testid="runtime-setup-reuse-current"
          >
            {t('runtimeConfig.setupTask.useCurrentMachine', { defaultValue: "Use this device’s current model" })}
          </Button>
          <p className="text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.setupTask.useCurrentMachineHint', {
              defaultValue: "Use the model already selected on this device. If it still needs preparation, you can continue setting it up here.",
            })}
          </p>
          {reuseMessage ? <InlineAlert tone="warning">{reuseMessage}</InlineAlert> : null}
        </div>
      </div>
    );
  };

  const renderDraft = (currentTask: RuntimeSetupTask) => {
    const capabilityLabel = displayRuntimeConfigCapabilityLabel(currentTask.capabilityContract, t);
    if (route === 'cloud') {
      return (
        <div className="space-y-3">
          {currentTask.source.kind !== 'runtime' ? (
            <Button tone="ghost" size="sm" onClick={() => onSelectRoute('local')} data-testid="runtime-setup-route-back-local">
              {t('runtimeConfig.setupTask.routeSwitchLocal', { defaultValue: 'Switch to Local setup' })}
            </Button>
          ) : null}
          <RuntimeSetupTaskCloudPanel
            task={currentTask}
            store={props.store}
            ports={props.ports}
            onBusyChange={setBusy}
          />
        </div>
      );
    }
    if (currentTask.candidateLoadoutId) {
      const candidate = candidateInfo?.candidate ?? null;
      const candidateRecipe = candidateInfo?.recipe ?? null;
      return (
        <div className="space-y-3">
          <p className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.setupTask.draftSaved', { defaultValue: "Your model choices are saved. Review what needs to be prepared." })}
          </p>
          {candidateRecipe && candidate ? (
            <details
              className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] p-3"
              open={advancedOpen}
              onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-xs font-semibold text-[var(--nimi-text-secondary)]">
                {t('runtimeConfig.setupTask.advancedToggle', { defaultValue: 'Advanced: variants, slots, and options' })}
              </summary>
              <div className="mt-3">
                <SetupTaskAdvancedSection
                  task={currentTask}
                  store={props.store}
                  ports={props.ports}
                  recipe={candidateRecipe}
                  candidate={candidate}
                  onCandidateUpdated={() => { setPlan(null); }}
                />
              </div>
            </details>
          ) : null}
          <Button tone="primary" disabled={busy} onClick={() => { setBusy(true); void resolvePlan().finally(() => setBusy(false)); }}>
            {t('runtimeConfig.setupTask.reviewPreparation', { defaultValue: 'Review preparation' })}
          </Button>
        </div>
      );
    }
    const selectedRecipe = recipes.find((entry) => entry.recipeId === selectedRecipeId) ?? null;
    return (
      <div className="space-y-3" data-testid="runtime-setup-task-recipes">
        <p className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.setupTask.chooseModel', { defaultValue: "Choose a model for {{capability}}.", capability: capabilityLabel })}
        </p>
        {currentTask.source.kind !== 'runtime' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button tone="ghost" size="sm" onClick={() => onSelectRoute('cloud')} data-testid="runtime-setup-route-switch-cloud">
              {t('runtimeConfig.setupTask.routeSwitchCloud', { defaultValue: 'Use a cloud connection instead' })}
            </Button>
            <Button tone="ghost" size="sm" disabled={busy} onClick={onReuseCurrent} data-testid="runtime-setup-reuse-current-local">
              {t('runtimeConfig.setupTask.useCurrentMachine', { defaultValue: "Use this device’s current model" })}
            </Button>
          </div>
        ) : null}
        {reuseMessage ? <InlineAlert tone="warning">{reuseMessage}</InlineAlert> : null}
        {recipesError ? (
          <InlineAlert tone="danger" data-testid="runtime-setup-recipes-error">
            <div>{t('runtimeConfig.setupTask.recipesLoadFailed', { defaultValue: "Models could not be loaded. Try again." })}</div>
            <Button tone="secondary" size="sm" disabled={recipesLoading} onClick={() => setRecipesRetry((value) => value + 1)}>{t('Common.retry', { defaultValue: 'Retry' })}</Button>
            <details className="mt-1 text-xs"><summary>{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>{recipesError}</details>
          </InlineAlert>
        ) : null}
        {recipesLoading ? <LoadingSkeleton className="h-24 w-full" /> : null}
        {!recipesLoading && !recipesError && recipes.length === 0 ? (
          <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.setupTask.noRecipes', { defaultValue: "No models are available for this capability on this device yet." })}</p>
        ) : null}
        <div className="space-y-2">
          {recipes.map((recipe) => (
            <label
              key={recipe.recipeId}
              className="flex cursor-pointer items-center gap-2 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] px-3 py-2"
              data-testid={`runtime-setup-task-recipe:${recipe.recipeId}`}
            >
              <input
                type="radio"
                name="runtime-setup-recipe"
                checked={selectedRecipeId === recipe.recipeId}
                onChange={() => {
                  setSelectedRecipeId(recipe.recipeId);
                  props.store.updateTask(currentTask.taskId, (current) => ({
                    draft: { ...(current.draft ?? {}), recipeId: recipe.recipeId },
                  }));
                }}
              />
              <span className="min-w-0 flex-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-primary)]">
                <span className="block">{recipe.title}</span>
                <span className="block text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.setupTask.recipeResources', {
                  defaultValue: "Required resources: {{count}}",
                  count: recipe.slots.filter((slot) => slot.presence !== 'optional-conditional').length,
                })}</span>
              </span>
              <StatusBadge tone={recipe.applicability === 'supported' ? 'success' : recipe.applicability === 'unsupported' ? 'danger' : 'neutral'} shape="soft">
                {t(`runtimeConfig.loadouts.hostFit.${recipe.applicability}`, { defaultValue: recipe.applicability })}
              </StatusBadge>
            </label>
          ))}
        </div>
        {selectedRecipe ? (
          <details
            className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] p-3"
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer text-xs font-semibold text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.setupTask.advancedToggle', { defaultValue: 'Advanced: variants, slots, and options' })}
            </summary>
            <div className="mt-3">
              <SetupTaskAdvancedSection
                task={currentTask}
                store={props.store}
                ports={props.ports}
                recipe={selectedRecipe}
                candidate={null}
                onCandidateUpdated={() => {}}
              />
            </div>
          </details>
        ) : null}
        <Button tone="primary" disabled={!selectedRecipe || busy || recipesLoading || Boolean(recipesError)} onClick={onReviewPreparation} data-testid="runtime-setup-task-review">
          {t('runtimeConfig.setupTask.reviewPreparation', { defaultValue: 'Review preparation' })}
        </Button>
      </div>
    );
  };

  const renderContent = () => {
    if (!task) {
      return (
        <EmptyStateLike message={t('runtimeConfig.setupTask.missing', { defaultValue: 'This setup task no longer exists.' })} />
      );
    }
    switch (task.status) {
      case 'draft': {
        if (route === null && !task.candidateLoadoutId) {
          return renderRouteChoice(task);
        }
        return renderDraft(task);
      }
      case 'review': {
        return (
          <div className="space-y-4">
            {candidateInfo?.candidate?.displayName ? (
              <p className="text-sm font-semibold text-[var(--nimi-text-primary)]" data-testid="runtime-setup-reviewed-model">{candidateInfo.candidate.displayName}</p>
            ) : null}
            {plan ? <SetupTaskPlanReview plan={plan} choices={choices} onChoiceChange={onChoiceChange} ownerLabel={task.source.kind === 'runtime' ? null : sourceOwnerLabel(task, t)} /> : <LoadingSkeleton className="h-32 w-full" />}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                tone="primary"
                disabled={busy || !plan || plan.unavailable.length > 0 || plan.awaitingChoice.some((choice) => !choices[choice.slotId])}
                onClick={() => onConfirm('prepare-and-use')}
                data-testid="runtime-setup-task-prepare-and-use"
              >
                {t('runtimeConfig.setupTask.prepareAndUse', { defaultValue: 'Prepare and use' })}
              </Button>
              <Button
                tone="secondary"
                disabled={busy || !plan || plan.unavailable.length > 0 || plan.awaitingChoice.some((choice) => !choices[choice.slotId])}
                onClick={() => onConfirm('prepare-only')}
                data-testid="runtime-setup-task-prepare-only"
              >
                {t('runtimeConfig.setupTask.prepareOnly', { defaultValue: 'Prepare only' })}
              </Button>
              {plan && plan.unavailable.length > 0 ? (
                <Button tone="ghost" disabled={busy} onClick={() => {
                  props.store.updateTask(task.taskId, () => ({
                    status: 'draft', nextAction: 'choose-model', failure: undefined, authorization: undefined,
                    candidateLoadoutId: undefined, candidateRevisionBaseline: undefined,
                    draft: { route: 'local' },
                  }));
                  setSelectedRecipeId(''); setChoices({}); setPlan(null); setActionError('');
                }}>{t('runtimeConfig.setupTask.chooseAnotherModel', { defaultValue: "Choose another model" })}</Button>
              ) : null}
            </div>
          </div>
        );
      }
      case 'preparing':
      case 'committing': {
        const planIds = new Set(task.refs.installPlanIds);
        return (
          <div className="space-y-3" data-testid="runtime-setup-task-progress">
            <SetupTaskScopeList task={task} />
            {[...planIds].map((planId) => {
              const event = progress[planId];
              return (
                <div key={planId} className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
                  {event
                    ? `${event.phase || event.state}: ${formatKnownDownloadSize(event.bytesReceived, '')}${typeof event.bytesTotal === 'number' && event.bytesTotal > 0 ? ` / ${formatKnownDownloadSize(event.bytesTotal, '')}` : ''}`
                    : planId}
                </div>
              );
            })}
            <p className="text-xs text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.setupTask.closingKeepsRunning', { defaultValue: 'Closing this page does not cancel the task.' })}
            </p>
            <Button tone="secondary" onClick={() => stopRuntimeSetupTask(props.store, props.taskId)} data-testid="runtime-setup-task-stop">
              {t('runtimeConfig.setupTask.stop', { defaultValue: 'Stop' })}
            </Button>
            <p className="text-xs text-[var(--nimi-text-muted)]">{stopInfo}</p>
          </div>
        );
      }
      case 'prepared':
        return (
          <div className="space-y-3" data-testid="runtime-setup-task-prepared">
            <InlineAlert tone="success">
              <div className="font-semibold text-[var(--nimi-text-primary)]">
                {t('runtimeConfig.setupTask.preparedTitle', { defaultValue: 'Prepared, not in use' })}
              </div>
              <div>
                {t('runtimeConfig.setupTask.preparedDescription', { defaultValue: 'The configuration is ready. The current selection is unchanged.' })}
              </div>
            </InlineAlert>
            <div className="flex flex-wrap gap-2">
              <Button tone="primary" disabled={busy} onClick={onReverify}>
                {t('runtimeConfig.setupTask.usePrepared', { defaultValue: 'Use this configuration' })}
              </Button>
              <Button tone="secondary" onClick={props.onClose}>
                {t('runtimeConfig.setupTask.back', { defaultValue: 'Back' })}
              </Button>
            </div>
          </div>
        );
      case 'done': {
        const isCloudRoute = task.draft?.route === 'cloud' && !task.candidateLoadoutId;
        return (
          <div className="space-y-3" data-testid="runtime-setup-task-done">
            <InlineAlert tone="success">
              <div className="font-semibold text-[var(--nimi-text-primary)]">
                {isCloudRoute
                  ? t('runtimeConfig.setupTask.doneCloudTitle', { defaultValue: "Cloud settings saved" })
                  : t('runtimeConfig.setupTask.doneTitle', { defaultValue: 'Done' })}
              </div>
              <div>
                {isCloudRoute
                  ? t('runtimeConfig.setupTask.doneCloudDescription', {
                    defaultValue: "The app is set to use your chosen cloud model.",
                  })
                  : t('runtimeConfig.setupTask.doneDescription', { defaultValue: 'The requested configuration changes are complete.' })}
              </div>
            </InlineAlert>
            <p className="text-xs text-[var(--nimi-text-muted)]" data-testid="runtime-setup-task-done-execution-note">
              {t('runtimeConfig.setupTask.doneExecutionNote', {
                defaultValue: "Settings are saved; no test request was sent. Continue in your app.",
              })}
            </p>
            <Button tone="primary" onClick={props.onReturnToSource ?? props.onClose} data-testid="runtime-setup-task-return">
              {task.source.kind === 'runtime'
                ? t('runtimeConfig.setupTask.back', { defaultValue: 'Back' })
                : t('runtimeConfig.setupTask.returnToSource', { defaultValue: 'Return to {{source}}', source: sourceOwnerLabel(task, t) })}
            </Button>
          </div>
        );
      }
      case 'needs-attention':
        return (
          <div className="space-y-3" data-testid="runtime-setup-task-attention">
            <InlineAlert tone="warning">
              <div className="font-semibold text-[var(--nimi-text-primary)]">
                {t('runtimeConfig.setupTask.attentionTitle', { defaultValue: 'Needs your decision' })}
              </div>
              <div>{`${task.failure?.message ?? ''}${task.failure?.reasonCode ? ` (${task.failure.reasonCode})` : ''}`}</div>
            </InlineAlert>
            <div className="flex flex-wrap gap-2">
              <Button tone="primary" disabled={busy} onClick={onReverify} data-testid="runtime-setup-task-reverify">
                {task.failure?.machineSelected
                  ? t('runtimeConfig.setupTask.continueOwnerSave', { defaultValue: "Check and save app settings" })
                  : t('runtimeConfig.setupTask.reverify', { defaultValue: 'Re-check and review' })}
              </Button>
              <Button tone="secondary" onClick={() => stopRuntimeSetupTask(props.store, props.taskId)}>
                {t('runtimeConfig.setupTask.stop', { defaultValue: 'Stop' })}
              </Button>
            </div>
            <p className="text-xs text-[var(--nimi-text-muted)]">{stopInfo}</p>
          </div>
        );
      case 'failed':
        return (
          <div className="space-y-3" data-testid="runtime-setup-task-failed">
            <InlineAlert tone="danger">
              <div className="font-semibold text-[var(--nimi-text-primary)]">
                {task.failure?.machineSelected
                  ? t('runtimeConfig.setupTask.partialTitle', { defaultValue: "Model changed; app settings need attention" })
                  : t('runtimeConfig.setupTask.failedTitle', { defaultValue: 'Setup failed' })}
              </div>
              <div>{`${task.failure?.message ?? ''}${task.failure?.reasonCode ? ` (${task.failure.reasonCode})` : ''}`}</div>
            </InlineAlert>
            <div className="flex flex-wrap gap-2">
              <Button tone="primary" disabled={busy} onClick={() => { if (task.failure?.machineSelected) onReverify(); else reopenRuntimeSetupTask(props.store, props.taskId); }} data-testid="runtime-setup-task-retry">
                {task.failure?.machineSelected
                  ? t('runtimeConfig.setupTask.continueOwnerSave', { defaultValue: "Check and save app settings" })
                  : t('runtimeConfig.setupTask.retry', { defaultValue: 'Review and retry' })}
              </Button>
              <Button tone="secondary" onClick={props.onClose}>
                {t('runtimeConfig.setupTask.back', { defaultValue: 'Back' })}
              </Button>
            </div>
          </div>
        );
      case 'stopped':
        return (
          <div className="space-y-3" data-testid="runtime-setup-task-stopped">
            <InlineAlert tone="neutral">
              <div className="font-semibold text-[var(--nimi-text-primary)]">
                {t('runtimeConfig.setupTask.stoppedTitle', { defaultValue: 'Stopped' })}
              </div>
              <div>{stopInfo}</div>
            </InlineAlert>
            <Button tone="secondary" onClick={props.onClose}>
              {t('runtimeConfig.setupTask.back', { defaultValue: 'Back' })}
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <section className="min-w-0 space-y-4" data-testid="runtime-setup-task-view" aria-label={t('runtimeConfig.setupTask.title', { defaultValue: 'Setup task' })}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-[length:var(--nimi-type-title-size,1.125rem)] font-semibold text-[var(--nimi-text-primary)]">
          {task ? displayRuntimeConfigCapabilityLabel(task.capabilityContract, t) : ''}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {task && (task.status === 'draft' || task.status === 'review') ? (
            <Button tone="ghost" size="sm" onClick={() => stopRuntimeSetupTask(props.store, props.taskId)} data-testid="runtime-setup-task-stop-early">
              {t('runtimeConfig.setupTask.stop', { defaultValue: 'Stop' })}
            </Button>
          ) : null}
          <Button tone="ghost" size="sm" onClick={props.onClose}>
            {t('runtimeConfig.setupTask.close', { defaultValue: 'Close' })}
          </Button>
        </div>
      </div>
      {task && task.source.kind !== 'runtime' ? (
        <p className="text-sm text-[var(--nimi-text-secondary)]" data-testid="runtime-setup-source-owner">
          {t('runtimeConfig.setupTask.forSource', { defaultValue: 'Settings for {{owner}}', owner: sourceOwnerLabel(task, t) })}
        </p>
      ) : null}
      {task?.failure && task.status !== 'failed' && task.status !== 'needs-attention' ? (
        <InlineAlert tone="warning">
          <div className="font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.setupTask.attentionTitle', { defaultValue: 'Needs your decision' })}
          </div>
          <div>{task.failure.reasonCode === 'AI_LOCAL_SELECTION_NOT_FOUND'
            ? t('runtimeConfig.setupTask.currentModelMissing', { defaultValue: "No local model is selected yet. Choose a model below to continue." })
            : task.failure.reasonCode === 'RUNTIME_SETUP_CURRENT_MODEL_NEEDS_PREPARATION'
              ? t('runtimeConfig.setupTask.currentModelBlocked', { defaultValue: "The current local model needs preparation. Choose a model below to continue." })
              : task.failure.message}</div>
        </InlineAlert>
      ) : null}
      {task?.failure?.machineSelected ? (
        <InlineAlert tone="warning" data-testid="runtime-setup-partial-completion">
          <div>{t('runtimeConfig.setupTask.machineSelectionCompleted', { defaultValue: "The model on this device was changed successfully." })}</div>
          <div>{task.failure.ownerSaveState === 'unknown'
            ? t('runtimeConfig.setupTask.ownerSaveUnknown', { defaultValue: "The app save result is unknown. Check the current settings before continuing; the model does not need to be prepared again." })
            : t('runtimeConfig.setupTask.ownerNotSaved', { defaultValue: "The app settings were not saved. You can continue saving them without preparing the model again." })}</div>
        </InlineAlert>
      ) : null}
      {actionError ? <InlineAlert tone="warning" data-testid="runtime-setup-action-error">{actionError}</InlineAlert> : null}
      {renderContent()}
      <span className="sr-only" role="status">{task ? t(`runtimeConfig.setupTask.status.${task.status}`, { defaultValue: task.status }) : ''}</span>
    </section>
  );
}

function EmptyStateLike(props: { readonly message: string }) {
  return <p className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">{props.message}</p>;
}
