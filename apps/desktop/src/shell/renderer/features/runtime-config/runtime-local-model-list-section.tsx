import { Button, InlineAlert, StatusBadge, type StatusTone } from '@nimiplatform/kit/ui';
import type { NimiRuntimeLocalEnvironmentPlan } from '@nimiplatform/sdk/runtime';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Database, File, FolderOpen } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../components/download-format.js';
import { ModelFamilyLogoTile } from '../../components/provider-logo-tile.js';
import { formatRelativeLocaleTime } from '../../i18n/index.js';
import { CAPABILITY_INVENTORY_KEY, type CapabilityInventory, type CapabilityPreparationState } from './runtime-capability-inventory.js';
import { modelFamilySeed } from './runtime-capability-presentation.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import {
  buildLocalModelList,
  configurableCapabilities,
  configurationShortId,
  isCompanionVariant,
  type LocalModelConfiguration,
  type LocalModelVariant,
} from './runtime-local-model-list.js';
import {
  loadoutPreparationStatus,
  loadoutEnvironmentSummary,
  LOADOUT_ENVIRONMENT_KEY,
  type LoadoutEnvironmentCheck,
  type LoadoutPreparationStatus,
} from './runtime-local-model-status.js';
import type { RuntimeSetupTask } from './runtime-setup-task-store.js';
import type { useRuntimeModelLibrary } from './use-runtime-model-library.js';
import { loadoutValidationMessages } from './runtime-loadout-validation.js';

// @nimi-authority: rule.nimi.desktop.ai-consumption.local-model-overview
// @nimi-authority: rule.nimi.desktop.ai-consumption.model-preparation-status-ownership
// @nimi-authority: rule.nimi.desktop.ai-consumption.model-verification-claims
//
// The on-device model list on the AI Capabilities home. Each content variant
// is one card that keeps its own identity; variants of one catalog model stay
// grouped under that model, and preparation status is shown per saved
// configuration. Rendering, expanding and refreshing this list only
// read: the environment check for a non-default configuration is a read-only
// plan resolution that runs when the card is expanded, and entering a setup
// is always a navigation the person starts.

const BADGE_TONE: Record<CapabilityPreparationState, StatusTone> = {
  unset: 'neutral',
  preparing: 'info',
  ready: 'success',
  attention: 'warning',
  unknown: 'neutral',
};

type LibraryQuery = ReturnType<typeof useRuntimeModelLibrary>;

export function RuntimeLocalModelListSection(props: {
  readonly inventory: CapabilityInventory | undefined;
  readonly inventoryPending: boolean;
  readonly inventoryError: boolean;
  readonly library: Pick<LibraryQuery, 'data' | 'isPending' | 'isError' | 'refetch'>;
  readonly onRetry: () => void;
  readonly tasks: readonly RuntimeSetupTask[];
  readonly onOpenCapability: (capability: string) => void;
  readonly onOpenConfiguration: (configuration: LocalModelConfiguration) => void;
  readonly onOpenModelFiles?: () => void;
  readonly onOpenTask?: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const entries = useMemo(
    () =>
      props.library.data && props.inventory
        ? buildLocalModelList({
            assets: props.library.data.assets,
            catalog: props.library.data.catalog,
            recipes: props.inventory.recipes,
            loadouts: props.inventory.aggregate.loadouts,
            selections: props.inventory.aggregate.selections,
          })
        : [],
    [props.library.data, props.inventory],
  );
  const pending = props.library.isPending || props.inventoryPending;
  const failed = props.library.isError || props.inventoryError;
  return (
    <section className="space-y-3" data-testid="local-model-list" aria-labelledby="local-model-list-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="local-model-list-title" className="text-base font-semibold">
            {t('runtimeConfig.localModels.title')}
            {!pending && !failed ? (
              <span className="ml-2 rounded-full bg-[var(--nimi-status-neutral-soft-bg)] px-2 py-0.5 text-xs font-medium text-[var(--nimi-status-neutral-soft-text)]">
                {entries.reduce((total, entry) => total + entry.variants.length, 0)}
              </span>
            ) : null}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button tone="ghost" size="sm" data-testid="local-model-refresh" onClick={() => {
            props.onRetry();
            void queryClient.invalidateQueries({ queryKey: LOADOUT_ENVIRONMENT_KEY });
          }}>{t('runtimeConfig.localModels.refreshStatus')}</Button>
          {props.onOpenModelFiles ? (
            <Button tone="ghost" size="sm" onClick={props.onOpenModelFiles} data-testid="local-model-list-manage-files">
              <FolderOpen size={14} />
              {t('runtimeConfig.capabilities.manageFiles')}
            </Button>
          ) : null}
        </div>
      </div>
      {failed ? (
        <InlineAlert tone="warning">
          {t('runtimeConfig.localModels.readFailed')}
          <Button
            tone="ghost"
            size="sm"
            onClick={props.onRetry}
          >
            {t('Common.retry')}
          </Button>
        </InlineAlert>
      ) : pending ? (
        <p className="text-sm text-[var(--nimi-text-secondary)]">{t('Common.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-[var(--nimi-text-secondary)]" data-testid="local-model-list-empty">
          {t('runtimeConfig.localModels.empty')}
        </p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.modelKey} className="space-y-3" data-testid={`local-model:${entry.modelKey}`}>
              {entry.variants.map((variant) => (
                <VariantCard
                  key={variant.contentId}
                  variant={variant}
                  brandName={entry.brandName}
                  familyTitle={entry.title}
                  inventory={props.inventory!}
                  tasks={props.tasks}
                  onOpenCapability={props.onOpenCapability}
                  onOpenConfiguration={props.onOpenConfiguration}
                  onOpenModelFiles={props.onOpenModelFiles}
                  onOpenTask={props.onOpenTask}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function VariantCard(props: {
  readonly variant: LocalModelVariant;
  /** Name the brand tile resolves from: the model itself, or the model a companion-only variant serves. */
  readonly brandName: string;
  /** Model family title; used for the fallback monogram. */
  readonly familyTitle: string;
  readonly inventory: CapabilityInventory;
  readonly tasks: readonly RuntimeSetupTask[];
  readonly onOpenCapability: (capability: string) => void;
  readonly onOpenConfiguration: (configuration: LocalModelConfiguration) => void;
  readonly onOpenModelFiles?: () => void;
  readonly onOpenTask?: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const { variant } = props;
  const [expanded, setExpanded] = useState(false);
  const label = (id: string) => displayRuntimeConfigCapabilityLabel(id, t);
  const configurable = configurableCapabilities(variant);
  // Per capability: the default configuration when there is one, otherwise the count of saved ones.
  const capabilitySummaries = [...new Set(variant.configurations.map((item) => item.capability))].map((capability) => {
    const items = variant.configurations.filter((item) => item.capability === capability);
    return { capability, defaultItem: items.find((item) => item.isDefault), count: items.length };
  });
  const onlyConfiguration = variant.configurations.length === 1 ? variant.configurations[0] : undefined;
  const hasConfigurations = variant.configurations.length > 0;
  const companionOnly = isCompanionVariant(variant);
  const addedAt = Date.parse(variant.addedAt);
  return (
    <article
      className="rounded-2xl bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)] ring-1 ring-[var(--nimi-border-subtle)]"
      data-testid={`local-model-variant:${variant.contentId}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4">
        <ModelFamilyLogoTile name={props.brandName} seed={modelFamilySeed(props.brandName)} label={props.familyTitle} size="lg" />
        <div className="min-w-0 flex-1 basis-60 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{variant.title}</span>
            {variant.quantLabel ? <Chip>{variant.quantLabel}</Chip> : null}
            {variant.format ? <Chip>{variant.format}</Chip> : null}
            {companionOnly ? <StatusBadge tone="neutral">{t('runtimeConfig.localModels.companionResource')}</StatusBadge> : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--nimi-text-secondary)]">
            {capabilitySummaries.map((summary) =>
              summary.defaultItem ? (
                <ConfigurationBadge
                  key={summary.capability}
                  configuration={summary.defaultItem}
                  inventory={props.inventory}
                  tasks={props.tasks}
                  expanded={false}
                  prefix={summary.defaultItem.role === 'companion'
                    ? t('runtimeConfig.localModels.companionFor', { capability: label(summary.capability) })
                    : label(summary.capability)}
                />
              ) : (
                <span key={summary.capability} className="flex items-center gap-1.5">
                  <span>{variant.configurations.filter((item) => item.capability === summary.capability).every((item) => item.role === 'companion')
                    ? t('runtimeConfig.localModels.companionFor', { capability: label(summary.capability) })
                    : label(summary.capability)}</span>
                  <StatusBadge tone="neutral" className="px-2 py-0">
                    {t('runtimeConfig.localModels.savedCount', { count: summary.count })}
                  </StatusBadge>
                </span>
              ),
            )}
            {variant.configurations.length === 0 && !variant.useNotIdentified ? (
              <StatusBadge tone="neutral" className="px-2 py-0" data-testid="local-model-not-configured">
                {t('runtimeConfig.localModels.notConfigured')}
              </StatusBadge>
            ) : null}
            {variant.useNotIdentified ? (
              <StatusBadge tone="neutral" className="px-2 py-0" data-testid="local-model-use-not-identified">
                {t('runtimeConfig.localModels.useNotIdentified')}
              </StatusBadge>
            ) : null}
            {variant.configurableFor
              .filter((item) => !variant.configurations.some((config) => config.capability === item.capability && config.role === item.role))
              .map((item) => (
                <span key={`${item.recipeId}:${item.capability}:${item.role}`}>
                  {item.role === 'companion'
                    ? t('runtimeConfig.localModels.companionFor', { capability: label(item.capability) })
                    : item.applicability === 'supported'
                      ? t('runtimeConfig.localModels.configurableFor', { capability: label(item.capability) })
                      : item.applicability === 'unknown'
                        ? t('runtimeConfig.localModels.configurableUnknown', { capability: label(item.capability) })
                        : t('runtimeConfig.localModels.configurableUnsupported', { capability: label(item.capability) })}
                </span>
              ))}
          </div>
          {companionOnly ? (
            <p className="text-xs text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.localModels.usedBy', {
                configurations: [...new Set(variant.configurations.map((item) => item.displayName || label(item.capability)))].join(' · '),
              })}
            </p>
          ) : null}
        </div>
        <div className="flex w-44 shrink-0 flex-col items-start gap-1 text-xs text-[var(--nimi-text-secondary)]">
          <span className="flex items-center gap-4 whitespace-nowrap">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Database size={13} className="shrink-0 text-[var(--nimi-text-muted)]" aria-hidden="true" />
              {formatBytes(variant.sizeBytes)}
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <File size={13} className="shrink-0 text-[var(--nimi-text-muted)]" aria-hidden="true" />
              {t('runtimeConfig.localModels.files', { count: variant.fileCount })}
            </span>
          </span>
          {Number.isFinite(addedAt) ? (
            <span className="text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.localModels.addedAt', { time: formatRelativeLocaleTime(variant.addedAt) })}
            </span>
          ) : null}
        </div>
        <div className="flex w-64 shrink-0 flex-wrap items-center gap-1 pl-6">
          {hasConfigurations ? (
            <Button
              tone="secondary"
              size="sm"
              onClick={() => onlyConfiguration ? props.onOpenConfiguration(onlyConfiguration) : setExpanded(true)}
              aria-expanded={onlyConfiguration ? undefined : expanded}
              data-testid={`local-model-view:${variant.contentId}`}
            >
              {t(onlyConfiguration
                ? companionOnly ? 'runtimeConfig.localModels.viewOwningConfiguration' : 'runtimeConfig.localModels.viewConfiguration'
                : companionOnly ? 'runtimeConfig.localModels.chooseOwningConfiguration' : 'runtimeConfig.localModels.chooseConfiguration', { count: variant.configurations.length })}
            </Button>
          ) : null}
          {configurable
            .filter((capability) => !variant.configurations.some((item) => item.capability === capability))
            .map((capability) => (
              <Button
                key={capability}
                tone={hasConfigurations ? 'ghost' : 'secondary'}
                size="sm"
                onClick={() => props.onOpenCapability(capability)}
                data-testid={`local-model-configure:${variant.contentId}:${capability}`}
              >
                {t('runtimeConfig.localModels.configure', { capability: label(capability) })}
              </Button>
            ))}
          {variant.useNotIdentified && props.onOpenModelFiles ? (
            <Button tone="ghost" size="sm" onClick={props.onOpenModelFiles}>
              {t('runtimeConfig.localModels.openLibrary')}
            </Button>
          ) : null}
          <Button
            tone="ghost"
            size="sm"
            className="ml-auto"
            aria-expanded={expanded}
            aria-label={t(expanded ? 'runtimeConfig.localModelCenter.hideDetails' : 'runtimeConfig.localModelCenter.details')}
            title={t(expanded ? 'runtimeConfig.localModelCenter.hideDetails' : 'runtimeConfig.localModelCenter.details')}
            onClick={() => setExpanded((value) => !value)}
            data-testid={`local-model-variant-toggle:${variant.contentId}`}
          >
            <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </Button>
        </div>
      </div>
      {expanded ? (
        <div className="px-4 pb-4">
          <div className="space-y-3 rounded-xl bg-[var(--nimi-surface-subtle)] px-4 py-3 text-xs" data-testid={`local-model-variant-details:${variant.contentId}`}>
            <p className="flex flex-wrap items-center gap-x-2 text-[var(--nimi-text-secondary)]">
              <span className="inline-flex items-center gap-1 text-[var(--nimi-status-success)]">
                <Check size={12} />
                {t('runtimeConfig.localModelCenter.contentVerified')}
              </span>
              <span>·</span>
              <span>{t('runtimeConfig.localModels.files', { count: variant.fileCount })}</span>
              <span>·</span>
              <span>{formatBytes(variant.sizeBytes)}</span>
            </p>
            {variant.useNotIdentified ? (
              <p className="text-[var(--nimi-text-secondary)]">{t('runtimeConfig.localModels.useNotIdentifiedHelp')}</p>
            ) : null}
            {variant.configurations.length > 0 ? (
              <div className="space-y-2">
                <p className="font-semibold text-[var(--nimi-text-secondary)]">{t('runtimeConfig.localModels.configurations')}</p>
                {variant.configurations.map((configuration) => (
                  <ConfigurationDetail
                    key={configuration.loadoutId}
                    configuration={configuration}
                    shortId={configurationShortId(configuration, variant.configurations)}
                    sameName={variant.configurations.filter((item) => item.displayName === configuration.displayName).length > 1}
                    inventory={props.inventory}
                    tasks={props.tasks}
                    onOpenConfiguration={props.onOpenConfiguration}
                    onOpenTask={props.onOpenTask}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function Chip(props: { readonly children: string }) {
  return (
    <span className="shrink-0 rounded-md bg-[var(--nimi-status-neutral-soft-bg)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] font-semibold tracking-wide text-[var(--nimi-status-neutral-soft-text)]">
      {props.children}
    </span>
  );
}

/**
 * The environment check for one configuration. A capability's default
 * configuration reuses the plan the capability inventory already resolved;
 * any other configuration resolves its own candidate plan only while its
 * row is expanded. Both are read-only resolutions.
 */
function useConfigurationStatus(input: {
  readonly configuration: LocalModelConfiguration;
  readonly inventory: CapabilityInventory;
  readonly tasks: readonly RuntimeSetupTask[];
  readonly expanded: boolean;
}): { status: LoadoutPreparationStatus; check: LoadoutEnvironmentCheck; retry?: () => void } {
  const environment = useRuntimeConfigLocalEnvironmentClient();
  const queryClient = useQueryClient();
  const loadout = input.inventory.aggregate.loadouts.find((item) => item.loadoutId === input.configuration.loadoutId);
  const capability = input.configuration.capability;
  const candidate = useQuery({
    queryKey: [...LOADOUT_ENVIRONMENT_KEY, input.configuration.loadoutId, loadout?.revision ?? ''],
    queryFn: () => environment.resolveEnvironmentPlan({ capabilityContract: capability, candidateLoadoutId: input.configuration.loadoutId }),
    enabled: input.expanded && !input.configuration.isDefault && !!loadout,
    staleTime: 60_000,
    retry: false,
  });
  let check: LoadoutEnvironmentCheck;
  if (input.configuration.isDefault) {
    const plan: NimiRuntimeLocalEnvironmentPlan | undefined = input.inventory.environments[capability];
    check = plan
      ? { kind: 'checked', plan }
      : capability in input.inventory.environments
        ? { kind: 'failed' }
        : { kind: 'not-checked' };
  } else if (candidate.isFetching) {
    check = { kind: 'checking' };
  } else if (candidate.isError) {
    check = { kind: 'failed', message: candidate.error instanceof Error ? candidate.error.message : String(candidate.error) };
  } else if (candidate.data) {
    check = { kind: 'checked', plan: candidate.data };
  } else {
    check = { kind: 'not-checked' };
  }
  const status = loadoutPreparationStatus({
    loadout: loadout ?? { loadoutId: input.configuration.loadoutId, capabilityContract: capability, validationState: input.configuration.validationState },
    check,
    tasks: input.tasks,
  });
  return {
    status,
    check,
    retry: () => {
      if (input.configuration.isDefault) void queryClient.invalidateQueries({ queryKey: CAPABILITY_INVENTORY_KEY });
      else void candidate.refetch();
    },
  };
}

function ConfigurationBadge(props: {
  readonly configuration: LocalModelConfiguration;
  readonly inventory: CapabilityInventory;
  readonly tasks: readonly RuntimeSetupTask[];
  readonly expanded: boolean;
  readonly prefix: string;
}) {
  const { t } = useTranslation();
  const { status } = useConfigurationStatus(props);
  return (
    <span className="flex items-center gap-1.5" data-testid={`local-model-configuration-badge:${props.configuration.loadoutId}`}>
      <span>{props.prefix}</span>
      {status.state !== 'ready' ? (
        <StatusBadge tone={BADGE_TONE[status.state]} className="px-2 py-0" data-state={status.state} data-reason={status.reason}>
          {t(`runtimeConfig.localModels.reason.${status.reason}`)}
        </StatusBadge>
      ) : null}
    </span>
  );
}

function ConfigurationDetail(props: {
  readonly configuration: LocalModelConfiguration;
  readonly shortId: string;
  readonly sameName: boolean;
  readonly inventory: CapabilityInventory;
  readonly tasks: readonly RuntimeSetupTask[];
  readonly onOpenConfiguration: (configuration: LocalModelConfiguration) => void;
  readonly onOpenTask?: (taskId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { configuration } = props;
  const { status, check, retry } = useConfigurationStatus({ ...props, expanded: true });
  const label = displayRuntimeConfigCapabilityLabel(configuration.capability, t);
  const loadout = props.inventory.aggregate.loadouts.find((item) => item.loadoutId === configuration.loadoutId);
  const messages = loadout ? loadoutValidationMessages(loadout, t) : [];
  const environment = loadoutEnvironmentSummary(check);
  const identity = `${configuration.displayName || label}${props.sameName ? ` · ${props.shortId}` : ''}`;
  const created = Date.parse(configuration.createdAt);
  const technicalReasons = [...new Set(loadout ? [...loadout.reasons, ...loadout.modelAxes.flatMap((axis) => axis.reasons)] : [])];
  const validationIncomplete = configuration.validationState !== 'configured';
  const actionLabel = validationIncomplete ? t('runtimeConfig.localModels.reviewConfiguration') : t(configuration.role === 'companion' ? 'runtimeConfig.localModels.viewOwningConfiguration' : 'runtimeConfig.localModels.viewConfiguration');
  return (
    <div
      className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3"
      role="group"
      aria-label={identity}
      data-testid={`local-model-configuration:${configuration.loadoutId}`}
      data-state={status.state}
      data-reason={status.reason}
      data-missing={status.missingDependencyIds.join(',')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium text-[var(--nimi-text-primary)]">{configuration.displayName || label}</span>
          {props.sameName ? <span className="text-[var(--nimi-text-secondary)]">{t('runtimeConfig.localModels.configurationId', { id: props.shortId })}</span> : null}
          {configuration.isDefault ? <Chip>{t('runtimeConfig.localModels.defaultLabel', { capability: label })}</Chip> : <span className="text-[var(--nimi-text-secondary)]">{label}</span>}
        </div>
        <StatusBadge tone={BADGE_TONE[status.state]} className="px-2 py-0">
          {t(`runtimeConfig.localModels.reason.${status.reason}`)}
        </StatusBadge>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[var(--nimi-text-secondary)]">
        <span>{configuration.primaryModels.length > 0 ? t('runtimeConfig.localModels.primaryModels', { models: configuration.primaryModels.join(' · ') }) : t('runtimeConfig.localModels.primaryModelUnresolved')}</span>
        {props.sameName && Number.isFinite(created) ? <span>{t('runtimeConfig.localModels.createdAt', { date: new Date(created).toLocaleString(i18n.language) })}</span> : null}
      </div>
      <p className="mt-2 text-[var(--nimi-text-secondary)]">{t('runtimeConfig.localModels.configurationCheck')}: {t(`runtimeConfig.localModels.validationState.${configuration.validationState}`)}</p>
      {messages.length > 0 ? <ul className="mt-1 list-inside list-disc space-y-1 text-[var(--nimi-status-warning)]">{messages.map((message) => <li key={message}>{message}</li>)}</ul> : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[var(--nimi-text-secondary)]">
        <span data-testid={`local-model-environment-summary:${configuration.loadoutId}`}>
          {t('runtimeConfig.localModels.environmentCheck')}:{' '}
          {check.kind === 'checked' && environment
            ? check.plan.state === 'unsupported'
              ? t('runtimeConfig.localModels.reason.environment-unsupported')
              : t('runtimeConfig.capabilities.environmentSummary', { ready: environment.ready, count: environment.count })
            : t(`runtimeConfig.localModels.reason.${check.kind === 'failed' ? 'check-failed' : check.kind === 'checking' ? 'checking' : 'not-checked'}`)}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {retry ? (
            <Button tone="ghost" size="sm" disabled={check.kind === 'checking'} onClick={retry} aria-label={t('runtimeConfig.localModels.actionFor', { action: t('runtimeConfig.localModels.checkNow'), configuration: identity })} data-testid={`local-model-configuration-check:${configuration.loadoutId}`}>
              {t(check.kind === 'failed' ? 'Common.retry' : check.kind === 'checked' ? 'runtimeConfig.localModels.recheck' : 'runtimeConfig.localModels.checkNow')}
            </Button>
          ) : null}
          <Button tone={validationIncomplete ? 'secondary' : 'ghost'} size="sm" aria-label={t('runtimeConfig.localModels.actionFor', { action: actionLabel, configuration: identity })} onClick={() => props.onOpenConfiguration(configuration)} data-testid={`local-model-open-configuration:${configuration.loadoutId}`}>
            {actionLabel}
          </Button>
        </span>
      </div>
      {environment && environment.missingDependencyIds.length > 0 ? <p className="mt-1 text-[var(--nimi-status-warning)]">{t('runtimeConfig.localModels.missingComponents', { items: environment.missingDependencyIds.join(', ') })}</p> : null}
      {status.task ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[var(--nimi-text-secondary)]">
          <span>{t(status.task.status === 'preparing' || status.task.status === 'committing' ? 'runtimeConfig.localModels.taskInProgress' : 'runtimeConfig.localModels.taskNeedsAttention')}</span>
          {props.onOpenTask ? <Button size="sm" tone="ghost" onClick={() => props.onOpenTask?.(status.task!.taskId)}>{t('runtimeConfig.localModels.viewTask')}</Button> : null}
        </div>
      ) : null}
      <details className="mt-2 text-[var(--nimi-text-secondary)]">
        <summary className="cursor-pointer">{t('runtimeConfig.loadouts.technicalDetails')}</summary>
        <div className="mt-2 space-y-1 break-all">
          <p>{t('runtimeConfig.localModels.configurationId', { id: configuration.loadoutId })}</p>
          {configuration.references.map((reference) => <p key={`${reference.modelAssetId}:${reference.slotId}`}>{reference.slotId} · {reference.modelAssetId}</p>)}
          {loadout ? <p>{loadout.recipeId}@{loadout.recipeRevision} · {JSON.stringify(loadout.options)}</p> : null}
          {technicalReasons.length > 0 ? <p>{technicalReasons.join(' · ')}</p> : null}
          {check.kind === 'failed' && check.message ? <p>{check.message}</p> : null}
        </div>
      </details>
    </div>
  );
}
