import type { RefObject } from 'react';
import type {
  NimiRuntimeLocalCatalogItemDescriptor,
  NimiRuntimeLocalCatalogVariantDescriptor,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { ScrollArea } from '@nimiplatform/kit/ui';
import type {
  AssetTaskEntry,
} from './runtime-config-local-model-center-helpers';
import { LocalModelCenterCatalogCard } from './runtime-config-local-model-center-catalog-card';
import { LocalModelCenterImportControls } from './runtime-config-local-model-center-import-controls';
import { LocalModelCenterInstalledAssetsSection } from './runtime-config-local-model-center-installed-section';
import {
  LocalModelCenterActiveDownloadsSection,
  LocalModelCenterActiveImportsSection,
  LocalModelCenterAssetTasksSection,
  LocalModelCenterQuickPicksSection,
  LocalModelCenterVerifiedAssetsSection,
} from './runtime-config-local-model-center-sections';
import type { CapabilityOption } from './runtime-config-model-center-utils';
import type { useLocalModelCenterDownloads } from './runtime-config-use-local-model-center-downloads';

type DownloadState = ReturnType<typeof useLocalModelCenterDownloads>;

type LocalModelCenterRuntimeViewProps = {
  assetBusy: boolean;
  assetPendingTemplateIds: string[];
  catalogCapability: 'all' | CapabilityOption;
  catalogDisplayCount: number;
  catalogItems: NimiRuntimeLocalCatalogItemDescriptor[];
  checkingHealth: boolean;
  deferredSearchQuery: string;
  refreshing: boolean;
  modelAssets: NimiRuntimeModelAssetRecord[];
  runtimeInventoryError: string;
  hasSearchQuery: boolean;
  importMenuRef: RefObject<HTMLDivElement | null>;
  installing: boolean;
  isAssetPending: (templateId: string) => boolean;
  loadingCatalog: boolean;
  loadingInstalledAssets: boolean;
  loadingVariants: boolean;
  loadingVerifiedAssets: boolean;
  loadingVerifiedModels: boolean;
  onCatalogCapabilityChange: (value: 'all' | CapabilityOption) => void;
  onCatalogCapabilityOverrideChange: (itemId: string, capability: CapabilityOption) => void;
  onImportFile: () => Promise<unknown>;
  onImportDirectory: () => Promise<unknown>;
  onCloseVariantPicker: () => void;
  onHealthCheck: () => void;
  onOpenModelsFolder: () => void;
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
  onCancelDownload: DownloadState['onCancelDownload'];
  onDismissSession: (installSessionId: string) => void;
  lastCheckedAt?: string | null;
};

export function LocalModelCenterRuntimeView(props: LocalModelCenterRuntimeViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="flex-1" contentClassName="mx-auto max-w-4xl space-y-8 p-6">
        {props.runtimeInventoryError ? (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-4 py-3 text-sm text-[var(--nimi-status-danger)]">
            {props.runtimeInventoryError}
          </div>
        ) : null}
        <LocalModelCenterImportControls
          checkingHealth={props.checkingHealth}
          lastCheckedAt={props.lastCheckedAt}
          refreshing={props.refreshing}
          importMenuRef={props.importMenuRef}
          showImportMenu={props.showImportMenu}
          onHealthCheck={props.onHealthCheck}
          onRefresh={props.onRefresh}
          onOpenModelsFolder={props.onOpenModelsFolder}
          onToggleImportMenu={props.onToggleImportMenu}
          onImportFile={props.onImportFile}
          onImportDirectory={props.onImportDirectory}
        />
        <LocalModelCenterActiveDownloadsSection
          downloads={props.downloads}
          onPause={props.onPauseDownload}
          onResume={props.onResumeDownload}
          onCancel={props.onCancelDownload}
          onDismiss={props.onDismissSession}
        />
        <LocalModelCenterActiveImportsSection
          imports={props.imports}
          onPause={props.onPauseDownload}
          onResume={props.onResumeDownload}
          onCancel={props.onCancelDownload}
          onDismiss={props.onDismissSession}
        />
        <LocalModelCenterAssetTasksSection
          tasks={props.visibleAssetTasks}
          pendingTemplateIds={props.assetPendingTemplateIds}
          onRetryTask={props.onInstallAsset}
        />
        {!props.hasSearchQuery ? (
          <LocalModelCenterQuickPicksSection
            loadingVerifiedModels={props.loadingVerifiedModels}
            installing={props.installing}
            verifiedModels={props.verifiedModels}
            onRefresh={props.onRefreshQuickPicks}
            onInstallCatalogQuickPick={props.onInstallCatalogQuickPick}
          />
        ) : null}
        <LocalModelCenterInstalledAssetsSection
          modelAssets={props.modelAssets}
          loadingInstalledAssets={props.loadingInstalledAssets}
          assetBusy={props.assetBusy}
          onRefreshAssets={props.onRefreshAssets}
          onInspectRemoval={props.onInspectRemoval}
          onRemoveAsset={props.onRemoveAsset}
        />
        <LocalModelCenterCatalogCard
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
          selectedCatalogCapability={props.selectedCatalogCapability}
          onSearchQueryChange={props.onSearchQueryChange}
          onCatalogCapabilityChange={props.onCatalogCapabilityChange}
          onInstallCatalogQuickPick={props.onInstallCatalogQuickPick}
          onToggleVariantPicker={props.onToggleVariantPicker}
          onCloseVariantPicker={props.onCloseVariantPicker}
          onCatalogCapabilityOverrideChange={props.onCatalogCapabilityOverrideChange}
          onInstallCatalogVariant={props.onInstallCatalogVariant}
          onLoadMoreCatalog={props.onLoadMoreCatalog}
          installing={props.installing}
        />
        <LocalModelCenterVerifiedAssetsSection
          hasSearchQuery={props.hasSearchQuery}
          loadingVerifiedAssets={props.loadingVerifiedAssets}
          assetBusy={props.assetBusy}
          visibleVerifiedAssets={props.visibleVerifiedAssets}
          isAssetPending={props.isAssetPending}
          onRefresh={props.onRefreshAssets}
          onInstallAsset={props.onInstallAsset}
        />
      </ScrollArea>
    </div>
  );
}
