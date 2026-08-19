import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useDesktopI18nResource } from '../../i18n/i18n-context';
import type {
  NimiRuntimeLocalCatalogItemDescriptor,
  NimiRuntimeLocalCatalogVariantDescriptor,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { PillTabs, ScrollArea } from '@nimiplatform/kit/ui';
import type {
  AssetTaskEntry,
} from './runtime-config-local-model-center-helpers';
import { LocalModelDiscoveryCard } from './runtime-config-local-model-center-discovery-card';
import { LocalModelCenterImportControls } from './runtime-config-local-model-center-import-controls';
import { RUNTIME_PAGE_WIDTH_CLASS, RuntimePageHeader } from './runtime-config-page-shell';
import { LocalModelCenterInstalledAssetsSection } from './runtime-config-local-model-center-installed-section';
import {
  LocalModelCenterInProgressSection,
  LocalModelCenterQuickPicksSection,
  LocalModelCenterVerifiedAssetsSection,
} from './runtime-config-local-model-center-sections';
import type { CapabilityOption } from './runtime-config-model-center-utils';
import type { useLocalModelCenterDownloads } from './runtime-config-use-local-model-center-downloads';

type DownloadState = ReturnType<typeof useLocalModelCenterDownloads>;

type LocalModelsSubTabId = 'myModels' | 'discover';

type LocalModelCenterRuntimeViewProps = {
  assetBusy: boolean;
  assetImportError: string;
  assetPendingTemplateIds: string[];
  catalogCapability: 'all' | CapabilityOption;
  catalogDisplayCount: number;
  catalogItems: NimiRuntimeLocalCatalogItemDescriptor[];
  deferredSearchQuery: string;
  refreshing: boolean;
  modelAssets: NimiRuntimeModelAssetRecord[];
  runtimeInventoryError: string;
  hasSearchQuery: boolean;
  importMenuRef: RefObject<HTMLDivElement | null>;
  installing: boolean;
  isAssetPending: (templateId: string) => boolean;
  isCatalogAssetInstalled: (assetId: string) => boolean;
  loadingCatalog: boolean;
  loadingInstalledAssets: boolean;
  loadingVariants: boolean;
  loadingVerifiedAssets: boolean;
  loadingVerifiedModels: boolean;
  openDiscoverRequest: boolean;
  showCatalogOverridesAction: boolean;
  onCatalogCapabilityChange: (value: 'all' | CapabilityOption) => void;
  onDismissImportError: () => void;
  onImportFile: () => Promise<unknown>;
  onImportDirectory: () => Promise<unknown>;
  onCloseVariantPicker: () => void;
  onOpenModelsFolder: () => void;
  onOpenDiscoverRequestConsumed: () => void;
  onOpenCatalogOverrides: () => void;
  onInstallAsset: (templateId: string) => void;
  onInstallCatalogVariant: (item: NimiRuntimeLocalCatalogItemDescriptor, variantFilename: string) => void;
  onInstallCatalogQuickPick: (templateId: string) => void;
  onLoadMoreCatalog: () => void;
  onPauseDownload: DownloadState['onPauseDownload'];
  onRefresh: () => void;
  onRefreshAssets: () => void;
  onRefreshQuickPicks: () => void;
  onInspectRemoval: (localAssetId: string) => Promise<string[]>;
  onRemoveAsset: (localAssetId: string) => Promise<void>;
  onResumeDownload: DownloadState['onResumeDownload'];
  onSearchQueryChange: (value: string) => void;
  onToggleImportMenu: () => void;
  onToggleVariantPicker: (item: NimiRuntimeLocalCatalogItemDescriptor) => void;
  runtimeWritesDisabled: boolean;
  searchQuery: string;
  selectedCatalogCapability: (item: NimiRuntimeLocalCatalogItemDescriptor) => CapabilityOption;
  showImportMenu: boolean;
  variantError: string;
  variantList: NimiRuntimeLocalCatalogVariantDescriptor[];
  variantPickerItem: NimiRuntimeLocalCatalogItemDescriptor | null;
  verifiedModels: NimiRuntimeLocalVerifiedAssetDescriptor[];
  visibleAssetTasks: AssetTaskEntry[];
  visibleVerifiedAssets: NimiRuntimeLocalVerifiedAssetDescriptor[];
  downloads: DownloadState['activeDownloads'];
  imports: DownloadState['activeImports'];
  terminalDownloads: DownloadState['terminalDownloads'];
  terminalImports: DownloadState['terminalImports'];
  onCancelDownload: DownloadState['onCancelDownload'];
  onDismissSession: (installSessionId: string) => void;
  onDismissAssetTask: (templateId: string) => void;
};

export function LocalModelCenterRuntimeView(props: LocalModelCenterRuntimeViewProps) {
  const i18n = useDesktopI18nResource().instance;
  // First-use guidance: with an empty installed inventory, land on Discover.
  // Lazily initialized once; no persistence, no auto-switching afterwards.
  const [subTab, setSubTab] = useState<LocalModelsSubTabId>(() => (
    props.modelAssets.length === 0 ? 'discover' : 'myModels'
  ));
  const catalogSearchInputRef = useRef<HTMLInputElement>(null);
  const focusDiscoverAfterRenderRef = useRef(false);

  useEffect(() => {
    if (!props.openDiscoverRequest) return;
    focusDiscoverAfterRenderRef.current = true;
    setSubTab('discover');
    props.onOpenDiscoverRequestConsumed();
  }, [props.openDiscoverRequest, props.onOpenDiscoverRequestConsumed]);

  useEffect(() => {
    if (subTab !== 'discover' || !focusDiscoverAfterRenderRef.current) return;
    focusDiscoverAfterRenderRef.current = false;
    catalogSearchInputRef.current?.focus();
  }, [subTab]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="flex-1" contentClassName={`mx-auto ${RUNTIME_PAGE_WIDTH_CLASS} space-y-4 px-4 pb-4`}>
        <RuntimePageHeader
          title={i18n.t('runtimeConfig.sidebar.localModels')}
          actions={(
            <LocalModelCenterImportControls
              refreshing={props.refreshing}
              importMenuRef={props.importMenuRef}
              showImportMenu={props.showImportMenu}
              runtimeWritesDisabled={props.runtimeWritesDisabled}
              onRefresh={props.onRefresh}
              onOpenModelsFolder={props.onOpenModelsFolder}
              showCatalogOverridesAction={props.showCatalogOverridesAction}
              onOpenCatalogOverrides={props.onOpenCatalogOverrides}
              onToggleImportMenu={props.onToggleImportMenu}
              onImportFile={props.onImportFile}
              onImportDirectory={props.onImportDirectory}
            />
          )}
        />
        {props.runtimeInventoryError ? (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-4 py-3 text-sm text-[var(--nimi-status-danger)]">
            {props.runtimeInventoryError}
          </div>
        ) : null}
        {props.assetImportError ? (
          <div className="flex items-start justify-between gap-2 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-4 py-3 text-sm text-[var(--nimi-status-danger)]">
            <span>{props.assetImportError}</span>
            <button
              type="button"
              aria-label={i18n.t('runtimeConfig.localModelCenter.dismissImportError', { defaultValue: 'Dismiss import error' })}
              className="rounded-md px-1.5 py-0.5 text-xs text-[var(--nimi-status-danger)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)]"
              onClick={props.onDismissImportError}
            >
              {'\u00d7'}
            </button>
          </div>
        ) : null}
        <LocalModelCenterInProgressSection
          downloads={props.downloads}
          imports={props.imports}
          terminalDownloads={props.terminalDownloads}
          terminalImports={props.terminalImports}
          tasks={props.visibleAssetTasks}
          pendingTemplateIds={props.assetPendingTemplateIds}
          isAssetInstalled={props.isCatalogAssetInstalled}
          runtimeWritesDisabled={props.runtimeWritesDisabled}
          onPause={props.onPauseDownload}
          onResume={props.onResumeDownload}
          onCancel={props.onCancelDownload}
          onDismiss={props.onDismissSession}
          onRetryTask={props.onInstallAsset}
          onDismissTask={props.onDismissAssetTask}
        />
        <div data-testid="runtime-local-models-subtabs">
          <PillTabs
            size="sm"
            ariaLabel={i18n.t('runtimeConfig.localModelCenter.subtabsLabel', { defaultValue: 'Local model sections' })}
            items={[
              {
                value: 'myModels',
                label: i18n.t('runtimeConfig.localModelCenter.myModels', { defaultValue: 'My Models' }),
              },
              {
                value: 'discover',
                label: i18n.t('runtimeConfig.localModelCenter.discoverModels', { defaultValue: 'Discover' }),
              },
            ]}
            value={subTab}
            onValueChange={(value) => setSubTab(value as LocalModelsSubTabId)}
          />
        </div>
        {subTab === 'myModels' ? (
          <LocalModelCenterInstalledAssetsSection
            modelAssets={props.modelAssets}
            loadingInstalledAssets={props.loadingInstalledAssets}
            assetBusy={props.assetBusy}
            runtimeWritesDisabled={props.runtimeWritesDisabled}
            onRefreshAssets={props.onRefreshAssets}
            onInspectRemoval={props.onInspectRemoval}
            onRemoveAsset={props.onRemoveAsset}
          />
        ) : (
          <>
            {!props.hasSearchQuery ? (
              <LocalModelCenterQuickPicksSection
                loadingVerifiedModels={props.loadingVerifiedModels}
                installing={props.installing}
                runtimeWritesDisabled={props.runtimeWritesDisabled}
                isModelInstalled={props.isCatalogAssetInstalled}
                verifiedModels={props.verifiedModels}
                onRefresh={props.onRefreshQuickPicks}
                onInstallCatalogQuickPick={props.onInstallCatalogQuickPick}
              />
            ) : null}
            <LocalModelDiscoveryCard
              searchInputRef={catalogSearchInputRef}
              searchQuery={props.searchQuery}
              catalogCapability={props.catalogCapability}
              loadingCatalog={props.loadingCatalog}
              hasSearchQuery={props.hasSearchQuery}
              verifiedModels={props.verifiedModels}
              catalogItems={props.catalogItems}
              catalogDisplayCount={props.catalogDisplayCount}
              variantPickerItem={props.variantPickerItem}
              variantList={props.variantList}
              variantError={props.variantError}
              loadingVariants={props.loadingVariants}
              isCatalogAssetInstalled={props.isCatalogAssetInstalled}
              selectedCatalogCapability={props.selectedCatalogCapability}
              onSearchQueryChange={props.onSearchQueryChange}
              onCatalogCapabilityChange={props.onCatalogCapabilityChange}
              onInstallCatalogQuickPick={props.onInstallCatalogQuickPick}
              onToggleVariantPicker={props.onToggleVariantPicker}
              onCloseVariantPicker={props.onCloseVariantPicker}
              onInstallCatalogVariant={props.onInstallCatalogVariant}
              onLoadMoreCatalog={props.onLoadMoreCatalog}
              installing={props.installing}
              runtimeWritesDisabled={props.runtimeWritesDisabled}
            />
            <LocalModelCenterVerifiedAssetsSection
              hasSearchQuery={props.hasSearchQuery}
              loadingVerifiedAssets={props.loadingVerifiedAssets}
              assetBusy={props.assetBusy}
              runtimeWritesDisabled={props.runtimeWritesDisabled}
              visibleVerifiedAssets={props.visibleVerifiedAssets}
              isAssetPending={props.isAssetPending}
              onRefresh={props.onRefreshAssets}
              onInstallAsset={props.onInstallAsset}
            />
          </>
        )}
      </ScrollArea>
    </div>
  );
}
