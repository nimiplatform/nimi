// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeLocalTransferProgressEvent,
} from '@nimiplatform/sdk/runtime';
import { Button, InlineAlert, LoadingSkeleton, ProgressIndicator, StatusBadge } from '@nimiplatform/kit/ui';
import { ArrowLeft, Check, CheckCircle2, CircleAlert, Download, LoaderCircle, Package } from 'lucide-react';
import { formatBytes, formatDurationShort, formatTransferRate } from '../../components/download-format.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import { formatKnownDownloadSize } from './runtime-config-model-center-utils.js';
import { loadoutCandidatePresentation, loadoutSlotLabelKey } from './runtime-config-loadout-model-display.js';
import { capabilityIcon, modelDisplayTitle, recipeOfferSummary, setupPlanNeedsPreparation } from './runtime-capability-presentation.js';
import { displayRuntimeConfigCapabilityLabel, displayRuntimeConfigCapabilityUsage } from './runtime-config-capability-labels.js';
import {
  runtimeSetupTaskUnconfirmed,
  useRuntimeSetupTasks,
  type RuntimeSetupTask,
  type RuntimeSetupTaskStore,
} from './runtime-setup-task-store.js';
import {
  createRuntimeSetupCandidate,
  discardRuntimeSetupTask,
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

type PlanRowTone = 'ready' | 'pending' | 'warning';

/** One line of the preparation checklist: what it is, and what will happen to it. */
function PlanRow(props: {
  readonly tone: PlanRowTone;
  readonly icon: 'check' | 'download' | 'package' | 'alert';
  readonly title: string;
  readonly subtitle?: string;
  readonly trailing?: string;
  readonly trailingTone?: 'success' | 'warning' | 'info' | 'neutral';
  readonly children?: ReactNode;
  readonly testId?: string;
}) {
  const iconClass = props.tone === 'ready'
    ? 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success)]'
    : props.tone === 'warning'
      ? 'bg-[var(--nimi-status-warning-soft-bg,var(--nimi-surface-active))] text-[var(--nimi-status-warning)]'
      : 'bg-[var(--nimi-surface-active)] text-[var(--nimi-text-secondary)]';
  const Icon = props.icon === 'check' ? Check : props.icon === 'download' ? Download : props.icon === 'alert' ? CircleAlert : Package;
  return (
    <div className="flex items-start gap-3 py-3" data-testid={props.testId}>
      <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${iconClass}`} aria-hidden="true">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 text-sm font-medium text-[var(--nimi-text-primary)]">{props.title}</p>
          {props.trailing ? (
            <StatusBadge tone={props.trailingTone ?? 'neutral'} shape="soft" className="shrink-0">
              {props.trailing}
            </StatusBadge>
          ) : null}
        </div>
        {props.subtitle ? <p className="mt-0.5 text-xs text-[var(--nimi-text-secondary)]">{props.subtitle}</p> : null}
        {props.children}
      </div>
    </div>
  );
}

/**
 * Friendly naming for a runtime component. Known ids map to product names
 * and a plain-language state; unknown ids fall back to the raw identifier so
 * nothing is hidden, and the raw ids stay available under technical details.
 */
export function componentPresentation(
  item: { readonly dependencyFamily: string; readonly dependencyId: string; readonly state: string },
  t: (key: string, options?: Record<string, unknown>) => string,
): {
  readonly name: string;
  readonly family: string;
  readonly purpose: string;
  readonly state: string;
  readonly tone: 'success' | 'warning' | 'info' | 'neutral';
} {
  // Exact ids that carry a digest (a Python environment or package set) are
  // named by their family; the raw id stays under technical details.
  const familyName = t(`runtimeConfig.setupTask.componentFamilyName.${item.dependencyFamily}`, { defaultValue: '' });
  const name = t(`runtimeConfig.setupTask.component.${item.dependencyId}`, { defaultValue: familyName || item.dependencyId });
  const family = t(`runtimeConfig.setupTask.componentFamily.${item.dependencyFamily}`, { defaultValue: '' });
  const purpose = t(`runtimeConfig.setupTask.componentPurpose.${item.dependencyFamily}`, { defaultValue: '' });
  const state = t(`runtimeConfig.setupTask.componentState.${item.state}`, {
    defaultValue: t(`runtimeConfig.downloads.environment.${item.state}`, { defaultValue: item.state }),
  });
  const tone = item.state === 'ready_managed' || item.state === 'ready_system' || item.state === 'ready' || item.state === 'already_satisfied'
    ? 'success'
    : item.state === 'failed' || item.state === 'repair_required' || item.state === 'unsupported'
      ? 'warning'
      : 'info';
  return { name, family, purpose, state, tone };
}

/**
 * Exported for direct render tests: the reviewed preparation checklist,
 * including the awaiting-choice pickers and the installed-rebind honesty label.
 */
export function SetupTaskPlanReview(props: {
  readonly choiceGroup?: string;
  readonly plan: RuntimeSetupPreparationPlan;
  readonly choices: Readonly<Record<string, string>>;
  readonly onChoiceChange: (slotId: string, offerRef: string) => void;
  /** Source owner whose route is saved by the prepare-and-use confirmation. */
  readonly ownerLabel: string | null;
}) {
  const { t } = useTranslation();
  const unknownSize = t('runtimeConfig.setupTask.unknownSize', { defaultValue: 'size unknown' });
  const installedLabel = installedRebindLabel(t);
  const partLabel = (item: { slotId: string; label: string }) => {
    const key = loadoutSlotLabelKey(item.slotId);
    return key ? t(key) : item.label;
  };
  const needsPreparation = setupPlanNeedsPreparation(props.plan, props.choices);
  const requiredComponents = props.plan.components.filter((item) => item.required);
  const optionalComponents = props.plan.components.filter((item) => !item.required);
  const ready = !needsPreparation && props.plan.unavailable.length === 0 && !props.plan.environmentUnavailable;
  const downloads = props.plan.acquire.some((item) => !item.offer.installedModelAssetId) || props.plan.awaitingChoice.length > 0;
  return (
    <div className="space-y-5" data-testid="runtime-setup-task-plan">
      {ready ? (
        <p className="flex items-center gap-2 text-sm font-medium text-[var(--nimi-text-primary)]">
          <CheckCircle2 size={15} className="text-[var(--nimi-status-success)]" />
          {t('runtimeConfig.product.readyToUseSettings')}
        </p>
      ) : null}

      <section className="rounded-2xl bg-[var(--nimi-surface-card)] px-5 pb-1 pt-4">
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.setupTask.checklistTitle', { defaultValue: 'What will happen' })}
        </h3>
        <div className="mt-1 divide-y divide-[var(--nimi-border-subtle)]">
          {props.plan.reuse.map((item) => (
            <PlanRow
              key={`reuse:${item.slotId}`}
              tone="ready"
              icon="check"
              title={partLabel(item)}
              subtitle={t('runtimeConfig.setupTask.rowReuse', { defaultValue: 'Model files already on this device are reused.' })}
              trailing={installedLabel}
              trailingTone="success"
            />
          ))}
          {props.plan.acquire.map((item) => {
            const installed = !!item.offer.installedModelAssetId;
            return (
              <PlanRow
                key={`acquire:${item.slotId}`}
                tone={installed ? 'ready' : 'warning'}
                icon={installed ? 'check' : 'download'}
                title={item.offer.title}
                subtitle={installed
                  ? partLabel(item)
                  : t('runtimeConfig.setupTask.rowDownload', { defaultValue: '{{part}} · will be downloaded', part: partLabel(item) })}
                trailing={installed ? installedLabel : scopeSizeLabel(item.offer.sizeBytes, unknownSize)}
                trailingTone={installed ? 'success' : 'warning'}
              >
                {!installed && (item.offer.license || item.offer.publisher) ? (
                  <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]" data-testid={`runtime-setup-offer-terms:${item.slotId}`}>
                    {[
                      item.offer.publisher ? t('runtimeConfig.setupTask.rowPublisher', { defaultValue: 'Source: {{publisher}}', publisher: item.offer.publisher }) : '',
                      item.offer.license ? t('runtimeConfig.setupTask.rowLicense', { defaultValue: 'License: {{license}}', license: item.offer.license }) : '',
                    ].filter(Boolean).join(' · ')}
                  </p>
                ) : null}
              </PlanRow>
            );
          })}
          {props.plan.awaitingChoice.map((choice) => (
            <PlanRow
              key={`choice:${choice.slotId}`}
              tone="pending"
              icon="alert"
              title={choice.label}
              subtitle={t('runtimeConfig.setupTask.rowChoice', { defaultValue: 'Choose which version to use.' })}
              testId={`runtime-setup-task-choice:${choice.slotId}`}
            >
              <div className="mt-2 space-y-1.5">
                {choice.options.map((option) => {
                  const presentation = loadoutCandidatePresentation({ title: option.title, variantLabel: option.variantLabel });
                  const selected = props.choices[choice.slotId] === option.offerRef;
                  return (
                    <label key={option.offerRef} className="flex cursor-pointer items-center gap-2 text-sm text-[var(--nimi-text-secondary)]">
                      <input
                        type="radio"
                        name={`runtime-setup-choice-${props.choiceGroup ?? 'task'}-${choice.slotId}`}
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
            </PlanRow>
          ))}
          {[...requiredComponents, ...optionalComponents].map((item) => {
            const shown = componentPresentation(item, t);
            return (
              <PlanRow
                key={`component:${item.dependencyFamily}/${item.dependencyId}`}
                tone={shown.tone === 'success' ? 'ready' : shown.tone === 'warning' ? 'warning' : 'pending'}
                icon={shown.tone === 'success' ? 'check' : 'package'}
                title={shown.name}
                subtitle={[shown.purpose || shown.family, item.required
                  ? t('runtimeConfig.setupTask.rowComponentRequired', { defaultValue: 'Installed automatically for this model' })
                  : t('runtimeConfig.setupTask.rowComponentOptional', { defaultValue: 'Optional' })]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={shown.state}
                trailingTone={shown.tone}
              />
            );
          })}
        </div>
      </section>

      {props.plan.awaitingChoice.some((choice) => choice.options.some((option) => option.recommended)) ? (
        <Button tone="secondary" size="sm" data-testid="runtime-setup-accept-recommendations" onClick={() => {
          for (const choice of props.plan.awaitingChoice) {
            const recommended = choice.options.find((option) => option.recommended);
            if (recommended) props.onChoiceChange(choice.slotId, recommended.offerRef);
          }
        }}>{t('runtimeConfig.setupTask.acceptRecommendations', { defaultValue: "Use device recommendations" })}</Button>
      ) : null}
      {downloads || props.plan.components.length > 0 ? (
        <p className="text-xs leading-relaxed text-[var(--nimi-text-muted)]" data-testid="runtime-setup-download-scope">
          {[
            downloads ? t('runtimeConfig.setupTask.directDownloadNote', { defaultValue: 'Models are downloaded by this device directly from their publisher; using them is subject to each license.' }) : '',
            props.plan.components.length > 0
              ? typeof props.plan.componentsDownloadBytes === 'number'
                ? t('runtimeConfig.setupTask.componentsDownloadKnown', { defaultValue: 'Runtime components download about {{size}} more.', size: formatBytes(props.plan.componentsDownloadBytes) })
                : t('runtimeConfig.setupTask.componentsDownloadUnknown', { defaultValue: 'Runtime components also need downloading; their size can’t be estimated yet and is not included in the model download above.' })
              : '',
          ].filter(Boolean).join(' ')}
        </p>
      ) : null}
      {props.plan.environmentUnavailable ? (
        <InlineAlert tone="warning" data-testid="runtime-setup-environment-unavailable">
          <div>{t('runtimeConfig.setupTask.environmentUnavailable', { defaultValue: "This model has no managed runtime environment on this device, so it can't be prepared here. Nothing will be downloaded and the current model stays unchanged." })}</div>
        </InlineAlert>
      ) : null}
      {props.plan.unavailable.length > 0 ? (
        <InlineAlert tone="warning" data-testid="runtime-setup-unavailable">
          <div>{t('runtimeConfig.setupTask.resourcesUnavailable', { defaultValue: "Some required resources are unavailable. Choose another model or manage files in the model library." })}</div>
          <ul className="mt-2 list-disc pl-4">{props.plan.unavailable.map((item) => <li key={item.slotId}>{item.label}</li>)}</ul>
        </InlineAlert>
      ) : null}
      {props.plan.options.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.setupTask.scope.options', { defaultValue: 'Optional features' })}
          </summary>
          <ul className="mt-1 space-y-1 pl-4 text-[var(--nimi-text-secondary)]">
            {props.plan.options.map((item) => (
              <li key={item.slotId}>{partLabel(item)}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="text-xs text-[var(--nimi-text-muted)]">
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
      </p>
      {props.plan.components.length > 0 ? (
        <details className="text-xs text-[var(--nimi-text-secondary)]">
          <summary className="cursor-pointer">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
            {props.plan.components.map((item) => (
              <div key={`raw:${item.dependencyFamily}/${item.dependencyId}`} className="contents">
                <dt className="break-all">{item.dependencyFamily} / {item.dependencyId}</dt>
                <dd>{item.state}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

const PREPARATION_STAGES = ['download', 'verify', 'components', 'finish'] as const;
type PreparationStage = (typeof PREPARATION_STAGES)[number];

/**
 * Stage of a running preparation derived from observed transfer events and
 * the task's own status. Nothing is guessed: with no events yet the first
 * stage is simply "current".
 */
export function preparationStage(input: {
  readonly status: RuntimeSetupTask['status'];
  readonly events: readonly NimiRuntimeLocalTransferProgressEvent[];
  readonly hasComponents: boolean;
}): PreparationStage {
  if (input.status === 'committing') return 'finish';
  const active = input.events.filter((event) => !event.done);
  if (active.length > 0) {
    return active.some((event) => event.phase !== 'verify') ? 'download' : 'verify';
  }
  if (input.hasComponents) return 'components';
  return input.events.length > 0 ? 'finish' : 'download';
}

function PreparationProgress(props: {
  readonly task: RuntimeSetupTask;
  readonly progress: Readonly<Record<string, NimiRuntimeLocalTransferProgressEvent>>;
}) {
  const { t } = useTranslation();
  const events = props.task.refs.installPlanIds.map((planId) => props.progress[planId]).filter((event): event is NimiRuntimeLocalTransferProgressEvent => !!event);
  const stage = preparationStage({ status: props.task.status, events, hasComponents: props.task.refs.dependencyJobIds.length > 0 });
  const stageIndex = PREPARATION_STAGES.indexOf(stage);
  const active = events.filter((event) => !event.done);
  const bytesAcquired = active.reduce((total, event) => total + event.bytesReceived + event.bytesReused, 0);
  const bytesTotal = active.every((event) => typeof event.bytesTotal === 'number' && event.bytesTotal > 0)
    ? active.reduce((total, event) => total + (event.bytesTotal ?? 0), 0)
    : null;
  const speed = active.reduce((total, event) => total + (event.speedBytesPerSec ?? 0), 0);
  const eta = active.reduce<number | null>((longest, event) => (
    typeof event.etaSeconds === 'number' ? Math.max(longest ?? 0, event.etaSeconds) : longest
  ), null);
  return (
    <div className="space-y-4 rounded-xl bg-[var(--nimi-surface-card)] p-4" data-testid="runtime-setup-task-stages">
      <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label={t('runtimeConfig.setupTask.stages.title')}>
        {PREPARATION_STAGES.map((item, index) => {
          const tone = index < stageIndex ? 'done' : index === stageIndex ? 'current' : 'pending';
          const toneClass = tone === 'current'
            ? 'bg-[var(--nimi-action-primary-bg)] font-medium text-[var(--nimi-action-primary-text)]'
            : tone === 'done'
              ? 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]'
              : 'bg-[var(--nimi-surface-active)] text-[var(--nimi-text-muted)]';
          const toneIcon = tone === 'done'
            ? <CheckCircle2 size={12} />
            : tone === 'current'
              ? <LoaderCircle size={12} className="animate-spin" />
              : null;
          return (
            <li key={item} className="flex items-center gap-2">
              <span
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${toneClass}`}
                aria-current={tone === 'current' ? 'step' : undefined}
              >
                {toneIcon}
                {t(`runtimeConfig.setupTask.stages.${item}`)}
              </span>
              {index < PREPARATION_STAGES.length - 1 ? <span className="text-[var(--nimi-text-muted)]">›</span> : null}
            </li>
          );
        })}
      </ol>
      {active.length > 0 ? (
        <div className="space-y-1.5">
          <ProgressIndicator value={bytesTotal ? bytesAcquired : undefined} max={bytesTotal ?? undefined} showValue aria-label={t('runtimeConfig.setupTask.stages.download')} />
          <p className="flex flex-wrap gap-x-3 text-xs tabular-nums text-[var(--nimi-text-secondary)]">
            <span>{formatBytes(bytesAcquired)}{bytesTotal ? ` / ${formatBytes(bytesTotal)}` : ''}</span>
            {speed > 0 ? <span>{formatTransferRate(speed)}</span> : null}
            {eta !== null && eta > 0 ? <span>{t('runtimeConfig.setupTask.stages.eta', { time: formatDurationShort(eta) })}</span> : null}
          </p>
        </div>
      ) : null}
      {active.length > 1 ? (
        <ul className="space-y-1 text-xs text-[var(--nimi-text-secondary)]">
          {active.map((event) => (
            <li key={event.installSessionId} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{event.sourceLabel || event.modelAssetId || event.installSessionId}</span>
              <span className="shrink-0 tabular-nums">{formatBytes(event.bytesReceived + event.bytesReused)}{event.bytesTotal ? ` / ${formatBytes(event.bytesTotal)}` : ''}</span>
            </li>
          ))}
        </ul>
      ) : null}
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
  // A recipe without any downloadable offer can only use files already on this
  // device: its version choices open directly instead of a doomed review.
  const draftRecipe = recipes.find((entry) => entry.recipeId === selectedRecipeId) ?? null;
  const draftWithoutDirectDownload = draftRecipe ? recipeOfferSummary(draftRecipe).withoutOffer > 0 : false;
  useEffect(() => {
    if (draftWithoutDirectDownload) setAdvancedOpen(true);
  }, [draftWithoutDirectDownload, selectedRecipeId]);

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

  const resolvePlan = useCallback(async (acceptExternalCandidateState?: boolean): Promise<RuntimeSetupPreparationPlan | null> => {
    setActionError('');
    const result = await resolveRuntimeSetupPreparation(props.store, props.taskId, props.ports, {
      acceptExternalCandidateState,
    });
    if (result.status === 'ok') {
      setPlan(result.value);
      setChoices(previous => ({ ...recommendedChoices(result.value), ...previous }));
      return result.value;
    }
    if (result.status === 'blocked') setActionError(result.failure.message);
    return null;
  }, [props.ports, props.store, props.taskId]);

  // "Use this model" from the draft: resolve the plan, and when nothing needs
  // preparing apply it right away instead of asking for a second confirmation.
  const useResolvedPlan = useCallback(async () => {
    const resolved = await resolvePlan();
    if (!resolved) return;
    const chosen = recommendedChoices(resolved);
    if (!setupPlanIsDirect(resolved, chosen)) return;
    const result = await runRuntimeSetupPreparation(props.store, props.taskId, props.ports, {
      mode: 'prepare-and-use',
      reviewedPlan: resolved,
      choices: chosen,
    });
    if (result.status === 'blocked') setActionError(result.failure.message);
  }, [props.ports, props.store, props.taskId, resolvePlan]);

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
      await useResolvedPlan();
    })().finally(() => setBusy(false));
  }, [props.ports, props.store, props.taskId, selectedRecipeId, task, useResolvedPlan]);

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

  // Leaving a setup that was never confirmed discards it rather than keeping
  // it as unfinished work; choosing a model again starts a fresh one.
  const onBack = useCallback(() => {
    if (task && runtimeSetupTaskUnconfirmed(task)) discardRuntimeSetupTask(props.store, task.taskId);
    props.onClose();
  }, [props.onClose, props.store, task]);

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
          {candidateRecipe && candidate ? (
            <details
              className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] p-3"
              open={advancedOpen}
              onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-xs font-semibold text-[var(--nimi-text-secondary)]">
                {t('runtimeConfig.setupTask.advancedToggle', { defaultValue: 'Version and options' })}
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
          <Button tone="primary" disabled={busy} onClick={() => { setBusy(true); void useResolvedPlan().finally(() => setBusy(false)); }} data-testid="runtime-setup-task-review">
            {t('runtimeConfig.setupTask.useModel', { defaultValue: 'Use this model' })}
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
        {selectedRecipe && draftWithoutDirectDownload ? (
          <InlineAlert tone="info" data-testid="runtime-setup-no-direct-download">
            {t('runtimeConfig.setupTask.noDirectDownloadHint', { defaultValue: 'This model has no direct download. Choose model files already on this device under Version and options, or import model files first.' })}
          </InlineAlert>
        ) : null}
        {selectedRecipe ? (
          <details
            className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] p-3"
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer text-xs font-semibold text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.setupTask.advancedToggle', { defaultValue: 'Version and options' })}
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
          {t('runtimeConfig.setupTask.useModel', { defaultValue: 'Use this model' })}
        </Button>
      </div>
    );
  };

  // The header names the capability being set up and what it is for; the
  // model under setup is a secondary line once its candidate is known.
  const capabilityLabel = task ? displayRuntimeConfigCapabilityLabel(task.capabilityContract, t) : '';
  const capabilityUsage = task ? displayRuntimeConfigCapabilityUsage(task.capabilityContract, t) : '';
  const HeroIcon = capabilityIcon(task?.capabilityContract ?? '');
  const candidateName = candidateInfo?.candidate?.displayName ?? candidateInfo?.recipe?.title ?? '';
  const modelTitle = candidateName ? modelDisplayTitle(candidateName) : '';

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
        const direct = !!plan && !setupPlanNeedsPreparation(plan, choices);
        const blockedConfirm = busy || !plan || plan.unavailable.length > 0 || Boolean(plan.environmentUnavailable)
          || plan.awaitingChoice.some((choice) => !choices[choice.slotId]);
        const downloadBytes = plan ? setupPlanDownloadBytes(plan, choices) : null;
        const confirmLabel = direct
          ? t('runtimeConfig.product.useTheseSettings')
          : downloadBytes !== null && downloadBytes > 0
            ? t('runtimeConfig.setupTask.downloadAndUse', { defaultValue: 'Download & start · {{size}}', size: formatBytes(downloadBytes) })
            : t('runtimeConfig.setupTask.prepareAndUse');
        return (
          <div className="space-y-5">
            {plan ? (
              <SetupTaskPlanReview plan={plan} choices={choices} onChoiceChange={onChoiceChange} ownerLabel={task.source.kind === 'runtime' ? null : sourceOwnerLabel(task, t)} />
            ) : (
              <LoadingSkeleton className="h-32 w-full" />
            )}
            <div className="space-y-3 border-t border-[var(--nimi-border-subtle)] pt-4">
              {plan ? (
                <p className="max-w-2xl text-sm text-[var(--nimi-text-secondary)]" data-testid="runtime-setup-confirm-lead">
                  {t(direct ? 'runtimeConfig.setupTask.confirmLeadReady' : 'runtimeConfig.setupTask.confirmLead', {
                    defaultValue: direct
                      ? 'Nothing needs preparing. {{model}} becomes the current model for {{capability}} on this device as soon as you confirm.'
                      : 'After you confirm, Nimi prepares everything above by itself. When it finishes, {{model}} becomes the current model for {{capability}} on this device.',
                    model: modelTitle || capabilityLabel,
                    capability: capabilityLabel,
                  })}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  tone="primary"
                  disabled={blockedConfirm}
                  onClick={() => onConfirm('prepare-and-use')}
                  data-testid="runtime-setup-task-prepare-and-use"
                >
                  {confirmLabel}
                </Button>
                {plan && !direct ? (
                  <Button
                    tone="ghost"
                    size="sm"
                    disabled={blockedConfirm}
                    onClick={() => onConfirm('prepare-only')}
                    data-testid="runtime-setup-task-prepare-only"
                  >
                    {t('runtimeConfig.setupTask.prepareOnly', { defaultValue: 'Prepare only' })}
                  </Button>
                ) : null}
                <Button tone="ghost" size="sm" disabled={busy} onClick={() => {
                  props.store.updateTask(task.taskId, () => ({ status: 'draft', nextAction: 'review-preparation' }));
                  setAdvancedOpen(true);
                }}>{t('runtimeConfig.product.customize')}</Button>
                {plan && (plan.unavailable.length > 0 || plan.environmentUnavailable) ? (
                  <Button tone="ghost" size="sm" disabled={busy} onClick={() => {
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
          </div>
        );
      }
      case 'preparing':
      case 'committing': {
        return (
          <div className="space-y-3" data-testid="runtime-setup-task-progress">
            <PreparationProgress task={task} progress={progress} />
            <details className="text-sm">
              <summary className="cursor-pointer text-[var(--nimi-text-secondary)]">{t('runtimeConfig.setupTask.receipt.scopeDetails')}</summary>
              <div className="mt-2"><SetupTaskScopeList task={task} /></div>
            </details>
            <div className="flex flex-wrap items-center gap-3">
              <Button tone="secondary" size="sm" onClick={() => stopRuntimeSetupTask(props.store, props.taskId)} data-testid="runtime-setup-task-stop">
                {t('runtimeConfig.setupTask.stop', { defaultValue: 'Stop' })}
              </Button>
              <span className="text-xs text-[var(--nimi-text-muted)]">
                {t('runtimeConfig.setupTask.closingKeepsRunning', { defaultValue: 'Closing this page does not cancel the task.' })}
              </span>
            </div>
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
    <section className="min-w-0 space-y-6" data-testid="runtime-setup-task-view" aria-label={t('runtimeConfig.setupTask.title', { defaultValue: 'Setup task' })}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button tone="ghost" size="sm" onClick={onBack} data-testid="runtime-setup-task-close">
          <ArrowLeft size={15} />
          {task ? t('runtimeConfig.setupTask.backToCapability', { defaultValue: 'Back to {{capability}}', capability: capabilityLabel }) : t('runtimeConfig.setupTask.close', { defaultValue: 'Close' })}
        </Button>
        {/* Back already discards an unconfirmed setup; only a reopened one that ran before needs an explicit cancel. */}
        {task && (task.status === 'draft' || task.status === 'review') && !runtimeSetupTaskUnconfirmed(task) ? (
          <Button tone="ghost" size="sm" onClick={() => stopRuntimeSetupTask(props.store, props.taskId)} data-testid="runtime-setup-task-stop-early">
            {t('runtimeConfig.setupTask.cancelSetup', { defaultValue: 'Cancel this setup' })}
          </Button>
        ) : null}
      </div>
      {task ? (
        <header className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]">
            <HeroIcon size={25} strokeWidth={1.6} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="runtime-setup-hero-title">{capabilityLabel}</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--nimi-text-secondary)]" data-testid="runtime-setup-hero-usage">
              {capabilityUsage}
            </p>
            {modelTitle ? (
              <p className="mt-2 text-xs text-[var(--nimi-text-muted)]" data-testid="runtime-setup-hero-model">
                {t('runtimeConfig.setupTask.heroModel', { defaultValue: 'Model for this setup: {{model}}', model: modelTitle })}
              </p>
            ) : null}
          </div>
        </header>
      ) : null}
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

/** Slot choices pre-filled with the device recommendation for each pending choice. */
function recommendedChoices(plan: RuntimeSetupPreparationPlan): Record<string, string> {
  return Object.fromEntries(plan.awaitingChoice.flatMap(choice => {
    const recommendation = choice.options.find(option => option.recommended);
    return recommendation ? [[choice.slotId, recommendation.offerRef]] : [];
  }));
}

/** A plan that needs nothing from the user or the network can be applied on the spot. */
function setupPlanIsDirect(plan: RuntimeSetupPreparationPlan, choices: Readonly<Record<string, string>>): boolean {
  return plan.unavailable.length === 0
    && !plan.awaitingChoice.some((choice) => !choices[choice.slotId])
    && !setupPlanNeedsPreparation(plan, choices);
}

/** Total bytes the plan will download, or null when any size is unknown. */
function setupPlanDownloadBytes(plan: RuntimeSetupPreparationPlan, choices: Readonly<Record<string, string>>): number | null {
  let total = 0;
  const offers = [
    ...plan.acquire.map((item) => item.offer),
    ...plan.awaitingChoice.map((item) => item.options.find((option) => option.offerRef === choices[item.slotId])),
  ];
  for (const offer of offers) {
    if (!offer || offer.installedModelAssetId) continue;
    if (offer.sizeBytes === null) return null;
    total += offer.sizeBytes;
  }
  return total;
}

function EmptyStateLike(props: { readonly message: string }) {
  return <p className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">{props.message}</p>;
}
