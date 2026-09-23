import { Button, InlineAlert, StatusBadge, type StatusTone } from '@nimiplatform/kit/ui';
import type { NimiRuntimeLocalEnvironmentPlan } from '@nimiplatform/sdk/runtime';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, FolderOpen } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../components/download-format.js';
import { IdentityTile } from '../../components/identity-tile.js';
import type { CapabilityInventory, CapabilityPreparationState } from './runtime-capability-inventory.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import {
  buildLocalModelList,
  configurableCapabilities,
  type LocalModelConfiguration,
  type LocalModelEntry,
  type LocalModelVariant,
} from './runtime-local-model-list.js';
import {
  loadoutPreparationStatus,
  type LoadoutEnvironmentCheck,
  type LoadoutPreparationStatus,
} from './runtime-local-model-status.js';
import type { RuntimeSetupTask } from './runtime-setup-task-store.js';
import type { useRuntimeModelLibrary } from './use-runtime-model-library.js';

// @nimi-authority: rule.nimi.desktop.ai-consumption.local-model-overview
// @nimi-authority: rule.nimi.desktop.ai-consumption.model-preparation-status-ownership
// @nimi-authority: rule.nimi.desktop.ai-consumption.model-verification-claims
//
// The on-device model list on the AI Capabilities home. Rows are organized by
// model; each variant keeps its own identity, and preparation status is shown
// per saved configuration. Rendering, expanding and refreshing this list only
// read: the environment check for a non-default configuration is a read-only
// plan resolution that runs when the row is expanded, and entering a setup
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
  readonly onOpenModelFiles?: () => void;
}) {
  const { t } = useTranslation();
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
        {props.onOpenModelFiles ? (
          <Button tone="ghost" size="sm" onClick={props.onOpenModelFiles} data-testid="local-model-list-manage-files">
            <FolderOpen size={14} />
            {t('runtimeConfig.capabilities.manageFiles')}
          </Button>
        ) : null}
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
            <ModelCard
              key={entry.modelKey}
              entry={entry}
              inventory={props.inventory!}
              tasks={props.tasks}
              onOpenCapability={props.onOpenCapability}
              onOpenModelFiles={props.onOpenModelFiles}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ModelCard(props: {
  readonly entry: LocalModelEntry;
  readonly inventory: CapabilityInventory;
  readonly tasks: readonly RuntimeSetupTask[];
  readonly onOpenCapability: (capability: string) => void;
  readonly onOpenModelFiles?: () => void;
}) {
  const { entry } = props;
  return (
    <article
      className="rounded-2xl bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)] ring-1 ring-[var(--nimi-border-subtle)]"
      data-testid={`local-model:${entry.modelKey}`}
    >
      <div className="flex items-center gap-3 px-4 pt-3.5">
        <IdentityTile seed={entry.title.split(/\s+/u)[0] ?? entry.title} label={entry.title} size="sm" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{entry.title}</h3>
      </div>
      <div className="divide-y divide-[var(--nimi-border-subtle)]">
        {entry.variants.map((variant) => (
          <VariantRow
            key={variant.contentId}
            variant={variant}
            inventory={props.inventory}
            tasks={props.tasks}
            onOpenCapability={props.onOpenCapability}
            onOpenModelFiles={props.onOpenModelFiles}
          />
        ))}
      </div>
    </article>
  );
}

function VariantRow(props: {
  readonly variant: LocalModelVariant;
  readonly inventory: CapabilityInventory;
  readonly tasks: readonly RuntimeSetupTask[];
  readonly onOpenCapability: (capability: string) => void;
  readonly onOpenModelFiles?: () => void;
}) {
  const { t } = useTranslation();
  const { variant } = props;
  const [expanded, setExpanded] = useState(false);
  const label = (id: string) => displayRuntimeConfigCapabilityLabel(id, t);
  const configurable = configurableCapabilities(variant);
  const defaults = variant.configurations.filter((item) => item.isDefault);
  // Per capability: the default configuration when there is one, otherwise the count of saved ones.
  const capabilitySummaries = [...new Set(variant.configurations.map((item) => item.capability))].map((capability) => {
    const items = variant.configurations.filter((item) => item.capability === capability);
    return { capability, defaultItem: items.find((item) => item.isDefault), count: items.length };
  });
  const viewCapability = defaults[0]?.capability ?? variant.configurations[0]?.capability;
  return (
    <div className="px-4 py-3" data-testid={`local-model-variant:${variant.contentId}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{variant.title}</span>
            {variant.quantLabel ? <Chip>{variant.quantLabel}</Chip> : null}
            {variant.format ? <Chip>{variant.format}</Chip> : null}
            <span className="text-xs text-[var(--nimi-text-muted)]">
              {formatBytes(variant.sizeBytes)} · {t('runtimeConfig.localModels.files', { count: variant.fileCount })}
            </span>
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
                  prefix={`${label(summary.capability)} · ${t('runtimeConfig.localModels.defaultLabel')}`}
                />
              ) : (
                <span key={summary.capability} className="flex items-center gap-1.5">
                  <span>{label(summary.capability)}</span>
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
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {viewCapability ? (
            <Button
              tone="secondary"
              size="sm"
              onClick={() => props.onOpenCapability(viewCapability)}
              data-testid={`local-model-view:${variant.contentId}`}
            >
              {t('runtimeConfig.localModels.view', { capability: label(viewCapability) })}
            </Button>
          ) : null}
          {configurable
            .filter((capability) => !variant.configurations.some((item) => item.capability === capability))
            .map((capability) => (
              <Button
                key={capability}
                tone={viewCapability ? 'ghost' : 'secondary'}
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
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            data-testid={`local-model-variant-toggle:${variant.contentId}`}
          >
            {t(expanded ? 'runtimeConfig.localModelCenter.hideDetails' : 'runtimeConfig.localModelCenter.details')}
            <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </Button>
        </div>
      </div>
      {expanded ? (
        <div className="mt-3 space-y-3 rounded-xl bg-[var(--nimi-surface-subtle)] px-4 py-3 text-xs" data-testid={`local-model-variant-details:${variant.contentId}`}>
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
              <p className="font-semibold text-[var(--nimi-text-muted)]">{t('runtimeConfig.localModels.configurations')}</p>
              {variant.configurations.map((configuration) => (
                <ConfigurationDetail
                  key={configuration.loadoutId}
                  configuration={configuration}
                  inventory={props.inventory}
                  tasks={props.tasks}
                  onOpenCapability={props.onOpenCapability}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
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
  const loadout = input.inventory.aggregate.loadouts.find((item) => item.loadoutId === input.configuration.loadoutId);
  const capability = input.configuration.capability;
  const candidate = useQuery({
    queryKey: ['runtime', 'loadout-environment', input.configuration.loadoutId, loadout?.revision ?? ''],
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
  } else if (candidate.isError) {
    check = { kind: 'failed', message: candidate.error instanceof Error ? candidate.error.message : String(candidate.error) };
  } else if (candidate.data) {
    check = { kind: 'checked', plan: candidate.data };
  } else if (candidate.isFetching) {
    check = { kind: 'checking' };
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
    retry: !input.configuration.isDefault
      ? () => {
          void candidate.refetch();
        }
      : undefined,
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
      <StatusBadge tone={BADGE_TONE[status.state]} className="px-2 py-0" data-state={status.state} data-reason={status.reason}>
        {t(`runtimeConfig.localModels.reason.${status.reason}`)}
      </StatusBadge>
    </span>
  );
}

function ConfigurationDetail(props: {
  readonly configuration: LocalModelConfiguration;
  readonly inventory: CapabilityInventory;
  readonly tasks: readonly RuntimeSetupTask[];
  readonly onOpenCapability: (capability: string) => void;
}) {
  const { t } = useTranslation();
  const { configuration } = props;
  const { status, check, retry } = useConfigurationStatus({ ...props, expanded: true });
  const label = displayRuntimeConfigCapabilityLabel(configuration.capability, t);
  return (
    <div
      className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2"
      data-testid={`local-model-configuration:${configuration.loadoutId}`}
      data-state={status.state}
      data-reason={status.reason}
      data-missing={status.missingDependencyIds.join(',')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium text-[var(--nimi-text-primary)]">{configuration.displayName || label}</span>
          <span className="text-[var(--nimi-text-muted)]">{label}</span>
          {configuration.isDefault ? <Chip>{t('runtimeConfig.localModels.defaultLabel')}</Chip> : null}
          {configuration.role === 'companion' ? (
            <span className="text-[var(--nimi-text-muted)]">{t('runtimeConfig.localModels.companionFor', { capability: label })}</span>
          ) : null}
        </div>
        <StatusBadge tone={BADGE_TONE[status.state]} className="px-2 py-0">
          {t(`runtimeConfig.localModels.reason.${status.reason}`)}
        </StatusBadge>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[var(--nimi-text-secondary)]">
        <span>
          {t('runtimeConfig.localModels.environmentCheck')}:{' '}
          {check.kind === 'checked'
            ? status.missingDependencyIds.length > 0
              ? t('runtimeConfig.localModels.missingComponents', { items: status.missingDependencyIds.join(', ') })
              : t('runtimeConfig.capabilities.environmentSummary', {
                  ready: check.plan.dependencies.filter((item) => item.required).length - status.missingDependencyIds.length,
                  count: check.plan.dependencies.filter((item) => item.required).length,
                })
            : t(`runtimeConfig.localModels.reason.${check.kind === 'failed' ? 'check-failed' : check.kind === 'checking' ? 'checking' : 'not-checked'}`)}
          {check.kind === 'failed' && check.message ? <span className="ml-1 text-[var(--nimi-text-muted)]">({check.message})</span> : null}
        </span>
        <span className="flex items-center gap-1">
          {retry && (check.kind === 'failed' || check.kind === 'not-checked') ? (
            <Button tone="ghost" size="sm" onClick={retry} data-testid={`local-model-configuration-check:${configuration.loadoutId}`}>
              {t(check.kind === 'failed' ? 'Common.retry' : 'runtimeConfig.localModels.checkNow')}
            </Button>
          ) : null}
          <Button tone="ghost" size="sm" onClick={() => props.onOpenCapability(configuration.capability)}>
            {t('runtimeConfig.localModels.view', { capability: label })}
          </Button>
        </span>
      </div>
    </div>
  );
}
