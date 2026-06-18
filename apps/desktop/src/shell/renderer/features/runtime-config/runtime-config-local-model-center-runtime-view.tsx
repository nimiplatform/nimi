import type { RefObject } from 'react';
import type {
  NimiRuntimeLocalAssetDeclaration,
  NimiRuntimeLocalAssetKind,
  NimiRuntimeLocalAssetRecord,
  NimiRuntimeLocalCatalogItemDescriptor,
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlanDependency,
  NimiRuntimeLocalCatalogVariantDescriptor,
  NimiRuntimeLocalUnregisteredAssetDescriptor,
  NimiRuntimeLocalVerifiedAssetDescriptor,
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
  LocalModelCenterUnregisteredAssetsSection,
  LocalModelCenterVerifiedAssetsSection,
} from './runtime-config-local-model-center-sections';
import type {
  AssetEngineOption,
  CapabilityOption,
} from './runtime-config-model-center-utils';
import type { useLocalModelCenterDownloads } from './runtime-config-use-local-model-center-downloads';

type DownloadState = ReturnType<typeof useLocalModelCenterDownloads>;

type LocalModelCenterRuntimeViewProps = {
  assetBusy: boolean;
  assetKindFilter: 'all' | NimiRuntimeLocalAssetKind;
  assetPendingTemplateIds: string[];
  catalogCapability: 'all' | CapabilityOption;
  catalogDisplayCount: number;
  catalogItems: NimiRuntimeLocalCatalogItemDescriptor[];
  checkingHealth: boolean;
  deferredSearchQuery: string;
  discovering: boolean;
  filteredInstalledDependencyAssets: NimiRuntimeLocalAssetRecord[];
  filteredInstalledRunnableAssets: NimiRuntimeLocalAssetRecord[];
  sharedRuntimeDependency?: NimiRuntimeLocalEnvironmentPlanDependency;
  sharedRuntimeDependencyJobs: NimiRuntimeLocalEnvironmentDependencyJob[];
  runtimeDependencyByLocalAssetId: Record<string, NimiRuntimeLocalEnvironmentPlanDependency | undefined>;
  runtimeDependencyError: string;
  runtimeInventoryError: string;
  hasSearchQuery: boolean;
  importFileAssetKind: NimiRuntimeLocalAssetKind;
  importFileAuxiliaryEngine: AssetEngineOption | '';
  importFileEndpoint: string;
  importEndpointRequired: boolean;
  importCompatibilityHint?: string;
  importEndpointHint?: string;
  importMenuRef: RefObject<HTMLDivElement | null>;
  importingAssetPath: string | null;
  installing: boolean;
  installedAssetsById: Map<string, NimiRuntimeLocalAssetRecord>;
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
  onArtifactKindFilterChange: (value: 'all' | NimiRuntimeLocalAssetKind) => void;
  onAssetKindChange: (kind: NimiRuntimeLocalAssetKind) => void;
  onAssetAuxiliaryEngineChange: (engine: AssetEngineOption | '') => void;
  onImportEndpointChange: (endpoint: string) => void;
  onCatalogCapabilityChange: (value: 'all' | CapabilityOption) => void;
  onCatalogCapabilityOverrideChange: (itemId: string, capability: CapabilityOption) => void;
  onChooseImportFile: () => void;
  onChooseImportDirectory: () => void;
  onCloseImportFileDialog: () => void;
  onCloseVariantPicker: () => void;
  onHealthCheck: () => void;
  onOpenModelsFolder: () => void;
  onImportManifest: () => void;
  onInstallAsset: (templateId: string) => void;
  onInstallCatalogVariant: (item: NimiRuntimeLocalCatalogItemDescriptor, variantFilename: string) => void;
  onInstallMissingAssets: (assets: NimiRuntimeLocalVerifiedAssetDescriptor[]) => void;
  onInstallVerifiedModel: (templateId: string) => void;
  onLoadMoreCatalog: () => void;
  onOpenImportFile: () => void;
  onOpenImportBundle: () => void;
  onPauseDownload: DownloadState['onPauseDownload'];
  onRefresh: () => void;
  onRefreshAssets: () => void;
  onRefreshQuickPicks: () => void;
  onRefreshUnregisteredAssets: () => void;
  onRemoveAsset: (localAssetId: string) => void;
  onRepairAsset: (localAssetId: string, endpoint: string) => void;
  onSetupRuntimeDependency: () => void;
  onCancelRuntimeDependencyJob: (jobId: string) => void;
  onRetryRuntimeDependencyJob: (jobId: string) => void;
  onRepairRuntimeDependency: () => void;
  onRescanAsset: (localAssetId: string) => void;
  onResumeDownload: DownloadState['onResumeDownload'];
  onSearchQueryChange: (value: string) => void;
  onToggleImportMenu: () => void;
  onToggleVariantPicker: (item: NimiRuntimeLocalCatalogItemDescriptor) => void;
  onImportUnregisteredAsset: (path: string) => void;
  onUnregisteredAssetKindChange: (path: string, kind: NimiRuntimeLocalAssetKind) => void;
  onUnregisteredAuxiliaryEngineChange: (path: string, engine: AssetEngineOption | '') => void;
  onUnregisteredEndpointChange: (path: string, endpoint: string) => void;
  relatedAssetsByModelTemplate: Map<string, NimiRuntimeLocalVerifiedAssetDescriptor[]>;
  resolveUnregisteredAssetDraft: (asset: NimiRuntimeLocalUnregisteredAssetDescriptor) => NimiRuntimeLocalAssetDeclaration;
  searchQuery: string;
  selectedCatalogCapability: (item: NimiRuntimeLocalCatalogItemDescriptor) => CapabilityOption;
  showImportFileDialog: boolean;
  showImportMenu: boolean;
  canChooseImportFile: boolean;
  canChooseImportDirectory: boolean;
  variantError: string;
  variantList: NimiRuntimeLocalCatalogVariantDescriptor[];
  variantPickerItem: NimiRuntimeLocalCatalogItemDescriptor | null;
  verifiedModels: NimiRuntimeLocalVerifiedAssetDescriptor[];
  visibleAssetTasks: AssetTaskEntry[];
  visibleVerifiedAssets: NimiRuntimeLocalVerifiedAssetDescriptor[];
  downloads: DownloadState['activeDownloads'];
  imports: DownloadState['activeImports'];
  unregisteredAssets: NimiRuntimeLocalUnregisteredAssetDescriptor[];
  onCancelDownload: DownloadState['onCancelDownload'];
  onDismissSession: (installSessionId: string) => void;
  lastCheckedAt?: string | null;
};

export function LocalModelCenterRuntimeView(props: LocalModelCenterRuntimeViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="flex-1" contentClassName="mx-auto max-w-4xl space-y-8 p-6">
        {props.runtimeInventoryError || props.runtimeDependencyError ? (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-4 py-3 text-sm text-[var(--nimi-status-danger)]">
            {props.runtimeInventoryError || props.runtimeDependencyError}
          </div>
        ) : null}
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
          onOpenImportBundle={props.onOpenImportBundle}
          onImportManifest={props.onImportManifest}
          onAssetKindChange={props.onAssetKindChange}
          onAuxiliaryEngineChange={props.onAssetAuxiliaryEngineChange}
          onEndpointChange={props.onImportEndpointChange}
          onCloseImportFileDialog={props.onCloseImportFileDialog}
          onChooseImportFile={props.onChooseImportFile}
          onChooseImportDirectory={props.onChooseImportDirectory}
          canChooseImportFile={props.canChooseImportFile}
          canChooseImportDirectory={props.canChooseImportDirectory}
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
      <LocalModelCenterInstalledAssetsSection
        filteredInstalledRunnableAssets={props.filteredInstalledRunnableAssets}
        filteredInstalledDependencyAssets={props.filteredInstalledDependencyAssets}
        sharedRuntimeDependency={props.sharedRuntimeDependency}
        sharedRuntimeDependencyJobs={props.sharedRuntimeDependencyJobs}
        runtimeDependencyByLocalAssetId={props.runtimeDependencyByLocalAssetId}
          loadingInstalledAssets={props.loadingInstalledAssets}
          loadingVerifiedAssets={props.loadingVerifiedAssets}
          assetKindFilter={props.assetKindFilter}
          assetBusy={props.assetBusy}
          onArtifactKindFilterChange={props.onArtifactKindFilterChange}
          onRefreshAssets={props.onRefreshAssets}
          onRemoveAsset={props.onRemoveAsset}
          onRepairAsset={props.onRepairAsset}
          onSetupRuntimeDependency={props.onSetupRuntimeDependency}
          onCancelRuntimeDependencyJob={props.onCancelRuntimeDependencyJob}
          onRetryRuntimeDependencyJob={props.onRetryRuntimeDependencyJob}
          onRepairRuntimeDependency={props.onRepairRuntimeDependency}
          onRescanAsset={props.onRescanAsset}
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
        <LocalModelCenterCatalogCard
          searchQuery={props.searchQuery}
          catalogCapability={props.catalogCapability}
          loadingCatalog={props.loadingCatalog}
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
          isAssetPending={props.isAssetPending}
          onSearchQueryChange={props.onSearchQueryChange}
          onCatalogCapabilityChange={props.onCatalogCapabilityChange}
          onInstallMissingAssets={props.onInstallMissingAssets}
          onInstallVerifiedModel={props.onInstallVerifiedModel}
          onInstallAsset={props.onInstallAsset}
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
