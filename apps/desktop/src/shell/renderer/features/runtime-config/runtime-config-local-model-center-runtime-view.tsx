import type { RefObject } from 'react';
import type {
  LocalRuntimeAssetDeclaration,
  LocalRuntimeAssetKind,
  LocalRuntimeAssetRecord,
  LocalRuntimeCatalogItemDescriptor,
  GgufVariantDescriptor,
  LocalRuntimeUnregisteredAssetDescriptor,
  LocalRuntimeVerifiedAssetDescriptor,
} from '@runtime/local-runtime';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import type {
  AssetTaskEntry,
} from './runtime-config-local-model-center-helpers';
import { LocalModelCenterCatalogCard } from './runtime-config-local-model-center-catalog-card';
import { LocalModelCenterImportControls } from './runtime-config-local-model-center-import-controls';
import {
  LocalModelCenterActiveDownloadsSection,
  LocalModelCenterActiveImportsSection,
  LocalModelCenterAssetTasksSection,
  LocalModelCenterQuickPicksSection,
  LocalModelCenterUnregisteredAssetsSection,
  LocalModelCenterVerifiedAssetsSection,
} from './runtime-config-local-model-center-sections';
import type {
  AssetEngineOption,
  CapabilityOption,
  InstallEngineOption,
} from './runtime-config-model-center-utils';
import type { useLocalModelCenterDownloads } from './runtime-config-use-local-model-center-downloads';

type DownloadState = ReturnType<typeof useLocalModelCenterDownloads>;

type LocalModelCenterRuntimeViewProps = {
  assetBusy: boolean;
  assetKindFilter: 'all' | LocalRuntimeAssetKind;
  assetPendingTemplateIds: string[];
  catalogCapability: 'all' | CapabilityOption;
  catalogDisplayCount: number;
  catalogItems: LocalRuntimeCatalogItemDescriptor[];
  checkingHealth: boolean;
  deferredSearchQuery: string;
  discovering: boolean;
  filteredInstalledDependencyAssets: LocalRuntimeAssetRecord[];
  filteredInstalledRunnableAssets: LocalRuntimeAssetRecord[];
  hasSearchQuery: boolean;
  importFileAssetKind: LocalRuntimeAssetKind;
  importFileAuxiliaryEngine: AssetEngineOption | '';
  importFileEndpoint: string;
  importEndpointRequired: boolean;
  importCompatibilityHint?: string;
  importEndpointHint?: string;
  importMenuRef: RefObject<HTMLDivElement | null>;
  importingAssetPath: string | null;
  installing: boolean;
  installedAssetsById: Map<string, LocalRuntimeAssetRecord>;
  isAssetPending: (templateId: string) => boolean;
  loadingCatalog: boolean;
  loadingInstalledAssets: boolean;
  loadingVariants: boolean;
  loadingVerifiedAssets: boolean;
  loadingVerifiedModels: boolean;
  localHealthy: boolean;
  assetImportError: string;
  assetImportSessionByPath: Record<string, string>;
  unregisteredCompatibilityHintByPath: Record<string, string>;
  unregisteredImportAllowedByPath: Record<string, boolean>;
  unregisteredEndpointByPath: Record<string, string>;
  unregisteredEndpointRequiredByPath: Record<string, boolean>;
  unregisteredEndpointHintByPath: Record<string, string>;
  onArtifactKindFilterChange: (value: 'all' | LocalRuntimeAssetKind) => void;
  onAssetKindChange: (kind: LocalRuntimeAssetKind) => void;
  onAssetAuxiliaryEngineChange: (engine: AssetEngineOption | '') => void;
  onImportEndpointChange: (endpoint: string) => void;
  onCatalogCapabilityChange: (value: 'all' | CapabilityOption) => void;
  onCatalogCapabilityOverrideChange: (itemId: string, capability: CapabilityOption) => void;
  onCatalogEngineOverrideChange: (itemId: string, engine: InstallEngineOption) => void;
  onChooseImportFile: () => void;
  onCloseImportFileDialog: () => void;
  onCloseVariantPicker: () => void;
  onHealthCheck: () => void;
  onOpenModelsFolder: () => void;
  onImportManifest: () => void;
  onInstallAsset: (templateId: string) => void;
  onInstallCatalogVariant: (item: LocalRuntimeCatalogItemDescriptor, variantFilename: string) => void;
  onInstallMissingAssets: (assets: LocalRuntimeVerifiedAssetDescriptor[]) => void;
  onInstallVerifiedModel: (templateId: string) => void;
  onLoadMoreCatalog: () => void;
  onOpenImportFile: () => void;
  onPauseDownload: DownloadState['onPauseDownload'];
  onRefresh: () => void;
  onRefreshAssets: () => void;
  onRefreshQuickPicks: () => void;
  onRefreshUnregisteredAssets: () => void;
  onRemoveAsset: (localAssetId: string) => void;
  onRepairAsset: (localAssetId: string, endpoint: string) => void;
  onResumeDownload: DownloadState['onResumeDownload'];
  onSearchQueryChange: (value: string) => void;
  onToggleImportMenu: () => void;
  onToggleVariantPicker: (item: LocalRuntimeCatalogItemDescriptor) => void;
  onImportUnregisteredAsset: (path: string) => void;
  onUnregisteredAssetKindChange: (path: string, kind: LocalRuntimeAssetKind) => void;
  onUnregisteredAuxiliaryEngineChange: (path: string, engine: AssetEngineOption | '') => void;
  onUnregisteredEndpointChange: (path: string, endpoint: string) => void;
  relatedAssetsByModelTemplate: Map<string, LocalRuntimeVerifiedAssetDescriptor[]>;
  resolveUnregisteredAssetDraft: (asset: LocalRuntimeUnregisteredAssetDescriptor) => LocalRuntimeAssetDeclaration;
  searchQuery: string;
  selectedCatalogCapability: (item: LocalRuntimeCatalogItemDescriptor) => CapabilityOption;
  selectedCatalogEngine: (item: LocalRuntimeCatalogItemDescriptor) => InstallEngineOption;
  showImportFileDialog: boolean;
  showImportMenu: boolean;
  canChooseImportFile: boolean;
  variantError: string;
  variantList: GgufVariantDescriptor[];
  variantPickerItem: LocalRuntimeCatalogItemDescriptor | null;
  verifiedModels: LocalRuntimeVerifiedAssetDescriptor[];
  visibleAssetTasks: AssetTaskEntry[];
  visibleVerifiedAssets: LocalRuntimeVerifiedAssetDescriptor[];
  downloads: DownloadState['activeDownloads'];
  imports: DownloadState['activeImports'];
  unregisteredAssets: LocalRuntimeUnregisteredAssetDescriptor[];
  onCancelDownload: DownloadState['onCancelDownload'];
  onDismissSession: (installSessionId: string) => void;
  lastCheckedAt?: string | null;
};

export function LocalModelCenterRuntimeView(props: LocalModelCenterRuntimeViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <ScrollArea className="flex-1" contentClassName="mx-auto max-w-4xl space-y-8 p-6">
        <LocalModelCenterImportControls
          checkingHealth={props.checkingHealth}
          localHealthy={props.localHealthy}
          lastCheckedAt={props.lastCheckedAt}
          discovering={props.discovering}
          importMenuRef={props.importMenuRef}
          showImportMenu={props.showImportMenu}
          showImportFileDialog={props.showImportFileDialog}
          importFileAssetKind={props.importFileAssetKind}
          importFileAuxiliaryEngine={props.importFileAuxiliaryEngine}
          importFileEndpoint={props.importFileEndpoint}
          importEndpointRequired={props.importEndpointRequired}
          importCompatibilityHint={props.importCompatibilityHint}
          importEndpointHint={props.importEndpointHint}
          onHealthCheck={props.onHealthCheck}
          onRefresh={props.onRefresh}
          onOpenModelsFolder={props.onOpenModelsFolder}
          onToggleImportMenu={props.onToggleImportMenu}
          onOpenImportFile={props.onOpenImportFile}
          onImportManifest={props.onImportManifest}
          onAssetKindChange={props.onAssetKindChange}
          onAuxiliaryEngineChange={props.onAssetAuxiliaryEngineChange}
          onEndpointChange={props.onImportEndpointChange}
          onCloseImportFileDialog={props.onCloseImportFileDialog}
          onChooseImportFile={props.onChooseImportFile}
          canChooseImportFile={props.canChooseImportFile}
        />
        <LocalModelCenterUnregisteredAssetsSection
          assets={props.unregisteredAssets}
          assetImportError={props.assetImportError}
          assetImportSessionByPath={props.assetImportSessionByPath}
          compatibilityHintByPath={props.unregisteredCompatibilityHintByPath}
          importAllowedByPath={props.unregisteredImportAllowedByPath}
          importingAssetPath={props.importingAssetPath}
          resolveDraft={props.resolveUnregisteredAssetDraft}
          endpointByPath={props.unregisteredEndpointByPath}
          endpointRequiredByPath={props.unregisteredEndpointRequiredByPath}
          endpointHintByPath={props.unregisteredEndpointHintByPath}
          onRefresh={props.onRefreshUnregisteredAssets}
          onAssetKindChange={props.onUnregisteredAssetKindChange}
          onAuxiliaryEngineChange={props.onUnregisteredAuxiliaryEngineChange}
          onEndpointChange={props.onUnregisteredEndpointChange}
          onImport={props.onImportUnregisteredAsset}
        />
        <LocalModelCenterCatalogCard
          searchQuery={props.searchQuery}
          catalogCapability={props.catalogCapability}
          filteredInstalledRunnableAssets={props.filteredInstalledRunnableAssets}
          filteredInstalledDependencyAssets={props.filteredInstalledDependencyAssets}
          loadingCatalog={props.loadingCatalog}
          loadingInstalledAssets={props.loadingInstalledAssets}
          loadingVerifiedAssets={props.loadingVerifiedAssets}
          assetKindFilter={props.assetKindFilter}
          assetBusy={props.assetBusy}
          hasSearchQuery={props.hasSearchQuery}
          verifiedModels={props.verifiedModels}
          catalogItems={props.catalogItems}
          catalogDisplayCount={props.catalogDisplayCount}
          relatedAssetsByModelTemplate={props.relatedAssetsByModelTemplate}
          installedAssetsById={props.installedAssetsById}
          variantPickerItem={props.variantPickerItem}
          variantList={props.variantList}
          variantError={props.variantError}
          loadingVariants={props.loadingVariants}
          selectedCatalogCapability={props.selectedCatalogCapability}
          selectedCatalogEngine={props.selectedCatalogEngine}
          isAssetPending={props.isAssetPending}
          onSearchQueryChange={props.onSearchQueryChange}
          onCatalogCapabilityChange={props.onCatalogCapabilityChange}
          onArtifactKindFilterChange={props.onArtifactKindFilterChange}
          onRefreshAssets={props.onRefreshAssets}
          onRemoveAsset={props.onRemoveAsset}
          onRepairAsset={props.onRepairAsset}
          onInstallMissingAssets={props.onInstallMissingAssets}
          onInstallVerifiedModel={props.onInstallVerifiedModel}
          onInstallAsset={props.onInstallAsset}
          onToggleVariantPicker={props.onToggleVariantPicker}
          onCloseVariantPicker={props.onCloseVariantPicker}
          onCatalogCapabilityOverrideChange={props.onCatalogCapabilityOverrideChange}
          onCatalogEngineOverrideChange={props.onCatalogEngineOverrideChange}
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
        <LocalModelCenterActiveDownloadsSection
          downloads={props.downloads}
          onPause={props.onPauseDownload}
          onResume={props.onResumeDownload}
          onCancel={props.onCancelDownload}
        />
        <LocalModelCenterActiveImportsSection imports={props.imports} onDismiss={props.onDismissSession} />
        <LocalModelCenterAssetTasksSection
          tasks={props.visibleAssetTasks}
          pendingTemplateIds={props.assetPendingTemplateIds}
          onRetryTask={props.onInstallAsset}
        />
        {!props.hasSearchQuery ? (
          <LocalModelCenterQuickPicksSection
            loadingVerifiedModels={props.loadingVerifiedModels}
            installing={props.installing}
            assetBusy={props.assetBusy}
            verifiedModels={props.verifiedModels}
            relatedAssetsByModelTemplate={props.relatedAssetsByModelTemplate}
            installedAssetsById={props.installedAssetsById}
            isAssetPending={props.isAssetPending}
            onRefresh={props.onRefreshQuickPicks}
            onInstallVerifiedModel={props.onInstallVerifiedModel}
            onInstallAsset={props.onInstallAsset}
            onInstallMissingAssets={props.onInstallMissingAssets}
          />
        ) : null}
      </ScrollArea>
    </div>
  );
}
