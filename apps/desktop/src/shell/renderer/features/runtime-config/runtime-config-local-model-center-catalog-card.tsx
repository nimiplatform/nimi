import type {
  GgufVariantDescriptor,
  LocalRuntimeArtifactKind,
  LocalRuntimeArtifactRecord,
  LocalRuntimeCatalogItemDescriptor,
  LocalRuntimeModelLifecycleOperation,
  LocalRuntimeVerifiedArtifactDescriptor,
  LocalRuntimeVerifiedModelDescriptor,
  OrphanArtifactFile,
  OrphanModelFile,
} from '@runtime/local-runtime';
import { i18n } from '@renderer/i18n';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import type { LocalModelOptionV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { RuntimeSelect } from './runtime-config-primitives';
import {
  CAPABILITY_OPTIONS,
  INSTALL_ENGINE_OPTIONS,
  type CapabilityOption,
  type InstallEngineOption,
  formatBytes,
  isLocalModelLifecycleBusy,
  isLocalModelLifecycleVisible,
  normalizeInstallEngine,
} from './runtime-config-model-center-utils';
import {
  ARTIFACT_KIND_OPTIONS,
  DownloadIcon,
  FolderOpenIcon,
  formatArtifactKindLabel,
  isRecommendedDescriptor,
  ModelIcon,
  PackageIcon,
  RecommendationDetailList,
  RecommendationDiagnosticsPanel,
  recommendationConfidenceLabel,
  recommendationHostSupportLabel,
  recommendationSummary,
  recommendationTierClass,
  recommendationTierLabel,
  RefreshIcon,
  SearchIcon,
  StarIcon,
  Toggle,
  TrashIcon,
} from './runtime-config-local-model-center-helpers';
import { ArtifactRequirementBadges } from './runtime-config-local-model-center-sections';

type CatalogCardProps = {
  searchQuery: string;
  catalogCapability: 'all' | CapabilityOption;
  filteredInstalledModels: LocalModelOptionV11[];
  filteredInstalledArtifacts: LocalRuntimeArtifactRecord[];
  localModelLifecycleById: Record<string, LocalRuntimeModelLifecycleOperation>;
  localModelLifecycleErrorById: Record<string, string>;
  loadingCatalog: boolean;
  loadingInstalledArtifacts: boolean;
  loadingVerifiedArtifacts: boolean;
  artifactKindFilter: 'all' | LocalRuntimeArtifactKind;
  artifactBusy: boolean;
  orphanFiles: OrphanModelFile[];
  orphanError: string;
  orphanCapabilities: Record<string, CapabilityOption>;
  orphanImportSessionByPath: Record<string, string>;
  scaffoldingOrphan: string | null;
  artifactOrphanFiles: OrphanArtifactFile[];
  artifactOrphanError: string;
  artifactOrphanKinds: Record<string, LocalRuntimeArtifactKind>;
  scaffoldingArtifactOrphan: string | null;
  hasSearchQuery: boolean;
  verifiedModels: LocalRuntimeVerifiedModelDescriptor[];
  catalogItems: LocalRuntimeCatalogItemDescriptor[];
  catalogDisplayCount: number;
  relatedArtifactsByModelTemplate: Map<string, LocalRuntimeVerifiedArtifactDescriptor[]>;
  installedArtifactsById: Map<string, LocalRuntimeArtifactRecord>;
  variantPickerItem: LocalRuntimeCatalogItemDescriptor | null;
  variantList: GgufVariantDescriptor[];
  variantError: string;
  loadingVariants: boolean;
  selectedCatalogCapability: (item: LocalRuntimeCatalogItemDescriptor) => CapabilityOption;
  selectedCatalogEngine: (item: LocalRuntimeCatalogItemDescriptor) => InstallEngineOption;
  isArtifactPending: (templateId: string) => boolean;
  onSearchQueryChange: (value: string) => void;
  onCatalogCapabilityChange: (value: 'all' | CapabilityOption) => void;
  onStartModel: (localModelId: string) => Promise<void>;
  onStopModel: (localModelId: string) => Promise<void>;
  onRemoveModel: (localModelId: string) => void;
  onArtifactKindFilterChange: (value: 'all' | LocalRuntimeArtifactKind) => void;
  onRefreshArtifacts: () => void;
  onRemoveArtifact: (localArtifactId: string) => void;
  onOrphanCapabilityChange: (path: string, capability: CapabilityOption) => void;
  onScaffoldOrphan: (path: string) => void;
  onArtifactOrphanKindChange: (path: string, kind: LocalRuntimeArtifactKind) => void;
  onScaffoldArtifactOrphan: (path: string) => void;
  onInstallMissingArtifacts: (artifacts: LocalRuntimeVerifiedArtifactDescriptor[]) => void;
  onInstallVerifiedModel: (templateId: string) => void;
  onInstallArtifact: (templateId: string) => void;
  onToggleVariantPicker: (item: LocalRuntimeCatalogItemDescriptor) => void;
  onCloseVariantPicker: () => void;
  onCatalogCapabilityOverrideChange: (itemId: string, capability: CapabilityOption) => void;
  onCatalogEngineOverrideChange: (itemId: string, engine: InstallEngineOption) => void;
  onInstallCatalogVariant: (item: LocalRuntimeCatalogItemDescriptor, variantFilename: string) => void;
  onLoadMoreCatalog: () => void;
  installing: boolean;
};

function localModelLifecycleLabel(value: LocalRuntimeModelLifecycleOperation | undefined): string {
  if (value === 'starting') {
    return i18n.t('runtimeConfig.localModelCenter.starting', { defaultValue: 'Starting' });
  }
  if (value === 'stopping') {
    return i18n.t('runtimeConfig.localModelCenter.stopping', { defaultValue: 'Stopping' });
  }
  if (value === 'restarting') {
    return i18n.t('runtimeConfig.localModelCenter.restarting', { defaultValue: 'Restarting' });
  }
  if (value === 'syncing') {
    return i18n.t('runtimeConfig.localModelCenter.syncing', { defaultValue: 'Syncing' });
  }
  return i18n.t('runtimeConfig.localModelCenter.working', { defaultValue: 'Working' });
}

function VerifiedModelSearchRow(props: {
  item: LocalRuntimeVerifiedModelDescriptor;
  relatedArtifacts: LocalRuntimeVerifiedArtifactDescriptor[];
  installedArtifactsById: Map<string, LocalRuntimeArtifactRecord>;
  artifactBusy: boolean;
  installing: boolean;
  isArtifactPending: (templateId: string) => boolean;
  onInstallMissingArtifacts: (artifacts: LocalRuntimeVerifiedArtifactDescriptor[]) => void;
  onInstallArtifact: (templateId: string) => void;
  onInstallVerifiedModel: (templateId: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
        <StarIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{props.item.title}</span>
          {isRecommendedDescriptor(props.item.tags) ? (
            <span className="rounded bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-status-warning)]">
              {i18n.t('runtimeConfig.localModelCenter.recommended', { defaultValue: 'Recommended' })}
            </span>
          ) : null}
          <span className="rounded bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-status-warning)]">
            {i18n.t('runtimeConfig.localModelCenter.verified', { defaultValue: 'Verified' })}
          </span>
        </div>
        <p className="truncate text-xs text-[var(--nimi-text-muted)]">{props.item.modelId}</p>
        {props.item.description ? <p className="mt-0.5 line-clamp-1 text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{props.item.description}</p> : null}
        <ArtifactRequirementBadges
          modelTemplateId={props.item.templateId}
          relatedArtifacts={props.relatedArtifacts}
          installedArtifactsById={props.installedArtifactsById}
          artifactBusy={props.artifactBusy}
          isArtifactPending={props.isArtifactPending}
          onInstallMissingArtifacts={props.onInstallMissingArtifacts}
          onInstallArtifact={props.onInstallArtifact}
        />
      </div>
      <button
        type="button"
        onClick={() => props.onInstallVerifiedModel(props.item.templateId)}
        disabled={props.installing}
        className="flex items-center gap-1.5 rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:opacity-50"
      >
        <DownloadIcon className="h-3.5 w-3.5" />
        {i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
      </button>
    </div>
  );
}

function CatalogVariantPicker(props: {
  item: LocalRuntimeCatalogItemDescriptor;
  variantList: GgufVariantDescriptor[];
  variantError: string;
  loadingVariants: boolean;
  selectedCapability: CapabilityOption;
  selectedEngine: InstallEngineOption;
  installing: boolean;
  onClose: () => void;
  onCapabilityChange: (capability: CapabilityOption) => void;
  onEngineChange: (engine: InstallEngineOption) => void;
  onInstallVariant: (filename: string) => void;
}) {
  return (
    <div className="bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]/80 px-4 pb-3">
      <div className="overflow-hidden rounded-lg border border-[var(--nimi-border-subtle)] bg-white">
        <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-3 py-2">
          <span className="text-xs font-semibold text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.selectVariant', { defaultValue: 'Select Variant' })}
          </span>
          <button type="button" onClick={props.onClose} className="text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)] hover:text-[var(--nimi-text-secondary)]">
            {i18n.t('Common.close', { defaultValue: 'Close' })}
          </button>
        </div>
        <div className="border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,var(--nimi-surface-panel))] px-3 py-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.capability', { defaultValue: 'Capability' })}
              </p>
              <RuntimeSelect
                value={props.selectedCapability}
                onChange={(next) => props.onCapabilityChange((next || 'chat') as CapabilityOption)}
                className="w-full"
                options={CAPABILITY_OPTIONS.map((capability) => ({ value: capability, label: capability }))}
              />
              <p className="mt-1 text-[10px] text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.detectedValue', {
                  value: (props.item.capabilities.length > 0 ? props.item.capabilities : ['chat']).join(', '),
                  defaultValue: 'Detected: {{value}}',
                })}
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.engine', { defaultValue: 'Engine' })}
              </p>
              <RuntimeSelect
                value={props.selectedEngine}
                onChange={(next) => props.onEngineChange(normalizeInstallEngine(next))}
                className="w-full"
                options={INSTALL_ENGINE_OPTIONS.map((engine) => ({ value: engine, label: engine }))}
              />
              <p className="mt-1 text-[10px] text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.detectedValue', {
                  value: normalizeInstallEngine(props.item.engine),
                  defaultValue: 'Detected: {{value}}',
                })}
              </p>
            </div>
          </div>
        </div>
        {props.loadingVariants ? (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.loadingVariants', { defaultValue: 'Loading variants...' })}
            </p>
          </div>
        ) : props.variantList.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-[var(--nimi-text-muted)]">
              {props.variantError
                ? i18n.t('runtimeConfig.localModelCenter.variantError', {
                  error: props.variantError,
                  defaultValue: 'Error: {{error}}',
                })
                : i18n.t('runtimeConfig.localModelCenter.noVariantsFound', { defaultValue: 'No GGUF variants found' })}
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-48 divide-y divide-gray-100" viewportClassName="max-h-48">
            {props.variantList.map((variant) => (
              <button
                key={variant.filename}
                type="button"
                disabled={props.installing}
                onClick={() => props.onInstallVariant(variant.filename)}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] disabled:opacity-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-[var(--nimi-text-primary)]">{variant.filename}</span>
                    {variant.recommendation ? (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${recommendationTierClass(variant.recommendation.tier)}`}>
                        {recommendationTierLabel(variant.recommendation.tier)}
                      </span>
                    ) : null}
                  </div>
                  {variant.recommendation ? (
                    <p className="mt-1 truncate text-[10px] text-[var(--nimi-text-muted)]">
                      {recommendationSummary(variant.recommendation)}
                    </p>
                  ) : null}
                  <RecommendationDetailList
                    recommendation={variant.recommendation}
                    className="mt-1 space-y-0.5"
                    rowClassName="text-[10px] text-[var(--nimi-text-muted)]"
                    labelClassName="font-medium text-[var(--nimi-text-secondary)]"
                    maxFallbackEntries={2}
                  />
                  <RecommendationDiagnosticsPanel
                    recommendation={variant.recommendation}
                    className="mt-1"
                  />
                </div>
                <div className="ml-2 shrink-0 text-right">
                  <p className="text-[10px] text-[var(--nimi-text-muted)]">{variant.format}</p>
                  {typeof variant.sizeBytes === 'number' ? (
                    <p className="text-[10px] text-[var(--nimi-text-muted)]">{formatBytes(variant.sizeBytes)}</p>
                  ) : null}
                </div>
              </button>
            ))}
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

export function LocalModelCenterCatalogCard(props: CatalogCardProps) {
  return (
    <div className="overflow-visible rounded-2xl bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04]">
      <div className="border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-4 py-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] text-[var(--nimi-action-primary-bg)]">
            <SearchIcon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {i18n.t('runtimeConfig.localModelCenter.modelCatalog', { defaultValue: 'Model Catalog' })}
            </h3>
            <p className="text-xs text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.modelCatalogDescription', {
                defaultValue: 'Search and install from Hugging Face or verified models',
              })}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
            <input
              type="text"
              value={props.searchQuery}
              onChange={(event) => props.onSearchQueryChange(event.target.value)}
              placeholder={i18n.t('runtimeConfig.localModelCenter.searchModelsPlaceholder', { defaultValue: 'Search models by name, repo, or task...' })}
              className="h-10 w-full rounded-lg border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] pl-9 pr-4 text-sm outline-none focus:border-[var(--nimi-field-focus)] focus:bg-white focus:ring-2 focus:ring-mint-100"
            />
          </div>
          <RuntimeSelect
            value={props.catalogCapability}
            onChange={(nextCapability) => props.onCatalogCapabilityChange((nextCapability || 'all') as 'all' | CapabilityOption)}
            className="w-52"
            options={[
              {
                value: 'all',
                label: i18n.t('runtimeConfig.localModelCenter.allCapabilities', { defaultValue: 'All Capabilities' }),
              },
              ...CAPABILITY_OPTIONS.map((capability) => ({ value: capability, label: capability })),
            ]}
          />
        </div>
      </div>

      <div className="rounded-b-xl bg-white/60">
        <div className="flex items-center gap-2 border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-4 py-2">
          <PackageIcon className="h-4 w-4 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.installedCount', {
              count: props.filteredInstalledModels.length,
              defaultValue: 'Installed ({{count}})',
            })}
          </span>
        </div>
        {props.filteredInstalledModels.length > 0 ? (
          <div className="divide-y divide-gray-200/80">
            {props.filteredInstalledModels.map((model) => {
              const lifecycle = props.localModelLifecycleById[model.localModelId];
              const lifecycleError = props.localModelLifecycleErrorById[model.localModelId];
              const toggleBusy = isLocalModelLifecycleBusy(lifecycle);
              const actionLocked = isLocalModelLifecycleVisible(lifecycle);
              return (
              <div key={model.localModelId} className="px-4 py-3 transition-colors hover:bg-white">
                <div className="flex items-center gap-3">
                <ModelIcon engine={model.engine} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{model.model}</span>
                    <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">{model.engine}</span>
                    {model.recommendation ? (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${recommendationTierClass(model.recommendation.tier)}`}>
                        {recommendationTierLabel(model.recommendation.tier)}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-[var(--nimi-text-muted)]">{model.localModelId}</p>
                  {model.recommendation ? (
                    <p className="mt-1 line-clamp-2 text-[11px] text-[var(--nimi-text-muted)]">
                      {recommendationSummary(model.recommendation)}
                    </p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {model.capabilities.slice(0, 3).map((capability) => (
                      <span key={capability} className="rounded border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-action-primary-bg)]">{capability}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isLocalModelLifecycleVisible(lifecycle) ? (
                    <span className="rounded bg-[color-mix(in_srgb,var(--nimi-status-info)_18%,transparent)] px-2 py-0.5 text-[10px] text-[var(--nimi-status-info)]">
                      {localModelLifecycleLabel(lifecycle)}
                    </span>
                  ) : null}
                  <span className={`rounded px-2 py-0.5 text-[10px] ${
                    model.status === 'active' ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]' : model.status === 'unhealthy' ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-muted)]'
                  }`}>
                    {model.status}
                  </span>
                  <Toggle
                    checked={model.status === 'active'}
                    disabled={toggleBusy}
                    onChange={() => {
                      void (async () => {
                        if (model.status === 'active') {
                          await props.onStopModel(model.localModelId);
                          return;
                        }
                        await props.onStartModel(model.localModelId);
                      })();
                    }}
                  />
                  <button
                    type="button"
                    disabled={actionLocked}
                    onClick={() => props.onRemoveModel(model.localModelId)}
                    className="rounded-lg p-1.5 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] hover:text-[var(--nimi-status-danger)]"
                    title={i18n.t('runtimeConfig.localModelCenter.remove', { defaultValue: 'Remove' })}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
                {lifecycleError ? (
                  <p className="mt-2 rounded-lg bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]">
                    {lifecycleError}
                  </p>
                ) : null}
              </div>
            );})}
          </div>
        ) : (
          <div className="px-4 py-8 text-center">
            <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
              <PackageIcon className="h-6 w-6" />
            </div>
            <h3 className="mb-1 text-sm font-medium text-[var(--nimi-text-primary)]">
              {i18n.t('runtimeConfig.localModelCenter.noInstalledModels', { defaultValue: 'No Installed Models' })}
            </h3>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--nimi-border-subtle)] bg-white/60">
        <div className="flex items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-4 py-2">
          <div className="flex items-center gap-2">
            <FolderOpenIcon className="h-4 w-4 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.companionAssetsCount', {
                count: props.filteredInstalledArtifacts.length,
                defaultValue: 'Companion Assets ({{count}})',
              })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <RuntimeSelect
              value={props.artifactKindFilter}
              onChange={(next) => props.onArtifactKindFilterChange((next || 'all') as 'all' | LocalRuntimeArtifactKind)}
              className="w-36"
              options={[
                {
                  value: 'all',
                  label: i18n.t('runtimeConfig.localModelCenter.allKinds', { defaultValue: 'All Kinds' }),
                },
                ...ARTIFACT_KIND_OPTIONS.map((kind) => ({ value: kind, label: formatArtifactKindLabel(kind) })),
              ]}
            />
            <button
              type="button"
              onClick={props.onRefreshArtifacts}
              disabled={props.loadingInstalledArtifacts || props.loadingVerifiedArtifacts || props.artifactBusy}
              className="flex items-center gap-1.5 rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] disabled:opacity-50"
            >
              <RefreshIcon className="h-3 w-3" />
              {i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
            </button>
          </div>
        </div>
        {props.loadingInstalledArtifacts ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.loadingCompanionAssets', { defaultValue: 'Loading companion assets...' })}
            </p>
          </div>
        ) : props.filteredInstalledArtifacts.length > 0 ? (
          <div className="divide-y divide-gray-200/80">
            {props.filteredInstalledArtifacts.map((artifact) => (
              <div key={artifact.localArtifactId} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[11px] font-semibold text-[var(--nimi-text-secondary)]">
                  {formatArtifactKindLabel(artifact.kind).slice(0, 3).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{artifact.artifactId}</span>
                    <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-secondary)]">
                      {formatArtifactKindLabel(artifact.kind)}
                    </span>
                    <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">{artifact.engine}</span>
                  </div>
                  <p className="truncate text-xs text-[var(--nimi-text-muted)]">{artifact.localArtifactId}</p>
                  <p className="truncate text-[11px] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{artifact.entry}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-[10px] ${
                    artifact.status === 'active' ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]' : artifact.status === 'unhealthy' ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-muted)]'
                  }`}>
                    {artifact.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => props.onRemoveArtifact(artifact.localArtifactId)}
                    disabled={props.artifactBusy}
                    className="rounded-lg p-1.5 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] hover:text-[var(--nimi-status-danger)] disabled:opacity-50"
                    title={i18n.t('runtimeConfig.localModelCenter.removeArtifact', { defaultValue: 'Remove artifact' })}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-center">
            <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
              <FolderOpenIcon className="h-6 w-6" />
            </div>
            <h3 className="mb-1 text-sm font-medium text-[var(--nimi-text-primary)]">
              {i18n.t('runtimeConfig.localModelCenter.noCompanionAssets', { defaultValue: 'No Companion Assets' })}
            </h3>
            <p className="text-xs text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.noCompanionAssetsDescription', {
                defaultValue: 'Import `artifact.manifest.json` files or install verified VAE/LLM assets below.',
              })}
            </p>
          </div>
        )}
      </div>

      {props.artifactOrphanFiles.length > 0 ? (
        <div className="border-t border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]/60">
          <div className="flex items-center gap-2 border-b border-[var(--nimi-border-subtle)] px-4 py-2">
            <svg className="h-4 w-4 text-[var(--nimi-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5" />
              <path d="M12 22V12" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-secondary)]">
              {i18n.t('runtimeConfig.localModelCenter.unregisteredCompanionAssets', {
                count: props.artifactOrphanFiles.length,
                defaultValue: 'Unregistered Companion Assets ({{count}})',
              })}
            </span>
          </div>
          <div className="border-b border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))]/70 px-4 py-2 text-[11px] text-[var(--nimi-text-secondary)]">
            {i18n.t('runtimeConfig.localModelCenter.unclassifiedFilesDescription', {
              defaultValue: 'Unclassified files can appear in both model and companion lanes until you import them.',
            })}
          </div>
          {props.artifactOrphanError ? (
            <div className="border-b border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-4 py-2 text-xs text-[var(--nimi-status-danger)]">
              {props.artifactOrphanError}
            </div>
          ) : null}
          <div className="divide-y divide-[color-mix(in_srgb,var(--nimi-border-subtle)_70%,transparent)]">
            {props.artifactOrphanFiles.map((orphan) => (
              <div key={`artifact-${orphan.path}`} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-secondary)]">
                  <FolderOpenIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{orphan.filename}</div>
                  <div className="text-xs text-[var(--nimi-text-muted)]">{formatBytes(orphan.sizeBytes)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <RuntimeSelect
                    value={props.artifactOrphanKinds[orphan.path] || 'vae'}
                    onChange={(value) => props.onArtifactOrphanKindChange(orphan.path, (value || 'vae') as LocalRuntimeArtifactKind)}
                    className="w-36"
                    options={ARTIFACT_KIND_OPTIONS.map((kind) => ({ value: kind, label: formatArtifactKindLabel(kind) }))}
                  />
                  <button
                    type="button"
                    disabled={props.artifactBusy || props.scaffoldingArtifactOrphan === orphan.path}
                    onClick={() => props.onScaffoldArtifactOrphan(orphan.path)}
                    className="flex items-center gap-1 rounded-lg bg-[color:rgb(51_65_85)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[color:rgb(30_41_59)] disabled:opacity-50"
                  >
                    <DownloadIcon className="h-3 w-3" />
                    {(props.artifactBusy || props.scaffoldingArtifactOrphan === orphan.path)
                      ? i18n.t('runtimeConfig.localModelCenter.importing', { defaultValue: 'Importing...' })
                      : i18n.t('runtimeConfig.localModelCenter.import', { defaultValue: 'Import' })}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {props.orphanFiles.length > 0 ? (
        <div className="border-t border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)]/50">
          <div className="flex items-center gap-2 border-b border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] px-4 py-2">
            <svg className="h-4 w-4 text-[var(--nimi-status-warning)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-status-warning)]">
              {i18n.t('runtimeConfig.localModelCenter.unregisteredModelsFound', {
                count: props.orphanFiles.length,
                defaultValue: 'Unregistered Models Found ({{count}})',
              })}
            </span>
          </div>
          {props.orphanError ? (
            <div className="border-b border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-4 py-2 text-xs text-[var(--nimi-status-danger)]">
              {props.orphanError}
            </div>
          ) : null}
          <div className="divide-y divide-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)]">
            {props.orphanFiles.map((orphan) => (
              <div key={orphan.path} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]">
                  <FolderOpenIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{orphan.filename}</div>
                    {orphan.recommendation ? (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${recommendationTierClass(orphan.recommendation.tier)}`}>
                        {recommendationTierLabel(orphan.recommendation.tier)}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-[var(--nimi-text-muted)]">{formatBytes(orphan.sizeBytes)}</div>
                  {orphan.recommendation ? (
                    <>
                      <p className="mt-1 line-clamp-2 text-[11px] text-[var(--nimi-text-muted)]">
                        {recommendationSummary(orphan.recommendation)}
                      </p>
                      <RecommendationDetailList
                        recommendation={orphan.recommendation}
                        className="mt-1 space-y-0.5"
                        rowClassName="text-[10px] text-[var(--nimi-text-muted)]"
                        labelClassName="font-medium text-[var(--nimi-text-secondary)]"
                        maxFallbackEntries={2}
                      />
                      <RecommendationDiagnosticsPanel
                        recommendation={orphan.recommendation}
                        className="mt-1"
                      />
                      <div className="mt-1 flex flex-wrap gap-1">
                        {orphan.recommendation.hostSupportClass ? (
                          <span className="rounded border border-[color-mix(in_srgb,var(--nimi-status-info)_22%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-status-info)]">
                            {recommendationHostSupportLabel(orphan.recommendation.hostSupportClass)}
                          </span>
                        ) : null}
                        {orphan.recommendation.confidence ? (
                          <span className="rounded border border-[var(--nimi-border-subtle)] bg-white px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">
                            {recommendationConfidenceLabel(orphan.recommendation.confidence)}
                          </span>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <RuntimeSelect
                    value={props.orphanCapabilities[orphan.path] || 'chat'}
                    onChange={(value) => props.onOrphanCapabilityChange(orphan.path, (value || 'chat') as CapabilityOption)}
                    className="w-32"
                    options={CAPABILITY_OPTIONS.map((capability) => ({ value: capability, label: capability }))}
                  />
                  <button
                    type="button"
                    disabled={props.scaffoldingOrphan === orphan.path || Boolean(props.orphanImportSessionByPath[orphan.path])}
                    onClick={() => props.onScaffoldOrphan(orphan.path)}
                    className="flex items-center gap-1 rounded-lg bg-[var(--nimi-status-warning)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--nimi-status-warning)] disabled:opacity-50"
                  >
                    <DownloadIcon className="h-3 w-3" />
                    {(props.scaffoldingOrphan === orphan.path || props.orphanImportSessionByPath[orphan.path])
                      ? i18n.t('runtimeConfig.localModelCenter.importing', { defaultValue: 'Importing...' })
                      : i18n.t('runtimeConfig.localModelCenter.import', { defaultValue: 'Import' })}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {props.hasSearchQuery ? (
        <div className="border-t border-[var(--nimi-border-subtle)] bg-white/60">
          <div className="border-b border-[var(--nimi-border-subtle)] bg-white/70 px-4 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.availableToInstall', { defaultValue: 'Available to Install' })}
            </span>
          </div>
          <div className="divide-y divide-gray-200/80">
            {props.verifiedModels.map((item) => (
              <VerifiedModelSearchRow
                key={item.templateId}
                item={item}
                relatedArtifacts={props.relatedArtifactsByModelTemplate.get(item.templateId) || []}
                installedArtifactsById={props.installedArtifactsById}
                artifactBusy={props.artifactBusy}
                installing={props.installing}
                isArtifactPending={props.isArtifactPending}
                onInstallMissingArtifacts={props.onInstallMissingArtifacts}
                onInstallArtifact={props.onInstallArtifact}
                onInstallVerifiedModel={props.onInstallVerifiedModel}
              />
            ))}
            {props.catalogItems.slice(0, props.catalogDisplayCount).map((item) => (
              <div key={item.itemId}>
                <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white">
                  <ModelIcon engine={item.engine} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{item.title || item.modelId}</span>
                      <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">{item.engine}</span>
                      <span className="rounded bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-action-primary-bg)]">
                        {i18n.t('runtimeConfig.localModelCenter.huggingFace', { defaultValue: 'Hugging Face' })}
                      </span>
                      {item.recommendation ? (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${recommendationTierClass(item.recommendation.tier)}`}>
                          {recommendationTierLabel(item.recommendation.tier)}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-[var(--nimi-text-muted)]">{item.modelId}</p>
                    {item.recommendation ? (
                      <p className="mt-1 line-clamp-2 text-[11px] text-[var(--nimi-text-muted)]">
                        {recommendationSummary(item.recommendation)}
                      </p>
                    ) : null}
                    <RecommendationDetailList
                      recommendation={item.recommendation}
                      className="mt-1 space-y-0.5"
                      rowClassName="text-[10px] text-[var(--nimi-text-muted)]"
                      labelClassName="font-medium text-[var(--nimi-text-secondary)]"
                      maxFallbackEntries={2}
                    />
                    <RecommendationDiagnosticsPanel
                      recommendation={item.recommendation}
                      className="mt-1"
                    />
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(item.capabilities.length > 0 ? item.capabilities : ['chat']).map((capability) => (
                        <span key={`${item.itemId}-${capability}`} className="rounded border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-secondary)]">
                          {capability}
                        </span>
                      ))}
                      {item.recommendation?.hostSupportClass ? (
                        <span className="rounded border border-[color-mix(in_srgb,var(--nimi-status-info)_22%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-status-info)]">
                          {recommendationHostSupportLabel(item.recommendation.hostSupportClass)}
                        </span>
                      ) : null}
                      {item.recommendation?.confidence ? (
                        <span className="rounded border border-[var(--nimi-border-subtle)] bg-white px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">
                          {recommendationConfidenceLabel(item.recommendation.confidence)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] ${item.installAvailable ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]' : 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]'}`}>
                    {item.installAvailable
                      ? i18n.t('runtimeConfig.localModelCenter.ready', { defaultValue: 'Ready' })
                      : i18n.t('runtimeConfig.localModelCenter.manual', { defaultValue: 'Manual' })}
                  </span>
                  <button
                    type="button"
                    onClick={() => props.onToggleVariantPicker(item)}
                    disabled={!item.installAvailable || props.installing}
                    className="flex items-center gap-1.5 rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:opacity-50"
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                    {i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
                  </button>
                </div>
                {props.variantPickerItem?.itemId === item.itemId ? (
                  <CatalogVariantPicker
                    item={item}
                    variantList={props.variantList}
                    variantError={props.variantError}
                    loadingVariants={props.loadingVariants}
                    selectedCapability={props.selectedCatalogCapability(item)}
                    selectedEngine={props.selectedCatalogEngine(item)}
                    installing={props.installing}
                    onClose={props.onCloseVariantPicker}
                    onCapabilityChange={(capability) => props.onCatalogCapabilityOverrideChange(item.itemId, capability)}
                    onEngineChange={(engine) => props.onCatalogEngineOverrideChange(item.itemId, engine)}
                    onInstallVariant={(filename) => props.onInstallCatalogVariant(item, filename)}
                  />
                ) : null}
              </div>
            ))}
          </div>
          {props.catalogItems.length > props.catalogDisplayCount ? (
            <div className="border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-4 py-3 text-center">
              <button
                type="button"
                onClick={props.onLoadMoreCatalog}
                className="rounded-lg border border-[var(--nimi-border-subtle)] px-4 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]"
              >
                {i18n.t('runtimeConfig.localModelCenter.loadMore', {
                  count: props.catalogItems.length - props.catalogDisplayCount,
                  defaultValue: 'Load More ({{count}} remaining)',
                })}
              </button>
            </div>
          ) : null}
          {props.catalogItems.length === 0 && props.verifiedModels.length === 0 && !props.loadingCatalog ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.noModelsMatchingSearch', { defaultValue: 'No models found matching your search' })}
              </p>
            </div>
          ) : null}
          {props.loadingCatalog ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.searching', { defaultValue: 'Searching...' })}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
