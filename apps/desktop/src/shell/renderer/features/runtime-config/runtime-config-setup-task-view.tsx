// @nimi-authority: rule.nimi.desktop.ai-consumption.r026

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeLocalTransferProgressEvent,
} from '@nimiplatform/sdk/runtime';
import { Button, IconButton, InlineAlert, LoadingSkeleton, ProgressIndicator, StatusBadge } from '@nimiplatform/kit/ui';
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, LoaderCircle, X } from 'lucide-react';
import { formatBytes, formatDurationShort, formatTransferRate } from '../../components/download-format.js';
import { IdentityTile } from '../../components/identity-tile.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import { formatKnownDownloadSize } from './runtime-config-model-center-utils.js';
import {
  groupLoadoutModelPresentations,
  loadoutCandidatePresentation,
  loadoutSlotLabelKey,
  loadoutSlotOfferForAsset,
} from './runtime-config-loadout-model-display.js';
import { capabilityIcon, modelDisplayTitle, modelFamilySeed, recipeOfferSummary, setupPlanNeedsPreparation } from './runtime-capability-presentation.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
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
import { RuntimeSetupFailureMessage } from './runtime-setup-failure-message.js';

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

/** Product name of a model file, e.g. "Gemma 4 2B · Q8"; the catalog title when nothing parses. */
function offerHeadline(offer: { readonly title: string; readonly variantLabel: string }): string {
  return loadoutCandidatePresentation({ title: offer.title, variantLabel: offer.variantLabel }).headline || offer.title;
}

/** One line of the summary card: what it is, and what happens to it. */
type PlanSummaryRow = {
  readonly key: string;
  readonly label: string;
  /** Screen-reader-only label for a row that repeats the one above it. */
  readonly labelHidden?: boolean;
  readonly value: ReactNode;
  readonly trailing?: ReactNode;
  /** Content under the line, spanning the value and trailing columns. */
  readonly panel?: ReactNode;
  readonly testId?: string;
  /** A model file keeps its parts, so the main one can lead a card as the model itself. */
  readonly file?: PlanFileParts;
};

type PlanFileParts = {
  readonly slotId: string;
  /** Product name, or the "no version selected" placeholder. */
  readonly name: string;
  readonly placeholder?: boolean;
  readonly badge?: ReactNode;
  /** Download size, or the installed-rebind label. */
  readonly state?: string;
  readonly toggle?: ReactNode;
  readonly terms?: ReactNode;
};

/** A details disclosure drawn like the capability card's technical details: a turning chevron, no native marker. */
function Disclosure(props: {
  readonly summary: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <details className={`group ${props.className ?? ''}`} data-testid={props.testId}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-[var(--nimi-radius-sm)] text-xs font-medium text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)] [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
        {props.summary}
      </summary>
      <div className="mt-2 pl-5">{props.children}</div>
    </details>
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
 * Exported for direct render tests: the reviewed preparation scope as one
 * summary card. Every model file and runtime component is one line; a pending
 * version choice shows the selected version and opens the versions grouped by
 * model size on request, with the device recommendation marked. Files already
 * on the device keep the installed-rebind honesty label instead of a size.
 * Optional model files stay with the advanced settings, where they can be
 * turned on.
 *
 * Embedded in a card (the capability overview), the main model file leads
 * as the model itself, drawn like the current-model card: identity tile,
 * name, then size and version choice. The other lines sit flush under it,
 * and the confirmation follows in the same text column.
 */
export function SetupTaskPlanReview(props: {
  readonly choiceGroup?: string;
  readonly plan: RuntimeSetupPreparationPlan;
  readonly choices: Readonly<Record<string, string>>;
  readonly onChoiceChange: (slotId: string, offerRef: string) => void;
  /** Recipe of the candidate; it names reused model files and, embedded, the model family. */
  readonly recipe?: NimiLoadoutRecipe | null;
  readonly disabled?: boolean;
  readonly embedded?: boolean;
  /** Embedded only: controls at the end of the model's name line, such as close. */
  readonly aside?: ReactNode;
  /** Embedded only: what follows the summary in its text column, such as the confirmation. */
  readonly footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const [openChoices, setOpenChoices] = useState<Readonly<Record<string, boolean>>>({});
  const unknownSize = t('runtimeConfig.setupTask.unknownSize', { defaultValue: 'size unknown' });
  const installedLabel = installedRebindLabel(t);
  const partLabel = (item: { slotId: string; label: string }) => {
    const key = loadoutSlotLabelKey(item.slotId);
    return key ? t(key, { defaultValue: item.label }) : item.label;
  };
  // A single model file is simply "Model"; several are told apart by their part.
  const fileCount = props.plan.reuse.length + props.plan.acquire.length + props.plan.awaitingChoice.length;
  const fileLabel = (item: { slotId: string; label: string }) => (
    fileCount === 1 ? t('runtimeConfig.setupTask.summary.model', { defaultValue: 'Model' }) : partLabel(item)
  );
  const fileState = (offer: { readonly installedModelAssetId?: string; readonly sizeBytes: number | null }) => (
    offer.installedModelAssetId ? installedLabel : scopeSizeLabel(offer.sizeBytes, unknownSize)
  );
  const offerTerms = (slotId: string, offer: { readonly installedModelAssetId?: string; readonly publisher?: string; readonly license?: string }) => (
    !offer.installedModelAssetId && (offer.publisher || offer.license) ? (
      <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]" data-testid={`runtime-setup-offer-terms:${slotId}`}>
        {[
          offer.publisher ? t('runtimeConfig.setupTask.rowPublisher', { defaultValue: 'Source: {{publisher}}', publisher: offer.publisher }) : '',
          offer.license ? t('runtimeConfig.setupTask.rowLicense', { defaultValue: 'License: {{license}}', license: offer.license }) : '',
        ].filter(Boolean).join(' · ')}
      </p>
    ) : null
  );
  const recommendedBadge = (
    <StatusBadge tone="info" shape="soft" className="shrink-0 whitespace-nowrap">
      {t('runtimeConfig.setupTask.deviceRecommended', { defaultValue: 'Recommended for this device' })}
    </StatusBadge>
  );

  // A model file line is assembled from its parts, which an embedded card can also lay out as the model itself.
  const fileRow = (row: Omit<PlanSummaryRow, 'value' | 'trailing' | 'file'> & { readonly file: PlanFileParts }): PlanSummaryRow => ({
    ...row,
    value: (
      <div className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={row.file.placeholder ? 'min-w-0 text-[var(--nimi-text-muted)]' : 'min-w-0 font-medium text-[var(--nimi-text-primary)]'}>
            {row.file.name}
          </span>
          {row.file.badge}
        </span>
        {row.file.terms}
      </div>
    ),
    trailing: (
      <span className="flex items-center justify-end gap-2">
        {row.file.state ? <span className="whitespace-nowrap">{row.file.state}</span> : null}
        {row.file.toggle}
      </span>
    ),
  });

  const rows: PlanSummaryRow[] = [];
  for (const item of props.plan.reuse) {
    const slot = props.recipe?.slots.find((entry) => entry.slotId === item.slotId);
    const offer = loadoutSlotOfferForAsset(slot, item.modelAssetId);
    rows.push(fileRow({
      key: `reuse:${item.slotId}`,
      label: fileLabel(item),
      file: { slotId: item.slotId, name: offer ? offerHeadline(offer.candidate) : partLabel(item), state: installedLabel },
    }));
  }
  for (const item of props.plan.acquire) {
    rows.push(fileRow({
      key: `acquire:${item.slotId}`,
      label: fileLabel(item),
      file: { slotId: item.slotId, name: offerHeadline(item.offer), state: fileState(item.offer), terms: offerTerms(item.slotId, item.offer) },
    }));
  }
  for (const choice of props.plan.awaitingChoice) {
    const selected = choice.options.find((option) => option.offerRef === props.choices[choice.slotId]);
    const recommended = choice.options.find((option) => option.recommended);
    // Nothing to show on the line until a version is picked, so start open.
    const open = openChoices[choice.slotId] ?? !selected;
    const panelId = `runtime-setup-versions-${props.choiceGroup ?? 'task'}-${choice.slotId}`;
    const present = (option: (typeof choice.options)[number]) => loadoutCandidatePresentation({ title: option.title, variantLabel: option.variantLabel });
    const groups = groupLoadoutModelPresentations(choice.options, present);
    const toggleLabel = open
      ? t('runtimeConfig.setupTask.hideVersions', { defaultValue: 'Hide versions' })
      : t('runtimeConfig.setupTask.changeVersion', { defaultValue: 'Change version' });
    const ToggleIcon = open ? ChevronUp : ChevronDown;
    const toggleProps = {
      'aria-expanded': open,
      'aria-controls': panelId,
      onClick: () => setOpenChoices((previous) => ({ ...previous, [choice.slotId]: !open })),
      'data-testid': `runtime-setup-task-choice-toggle:${choice.slotId}`,
    };
    rows.push(fileRow({
      key: `choice:${choice.slotId}`,
      label: fileLabel(choice),
      testId: `runtime-setup-task-choice:${choice.slotId}`,
      file: {
        slotId: choice.slotId,
        name: selected ? offerHeadline(selected) : t('runtimeConfig.setupTask.versionUnselected', { defaultValue: 'No version selected' }),
        placeholder: !selected,
        badge: selected?.recommended ? recommendedBadge : undefined,
        state: selected ? fileState(selected) : undefined,
        terms: selected ? offerTerms(choice.slotId, selected) : undefined,
        // Beside the model's size the choice reads as an inline link; in the summary grid it is a ghost button.
        toggle: props.embedded ? (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 rounded-[var(--nimi-radius-sm)] font-medium text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)] focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[color:var(--nimi-focus-ring-color)]"
            {...toggleProps}
          >
            {toggleLabel}
            <ToggleIcon size={14} aria-hidden="true" />
          </button>
        ) : (
          <Button tone="ghost" size="sm" trailingIcon={<ToggleIcon size={14} />} {...toggleProps}>
            {toggleLabel}
          </Button>
        ),
      },
      panel: open ? (
        <div
          id={panelId}
          role="radiogroup"
          aria-label={t('runtimeConfig.setupTask.versionListLabel', { defaultValue: 'Choose a version' })}
          className="space-y-3"
        >
          {groups.map((group) => {
            // A group names the model size once, so its versions only need the quantization.
            const named = group.items.some((option) => present(option).quant.short);
            return (
              <div key={group.key} className="space-y-0.5">
                {named ? <p className="px-2 pb-0.5 text-xs font-medium text-[var(--nimi-text-muted)]">{group.title}</p> : null}
                {group.items.map((option) => {
                  const isSelected = option.offerRef === selected?.offerRef;
                  return (
                    <label
                      key={option.offerRef}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--nimi-action-ghost-hover)] ${isSelected ? 'bg-[var(--nimi-surface-active)]' : ''}`}
                    >
                      <input
                        type="radio"
                        className="shrink-0 accent-[var(--nimi-action-primary-bg)]"
                        name={`runtime-setup-choice-${props.choiceGroup ?? 'task'}-${choice.slotId}`}
                        checked={isSelected}
                        disabled={props.disabled}
                        onChange={() => props.onChoiceChange(choice.slotId, option.offerRef)}
                      />
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 truncate text-[var(--nimi-text-primary)]">
                          {(named && present(option).quant.short) || offerHeadline(option)}
                        </span>
                        {option.recommended ? recommendedBadge : null}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-[var(--nimi-text-muted)]">{fileState(option)}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
          {recommended && selected && selected.offerRef !== recommended.offerRef ? (
            <Button
              tone="ghost"
              size="sm"
              onClick={() => props.onChoiceChange(choice.slotId, recommended.offerRef)}
              disabled={props.disabled}
              data-testid={`runtime-setup-restore-recommendation:${choice.slotId}`}
            >
              {t('runtimeConfig.setupTask.restoreRecommendation', { defaultValue: 'Back to the recommended version' })}
            </Button>
          ) : null}
        </div>
      ) : undefined,
    }));
  }
  const components = [
    ...props.plan.components.filter((item) => item.required),
    ...props.plan.components.filter((item) => !item.required),
  ];
  components.forEach((item, index) => {
    const shown = componentPresentation(item, t);
    rows.push({
      key: `component:${item.dependencyFamily}/${item.dependencyId}`,
      label: t('runtimeConfig.setupTask.summary.component', { defaultValue: 'Component' }),
      labelHidden: index > 0,
      value: (
        <span className="min-w-0 text-[var(--nimi-text-primary)]">
          {shown.name}
          {item.required ? null : (
            <span className="ml-2 text-xs text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.setupTask.rowComponentOptional', { defaultValue: 'Optional' })}
            </span>
          )}
          {shown.purpose ? <span className="mt-0.5 block text-xs text-[var(--nimi-text-muted)]">{shown.purpose}</span> : null}
        </span>
      ),
      trailing: (
        <span className={shown.tone === 'warning' ? 'text-[var(--nimi-status-warning)]' : undefined}>{shown.state}</span>
      ),
    });
  });

  const summaryGrid = (lines: readonly PlanSummaryRow[], className: string, dividerAbove: boolean) => (
    <dl className={`grid grid-cols-[max-content_minmax(0,1fr)_auto] text-sm ${className}`}>
      {lines.map((row, index) => {
        // Cells stretch to the row height so the divider stays one straight line.
        const divider = dividerAbove || index > 0 ? 'border-t border-[var(--nimi-border-subtle)]' : '';
        return (
          <Fragment key={row.key}>
            <dt className={`flex items-center py-3 pr-6 text-[var(--nimi-text-secondary)] ${divider}`}>
              <span className={row.labelHidden ? 'sr-only' : undefined}>{row.label}</span>
            </dt>
            <dd className={`flex min-w-0 items-center py-3 pr-4 ${divider}`} data-testid={row.testId}>{row.value}</dd>
            <dd className={`flex items-center justify-end py-3 text-xs text-[var(--nimi-text-secondary)] ${divider}`}>{row.trailing}</dd>
            {row.panel ? <dd className="col-span-2 col-start-2 pb-3">{row.panel}</dd> : null}
          </Fragment>
        );
      })}
    </dl>
  );
  const downloads = props.plan.acquire.some((item) => !item.offer.installedModelAssetId) || props.plan.awaitingChoice.length > 0;
  const downloadScope = downloads || props.plan.components.length > 0 ? (
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
  ) : null;
  const environmentUnavailable = props.plan.environmentUnavailable ? (
    <InlineAlert tone="warning" data-testid="runtime-setup-environment-unavailable">
      <div>{t('runtimeConfig.setupTask.environmentUnavailable', { defaultValue: "This model has no managed runtime environment on this device, so it can't be prepared here. Nothing will be downloaded and the current model stays unchanged." })}</div>
    </InlineAlert>
  ) : null;
  const unavailable = props.plan.unavailable.length > 0 ? (
    <InlineAlert tone="warning" data-testid="runtime-setup-unavailable">
      <div>{t('runtimeConfig.setupTask.resourcesUnavailable', { defaultValue: "Some required resources are unavailable. Choose another model or manage files in the model library." })}</div>
      <ul className="mt-2 list-disc pl-4">{props.plan.unavailable.map((item) => <li key={item.slotId}>{partLabel(item)}</li>)}</ul>
    </InlineAlert>
  ) : null;
  const technicalDetails = props.plan.components.length > 0 ? (
    <Disclosure summary={t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}>
      <dl className="grid gap-x-4 gap-y-1 text-xs text-[var(--nimi-text-secondary)] sm:grid-cols-[minmax(0,1fr)_auto]">
        {props.plan.components.map((item) => (
          <div key={`raw:${item.dependencyFamily}/${item.dependencyId}`} className="contents">
            <dt className="break-all">{item.dependencyFamily} / {item.dependencyId}</dt>
            <dd>{item.state}</dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  ) : null;

  if (props.embedded) {
    const lead = rows.find((row) => row.file?.slotId.startsWith('main.')) ?? rows.find((row) => row.file);
    const rest = rows.filter((row) => row !== lead);
    const family = props.recipe ? modelDisplayTitle(props.recipe.title) : '';
    // Until a version is chosen the model family names the card, and the placeholder moves to the line below.
    const title = lead?.file ? (lead.file.placeholder && family ? family : lead.file.name) : '';
    const facts = lead?.file
      ? [lead.file.placeholder && title !== lead.file.name ? lead.file.name : '', lead.file.state ?? ''].filter(Boolean)
      : [];
    return (
      <div className="flex items-start gap-4" data-testid="runtime-setup-task-plan">
        {lead?.file ? <IdentityTile seed={modelFamilySeed(props.recipe?.title || title)} label={family || title} size="lg" /> : null}
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1" data-testid={lead?.testId}>
              {lead?.file ? (
                <>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <h2 className="text-xl font-semibold leading-7">{title}</h2>
                    {lead.file.badge}
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[length:var(--nimi-type-body-size)] text-[var(--nimi-text-muted)]">
                    {facts.map((fact, index) => (
                      <Fragment key={fact}>
                        {index > 0 ? <span aria-hidden="true">·</span> : null}
                        <span className="tabular-nums">{fact}</span>
                      </Fragment>
                    ))}
                    {facts.length > 0 && lead.file.toggle ? <span aria-hidden="true">·</span> : null}
                    {lead.file.toggle}
                  </p>
                  {lead.file.terms}
                </>
              ) : (
                <h2 className="text-base font-semibold leading-7">{t('runtimeConfig.setupTask.inlineTitle', { defaultValue: 'Model setup' })}</h2>
              )}
            </div>
            {props.aside}
          </div>
          {lead?.panel ? (
            <div className="max-w-md rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] p-2 text-sm ring-1 ring-inset ring-[var(--nimi-border-subtle)]">
              {lead.panel}
            </div>
          ) : null}
          {rest.length > 0 ? summaryGrid(rest, '', true) : null}
          {downloadScope}
          {environmentUnavailable}
          {unavailable}
          {technicalDetails}
          {props.footer}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4" data-testid="runtime-setup-task-plan">
      {rows.length > 0 ? summaryGrid(rows, 'rounded-2xl bg-[var(--nimi-surface-card)] px-5 py-1', false) : null}
      {downloadScope}
      {environmentUnavailable}
      {unavailable}
      {technicalDetails}
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
  /** Inside a card: an inset well rather than a second card of the same colour. */
  readonly inset?: boolean;
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
    <div
      className={`space-y-4 rounded-xl p-4 ${props.inset ? 'bg-[var(--nimi-surface-panel)] ring-1 ring-inset ring-[var(--nimi-border-subtle)]' : 'bg-[var(--nimi-surface-card)]'}`}
      data-testid="runtime-setup-task-stages"
    >
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
  readonly embedded?: boolean;
  readonly disabled?: boolean;
  readonly onImportModelFiles?: () => void;
}) {
  const { t } = useTranslation();
  const snapshot = useRuntimeSetupTasks(props.store);
  const task = snapshot.tasks.find((entry) => entry.taskId === props.taskId) ?? null;
  const [recipes, setRecipes] = useState<readonly NimiLoadoutRecipe[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [recipesError, setRecipesError] = useState('');
  const [recipesRetry, setRecipesRetry] = useState(0);
  const [plan, setPlan] = useState<RuntimeSetupPreparationPlan | null>(null);
  const [choices, setChoices] = useState<Readonly<Record<string, string>>>(task?.draft?.reviewChoices ?? task?.draft?.preferredOffers ?? {});
  const [working, setBusy] = useState(false);
  const busy = working || props.disabled === true;
  const planning = useRef(false);
  const [reuseMessage, setReuseMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedBaseline = useRef<RuntimeSetupTask['draft']>(undefined);
  const [candidateInfo, setCandidateInfo] = useState<{
    readonly candidate: NimiMachineLoadout | null;
    readonly recipe: NimiLoadoutRecipe | null;
  } | null>(null);
  const progress = useSetupTaskTransferProgress(task?.refs.installPlanIds ?? []);

  // The route is a draft fact: machine-scope tasks are always local, and a
  // consumer source chooses Local or Cloud explicitly.
  const route = task?.draft?.route ?? (task?.source.kind === 'runtime' ? 'local' : null);
  // When a required file has no downloadable offer, open the advanced editor
  // so the reviewed candidate can bind model files already on this device.
  const draftRecipe = candidateInfo?.recipe ?? recipes.find((entry) => entry.recipeId === task?.draft?.recipeId) ?? null;
  const draftWithoutDirectDownload = draftRecipe ? recipeOfferSummary(draftRecipe).withoutOffer > 0 : false;
  const needsImportedFiles = draftWithoutDirectDownload && (plan?.unavailable.length ?? 0) > 0;
  useEffect(() => {
    if (needsImportedFiles) {
      advancedBaseline.current = props.store.getTask(props.taskId)?.draft;
      setAdvancedOpen(true);
    }
  }, [needsImportedFiles, draftRecipe?.recipeId, props.store, props.taskId]);

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
      setRecipes(nextRecipes);
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
  }, [props.ports, task?.taskId, task?.candidateLoadoutId, task?.capabilityContract, candidateRevisionBaseline]);

  const onChoiceChange = useCallback((slotId: string, offerRef: string) => {
    setChoices((previous) => ({ ...previous, [slotId]: offerRef }));
    props.store.updateTask(props.taskId, current => ({
      draft: { ...current.draft, reviewChoices: { ...current.draft?.reviewChoices, [slotId]: offerRef } },
    }));
  }, [props.store, props.taskId]);

  const onSelectRoute = useCallback((nextRoute: 'local' | 'cloud') => {
    if (!task || busy) return;
    props.store.updateTask(task.taskId, (current) => ({
      draft: { ...(current.draft ?? {}), route: nextRoute },
    }));
  }, [props.store, task, busy]);

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
      .catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  }, [props.ports, props.store, task]);

  const resolvePlan = useCallback(async (acceptExternalCandidateState?: boolean): Promise<RuntimeSetupPreparationPlan | null> => {
    setActionError('');
    const result = await resolveRuntimeSetupPreparation(props.store, props.taskId, props.ports, {
      acceptExternalCandidateState,
    });
    if (result.status === 'ok') {
      setPlan(result.value);
      setChoices(previous => Object.fromEntries(result.value.awaitingChoice.flatMap(choice => {
        const chosen = choice.options.find(option => option.offerRef === previous[choice.slotId])
          ?? choice.options.find(option => option.recommended);
        return chosen ? [[choice.slotId, chosen.offerRef]] : [];
      })));
      return result.value;
    }
    if (result.status === 'blocked') setActionError(result.failure.message);
    return null;
  }, [props.ports, props.store, props.taskId]);

  // The reviewed plan lives only in this view's state, so reopening a
  // review-stage task within the same session would otherwise strand it with
  // disabled confirm actions. Recompute the plan from current Runtime state.
  const taskStatus = task?.status;
  useEffect(() => {
    if (taskStatus !== 'review' || plan || planning.current) return;
    setBusy(true);
    void resolvePlan()
      .catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  }, [taskStatus, plan, resolvePlan]);

  const onReviewPreparation = useCallback((recipeId?: string, reviewImportedFiles = false) => {
    const current = props.store.getTask(props.taskId);
    if (!current || planning.current || props.disabled) return;
    const recipe = recipes.find((entry) => entry.recipeId === recipeId);
    if (!current.candidateLoadoutId && !reviewImportedFiles && recipe && recipeOfferSummary(recipe).withoutOffer > 0) {
      if (current.draft?.recipeId !== recipeId) {
        props.store.updateTask(current.taskId, (entry) => ({ draft: { ...entry.draft, route: 'local', recipeId } }));
      }
      return;
    }
    planning.current = true;
    setBusy(true);
    setActionError('');
    setAdvancedOpen(false);
    void (async () => {
      if (!current.candidateLoadoutId) {
        if (!recipeId) return;
        const draft = current.draft;
        const created = await createRuntimeSetupCandidate(props.store, props.taskId, props.ports, {
          recipeId,
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
    })().catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)))
      .finally(() => { planning.current = false; setBusy(false); });
  }, [props.ports, props.store, props.taskId, props.disabled, recipes, resolvePlan]);

  // Opening an explicitly started task may prepare its unselected draft for
  // review. It never downloads, selects, or saves an app route. A sole
  // supported recipe needs no radio/Next screen; multiple choices stay explicit.
  useEffect(() => {
    if (task?.status !== 'draft' || route !== 'local' || busy || actionError) return;
    if (task.candidateLoadoutId) {
      onReviewPreparation();
      return;
    }
    if (recipesLoading || recipesError || recipes.length === 0) return;
    const supported = recipes.filter(recipe => recipe.applicability === 'supported');
    const recipeId = task.draft?.recipeId ?? (supported.length === 1 ? supported[0]!.recipeId : undefined);
    if (recipeId) onReviewPreparation(recipeId);
  }, [task?.status, task?.candidateLoadoutId, task?.draft?.recipeId, route, busy, actionError, recipes, recipesLoading, recipesError, onReviewPreparation]);

  const onChooseAnotherModel = () => {
    if (!task || busy || task.failure?.machineSelected) return;
    props.store.updateTask(task.taskId, () => ({
      status: 'draft', nextAction: 'choose-model', failure: undefined, authorization: undefined,
      candidateLoadoutId: undefined, candidateRevisionBaseline: undefined, selectionRevisionBaseline: undefined,
      refs: { installPlanIds: [], transferIds: [], dependencyJobIds: [] },
      draft: { route: 'local' },
    }));
    setCandidateInfo(null); setChoices({}); setPlan(null); setActionError(''); setAdvancedOpen(false);
  };

  const onConfirm = useCallback((mode: 'prepare-and-use' | 'prepare-only') => {
    if (!plan || busy || advancedOpen) return;
    setBusy(true);
    setActionError('');
    void runRuntimeSetupPreparation(props.store, props.taskId, props.ports, {
      mode,
      reviewedPlan: plan,
      choices,
    }).then((result) => {
      if (result.status === 'blocked') setActionError(result.failure.message);
    }).catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  }, [advancedOpen, busy, choices, plan, props.ports, props.store, props.taskId]);

  const onReverify = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setPlan(null);
    setActionError('');
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
      if (task?.status === 'failed' || task?.status === 'needs-attention') {
        reopenRuntimeSetupTask(props.store, props.taskId);
      }
      if (!task?.candidateLoadoutId) return;
      await resolvePlan(true);
    })().catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  }, [busy, props.store, props.taskId, props.ports, resolvePlan, task]);

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
            disabled={busy}
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
            disabled={busy}
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
            <Button tone="ghost" size="sm" disabled={busy} onClick={() => onSelectRoute('local')} data-testid="runtime-setup-route-back-local">
              {t('runtimeConfig.setupTask.routeSwitchLocal', { defaultValue: 'Switch to Local setup' })}
            </Button>
          ) : null}
          <RuntimeSetupTaskCloudPanel task={currentTask} store={props.store} ports={props.ports} onBusyChange={setBusy} />
        </div>
      );
    }
    if (currentTask.candidateLoadoutId || working) {
      return <div className="space-y-3" role="status">
        <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.setupTask.checkingPreparation', { defaultValue: 'Checking model files and required components…' })}</p>
        <LoadingSkeleton className="h-24 w-full" />
      </div>;
    }
    return (
      <div className="space-y-3" data-testid="runtime-setup-task-recipes">
        <p className="text-sm text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.setupTask.chooseModel', { defaultValue: 'Choose a model for {{capability}}.', capability: capabilityLabel })}
        </p>
        {currentTask.source.kind !== 'runtime' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button tone="ghost" size="sm" disabled={busy} onClick={() => onSelectRoute('cloud')} data-testid="runtime-setup-route-switch-cloud">
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
            <div>{t('runtimeConfig.setupTask.recipesLoadFailed', { defaultValue: 'Models could not be loaded. Try again.' })}</div>
            <Button tone="secondary" size="sm" disabled={recipesLoading} onClick={() => setRecipesRetry(value => value + 1)}>{t('Common.retry', { defaultValue: 'Retry' })}</Button>
            <details className="mt-1 text-xs"><summary>{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>{recipesError}</details>
          </InlineAlert>
        ) : null}
        {recipesLoading ? <LoadingSkeleton className="h-24 w-full" /> : null}
        {!recipesLoading && !recipesError && recipes.length === 0 ? (
          <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.setupTask.noRecipes', { defaultValue: 'No models are available for this capability on this device yet.' })}</p>
        ) : null}
        <div className="space-y-2">
          {recipes.map(recipe => (
            <div key={recipe.recipeId} className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--nimi-border-subtle)] p-3" data-testid={`runtime-setup-task-recipe:${recipe.recipeId}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{modelDisplayTitle(recipe.title)}</p>
                <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
                  {t(`runtimeConfig.setupTask.compatibility.${recipe.applicability}`, { defaultValue: recipe.applicability })}
                </p>
              </div>
              <Button tone="secondary" size="sm" disabled={busy || recipe.applicability === 'unsupported'} onClick={() => onReviewPreparation(recipe.recipeId)}>
                {t('runtimeConfig.setupTask.reviewModel', { defaultValue: 'View version and download' })}
              </Button>
            </div>
          ))}
        </div>
        {draftWithoutDirectDownload && draftRecipe ? (
          <div className="space-y-3" data-testid="runtime-setup-imported-files">
            <InlineAlert tone="info" data-testid="runtime-setup-no-direct-download">
              {t('runtimeConfig.setupTask.noDirectDownloadHint', { defaultValue: 'This model has no direct download. Choose model files already on this device under Advanced settings, or import model files first.' })}
            </InlineAlert>
            <div className="space-y-3 rounded-xl border border-[var(--nimi-border-subtle)] p-4">
              <h3 className="text-sm font-semibold">{t('runtimeConfig.setupTask.advancedSettings', { defaultValue: 'Advanced settings' })}</h3>
              <SetupTaskAdvancedSection task={currentTask} store={props.store} ports={props.ports} recipe={draftRecipe} candidate={null} disabled={busy} onCandidateUpdated={() => {}} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button tone="primary" disabled={busy || recipesLoading || Boolean(recipesError) || draftRecipe.applicability === 'unsupported'} onClick={() => onReviewPreparation(draftRecipe.recipeId, true)} data-testid="runtime-setup-task-review">
                {t('runtimeConfig.setupTask.reviewModel', { defaultValue: 'View version and download' })}
              </Button>
              {props.onImportModelFiles ? <Button tone="secondary" disabled={busy} onClick={props.onImportModelFiles}>
                {t('runtimeConfig.setupTask.importFiles', { defaultValue: 'Import model files' })}
              </Button> : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  // The header names the setup; the model under setup is a secondary line
  // once its candidate is known, except in review where the card shows it.
  const capabilityLabel = task ? displayRuntimeConfigCapabilityLabel(task.capabilityContract, t) : '';
  const HeroIcon = capabilityIcon(task?.capabilityContract ?? '');
  const candidateName = candidateInfo?.candidate?.displayName ?? candidateInfo?.recipe?.title ?? '';
  const modelTitle = candidateName ? modelDisplayTitle(candidateName) : '';

  // Back already discards an unconfirmed setup; only a reopened one that ran before needs an explicit cancel.
  const stopEarly = task && (task.status === 'draft' || task.status === 'review') && !runtimeSetupTaskUnconfirmed(task) ? (
    <Button tone="ghost" size="sm" onClick={() => stopRuntimeSetupTask(props.store, props.taskId)} data-testid="runtime-setup-task-stop-early">
      {t('runtimeConfig.setupTask.cancelSetup', { defaultValue: 'Cancel this setup' })}
    </Button>
  ) : null;
  // Inside a card the setup closes like a panel, from the top-right corner.
  const closeLabel = t('runtimeConfig.setupTask.collapse', { defaultValue: 'Close setup' });
  const embeddedControls = (
    <div className="-mr-2 flex shrink-0 items-center gap-1">
      {stopEarly}
      <IconButton
        size="sm"
        tone="ghost"
        aria-label={closeLabel}
        title={closeLabel}
        icon={<X size={16} aria-hidden="true" />}
        onClick={onBack}
        data-testid="runtime-setup-task-close"
      />
    </div>
  );
  const notices = (
    <>
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
      {actionError ? <InlineAlert tone="warning" data-testid="runtime-setup-action-error">
        <p>{actionError}</p>
        <Button tone="secondary" size="sm" disabled={busy} onClick={onReverify}>{t('Common.retry', { defaultValue: 'Retry' })}</Button>
      </InlineAlert> : null}
    </>
  );
  // Embedded, the reviewed plan leads with the model itself and carries the close control and notices.
  const planLeads = props.embedded === true && task?.status === 'review' && plan !== null;

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
        const blockedConfirm = busy || advancedOpen || !plan || plan.unavailable.length > 0 || Boolean(plan.environmentUnavailable)
          || plan.awaitingChoice.some((choice) => !choices[choice.slotId]);
        const downloadBytes = plan ? setupPlanDownloadBytes(plan, choices) : null;
        const confirmLabel = direct
          ? t('runtimeConfig.product.useTheseSettings')
          : downloadBytes !== null && downloadBytes > 0
            ? t('runtimeConfig.setupTask.downloadAndUse', { defaultValue: 'Download and use · {{size}}', size: formatBytes(downloadBytes) })
            : t('runtimeConfig.setupTask.prepareAndUse');
        // "Download only" is exact only while downloading is all that preparing does.
        const prepareOnlyLabel = plan && plan.components.length === 0 && setupPlanDownloads(plan, choices)
          ? t('runtimeConfig.setupTask.downloadOnly', { defaultValue: 'Download only, don’t switch' })
          : t('runtimeConfig.setupTask.prepareOnly', { defaultValue: 'Prepare only' });
        // The consequence sits right above the two confirmations; model and settings changes stay at the far end.
        const confirmation = (
          <div className="space-y-4">
            {needsImportedFiles ? (
              <InlineAlert tone="info" data-testid="runtime-setup-no-direct-download">
                {t('runtimeConfig.setupTask.noDirectDownloadHint', { defaultValue: 'This model has no direct download. Choose model files already on this device under Advanced settings, or import model files first.' })}
              </InlineAlert>
            ) : null}
            <div className="space-y-2.5">
              <p className="text-sm text-[var(--nimi-text-secondary)]" data-testid="runtime-setup-review-impact">
                {t('runtimeConfig.setupTask.reviewImpact', { defaultValue: 'Enabling this model changes the device default shared by apps using local AI.' })}
                {task.source.kind !== 'runtime' ? ` ${t('runtimeConfig.setupTask.scope.usageSaveOwner', { defaultValue: '{{owner}} will use the model selected on this device.', owner: sourceOwnerLabel(task, t) })}` : ''}
              </p>
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
                    disabled={blockedConfirm}
                    onClick={() => onConfirm('prepare-only')}
                    data-testid="runtime-setup-task-prepare-only"
                  >
                    {prepareOnlyLabel}
                  </Button>
                ) : null}
                {plan?.unavailable.length && props.onImportModelFiles ? <Button tone="secondary" disabled={busy} onClick={props.onImportModelFiles}>
                  {t('runtimeConfig.setupTask.importFiles', { defaultValue: 'Import model files' })}
                </Button> : null}
                <span className="ml-auto flex flex-wrap items-center gap-1">
                  {recipes.filter(recipe => recipe.applicability !== 'unsupported').length > 1 ? <Button tone="ghost" size="sm" disabled={busy || advancedOpen} onClick={onChooseAnotherModel} data-testid="runtime-setup-change-model">
                    {t('runtimeConfig.product.changeModel')}
                  </Button> : null}
                  <Button tone="ghost" size="sm" disabled={busy} aria-expanded={advancedOpen} aria-controls={`runtime-setup-advanced-${task.taskId}`} onClick={() => {
                    if (advancedOpen) props.store.updateTask(task.taskId, () => ({ draft: advancedBaseline.current }));
                    else advancedBaseline.current = task.draft;
                    setAdvancedOpen(value => !value);
                  }} data-testid="runtime-setup-task-advanced">
                    {advancedOpen
                      ? t('runtimeConfig.product.customization.discard', { defaultValue: 'Discard changes' })
                      : t('runtimeConfig.setupTask.advancedSettings', { defaultValue: 'Advanced settings' })}
                  </Button>
                </span>
              </div>
            </div>
            {advancedOpen ? (
              <div id={`runtime-setup-advanced-${task.taskId}`} className="rounded-xl border border-[var(--nimi-border-subtle)] p-4">
                {candidateInfo?.recipe && candidateInfo.candidate ? (
                  <SetupTaskAdvancedSection task={task} store={props.store} ports={props.ports} recipe={candidateInfo.recipe} candidate={candidateInfo.candidate} reviewChoices={choices} disabled={busy} onBusyChange={setBusy} onCandidateUpdated={() => { setAdvancedOpen(false); setPlan(null); }} />
                ) : <LoadingSkeleton className="h-24 w-full" />}
              </div>
            ) : null}
          </div>
        );
        if (props.embedded && plan) {
          return (
            <SetupTaskPlanReview
              embedded
              plan={plan}
              choices={choices}
              onChoiceChange={onChoiceChange}
              recipe={candidateInfo?.recipe ?? null}
              disabled={busy || advancedOpen}
              aside={embeddedControls}
              footer={<>{notices}{confirmation}</>}
            />
          );
        }
        return (
          <div className="space-y-5">
            {plan ? (
              <SetupTaskPlanReview plan={plan} choices={choices} onChoiceChange={onChoiceChange} recipe={candidateInfo?.recipe ?? null} disabled={busy || advancedOpen} />
            ) : (
              <LoadingSkeleton className="h-32 w-full" />
            )}
            {confirmation}
          </div>
        );
      }
      case 'preparing':
      case 'committing': {
        return (
          <div className="space-y-3" data-testid="runtime-setup-task-progress">
            <PreparationProgress task={task} progress={progress} inset={props.embedded} />
            <Disclosure summary={t('runtimeConfig.setupTask.receipt.scopeDetails')}>
              <SetupTaskScopeList task={task} />
            </Disclosure>
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
              {task.failure ? <RuntimeSetupFailureMessage failure={task.failure} /> : null}
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
      case 'failed': {
        // Until the model records are converted Runtime refuses every local
        // model operation, so a retry or another local model fails the same way.
        if (task.failure?.reasonCode === 'AI_LOCAL_MODEL_STATE_OFFLINE_CONVERSION_REQUIRED' && !task.failure.machineSelected) {
          return (
            <div className="space-y-3" data-testid="runtime-setup-task-failed">
              <InlineAlert tone="danger">
                <div className="font-semibold text-[var(--nimi-text-primary)]">
                  {t('runtimeConfig.setupTask.localModelsUnavailableTitle', { defaultValue: 'Local models unavailable' })}
                </div>
                <RuntimeSetupFailureMessage failure={task.failure} />
              </InlineAlert>
              {!props.embedded ? (
                <Button tone="secondary" onClick={props.onClose}>
                  {t('runtimeConfig.setupTask.back', { defaultValue: 'Back' })}
                </Button>
              ) : null}
            </div>
          );
        }
        const missingFiles = task.failure?.reasonCode === 'AI_LOADOUT_MODEL_ASSET_NOT_FOUND' && !task.failure.machineSelected;
        return (
          <div className="space-y-3" data-testid="runtime-setup-task-failed">
            <InlineAlert tone="danger">
              <div className="font-semibold text-[var(--nimi-text-primary)]">
                {task.failure?.machineSelected
                  ? t('runtimeConfig.setupTask.partialTitle', { defaultValue: "Model changed; app settings need attention" })
                  : t('runtimeConfig.setupTask.failedTitle', { defaultValue: 'Setup failed' })}
              </div>
              {task.failure ? <RuntimeSetupFailureMessage failure={task.failure} /> : null}
            </InlineAlert>
            <div className="flex flex-wrap gap-2">
              <Button tone="primary" disabled={busy} onClick={missingFiles ? onChooseAnotherModel : onReverify} data-testid="runtime-setup-task-retry">
                {task.failure?.machineSelected
                  ? t('runtimeConfig.setupTask.continueOwnerSave', { defaultValue: "Check and save app settings" })
                  : missingFiles
                    ? t('runtimeConfig.setupTask.chooseRepairModel', { defaultValue: 'Choose a model to repair setup' })
                    : t('runtimeConfig.setupTask.retry', { defaultValue: 'Review and retry' })}
              </Button>
              {missingFiles && props.onImportModelFiles ? (
                <Button tone="secondary" disabled={busy} onClick={props.onImportModelFiles} data-testid="runtime-setup-import-files">
                  {t('runtimeConfig.setupTask.importFiles', { defaultValue: 'Import model files' })}
                </Button>
              ) : null}
              {missingFiles ? (
                <Button tone="ghost" disabled={busy} onClick={onReverify}>
                  {t('runtimeConfig.setupTask.checkAgain', { defaultValue: 'Check again' })}
                </Button>
              ) : !task.failure?.machineSelected ? (
                <Button tone="secondary" disabled={busy} onClick={onChooseAnotherModel}>
                  {t('runtimeConfig.setupTask.chooseAnotherModel', { defaultValue: 'Choose another model' })}
                </Button>
              ) : null}
              {!props.embedded ? <Button tone="secondary" onClick={props.onClose}>
                {t('runtimeConfig.setupTask.back', { defaultValue: 'Back' })}
              </Button> : null}
            </div>
            {missingFiles ? <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.setupTask.repairChoiceHint', { defaultValue: 'Review the model version and download size before replacing the current configuration.' })}</p> : null}
          </div>
        );
      }
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
    <section className={`min-w-0 ${props.embedded ? 'space-y-5' : 'space-y-6'}`} data-testid="runtime-setup-task-view" aria-label={t('runtimeConfig.setupTask.title', { defaultValue: 'Setup task' })}>
      {/* First, so the spacing utility never leaves a trailing margin under the visible content. */}
      <span className="sr-only" role="status">{task ? t(`runtimeConfig.setupTask.status.${task.status}`, { defaultValue: task.status }) : ''}</span>
      {planLeads ? null : props.embedded ? (
        <div className="flex items-start gap-3">
          <h2 className="min-w-0 flex-1 text-base font-semibold leading-7">{t('runtimeConfig.setupTask.inlineTitle', { defaultValue: 'Model setup' })}</h2>
          {embeddedControls}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button tone="ghost" size="sm" onClick={onBack} data-testid="runtime-setup-task-close">
            <ArrowLeft size={15} />
            {task ? t('runtimeConfig.setupTask.backToCapability', { defaultValue: 'Back to {{capability}}', capability: capabilityLabel }) : t('runtimeConfig.setupTask.close', { defaultValue: 'Close' })}
          </Button>
          {stopEarly}
        </div>
      )}
      {task && !props.embedded ? (
        <header className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]">
            <HeroIcon size={20} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight" data-testid="runtime-setup-hero-title">
              {t('runtimeConfig.setupTask.heroTitle', { defaultValue: '{{capability}} setup', capability: capabilityLabel })}
            </h1>
            {task.source.kind !== 'runtime' ? (
              <p className="mt-0.5 text-sm text-[var(--nimi-text-secondary)]" data-testid="runtime-setup-source-owner">
                {t('runtimeConfig.setupTask.forSource', { defaultValue: 'Settings for {{owner}}', owner: sourceOwnerLabel(task, t) })}
              </p>
            ) : null}
            {modelTitle && task.status !== 'review' ? (
              <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]" data-testid="runtime-setup-hero-model">
                {t('runtimeConfig.setupTask.heroModel', { defaultValue: 'Model for this setup: {{model}}', model: modelTitle })}
              </p>
            ) : null}
          </div>
        </header>
      ) : null}
      {planLeads ? null : notices}
      {renderContent()}
    </section>
  );
}

/** Whether confirming the plan downloads any model file. */
function setupPlanDownloads(plan: RuntimeSetupPreparationPlan, choices: Readonly<Record<string, string>>): boolean {
  return plan.acquire.some((item) => !item.offer.installedModelAssetId)
    || plan.awaitingChoice.some((item) => {
      const chosen = item.options.find((option) => option.offerRef === choices[item.slotId]);
      return !!chosen && !chosen.installedModelAssetId;
    });
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
