import type { RefObject } from 'react';
import type {
  LocalRuntimeAssetDeclaration,
  LocalRuntimeArtifactKind,
  LocalRuntimeArtifactRecord,
  LocalRuntimeCatalogItemDescriptor,
  GgufVariantDescriptor,
  LocalRuntimeUnregisteredAssetDescriptor,
  LocalRuntimeVerifiedArtifactDescriptor,
  LocalRuntimeVerifiedModelDescriptor,
  OrphanArtifactFile,
  OrphanModelFile,
} from '@runtime/local-runtime';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import type {
  ArtifactTaskEntry,
} from './runtime-config-local-model-center-helpers';
import { LocalModelCenterCatalogCard } from './runtime-config-local-model-center-catalog-card';
import { LocalModelCenterImportControls } from './runtime-config-local-model-center-import-controls';
import {
  LocalModelCenterActiveDownloadsSection,
  LocalModelCenterActiveImportsSection,
  LocalModelCenterArtifactTasksSection,
  LocalModelCenterQuickPicksSection,
  LocalModelCenterUnregisteredAssetsSection,
  LocalModelCenterVerifiedArtifactsSection,
} from './runtime-config-local-model-center-sections';
import type {
  AssetClassOption,
  AssetEngineOption,
  CapabilityOption,
  InstallEngineOption,
  ModelTypeOption,
} from './runtime-config-model-center-utils';
import type { LocalModelOptionV11 } from './runtime-config-state-types';
import type { useLocalModelCenterDownloads } from './runtime-config-use-local-model-center-downloads';

type DownloadState = ReturnType<typeof useLocalModelCenterDownloads>;

type LocalModelCenterRuntimeViewProps = {
  artifactBusy: boolean;
  artifactKindFilter: 'all' | LocalRuntimeArtifactKind;
  artifactOrphanError: string;
  artifactOrphanFiles: OrphanArtifactFile[];
  artifactOrphanKinds: Record<string, LocalRuntimeArtifactKind>;
  artifactPendingTemplateIds: string[];
  catalogCapability: 'all' | CapabilityOption;
  catalogDisplayCount: number;
  catalogItems: LocalRuntimeCatalogItemDescriptor[];
  checkingHealth: boolean;
  deferredSearchQuery: string;
  discovering: boolean;
  filteredInstalledArtifacts: LocalRuntimeArtifactRecord[];
  filteredInstalledModels: LocalModelOptionV11[];
  hasSearchQuery: boolean;
  importFileAssetClass: AssetClassOption;
  importFileModelType: ModelTypeOption;
  importFileArtifactKind: LocalRuntimeArtifactKind;
  importFileAuxiliaryEngine: AssetEngineOption | '';
  importMenuRef: RefObject<HTMLDivElement | null>;
  importingAssetPath: string | null;
  installing: boolean;
  installedArtifactsById: Map<string, LocalRuntimeArtifactRecord>;
  isArtifactPending: (templateId: string) => boolean;
  loadingCatalog: boolean;
  loadingInstalledArtifacts: boolean;
  loadingVariants: boolean;
  loadingVerifiedArtifacts: boolean;
  loadingVerifiedModels: boolean;
  localHealthy: boolean;
  assetImportError: string;
  assetImportSessionByPath: Record<string, string>;
  onArtifactKindFilterChange: (value: 'all' | LocalRuntimeArtifactKind) => void;
  onArtifactOrphanKindChange: (path: string, kind: LocalRuntimeArtifactKind) => void;
  onAssetClassChange: (assetClass: AssetClassOption) => void;
  onAssetModelTypeChange: (modelType: ModelTypeOption) => void;
  onAssetArtifactKindChange: (kind: LocalRuntimeArtifactKind) => void;
  onAssetAuxiliaryEngineChange: (engine: AssetEngineOption | '') => void;
  onCatalogCapabilityChange: (value: 'all' | CapabilityOption) => void;
  onCatalogCapabilityOverrideChange: (itemId: string, capability: CapabilityOption) => void;
  onCatalogEngineOverrideChange: (itemId: string, engine: InstallEngineOption) => void;
  onChooseImportFile: () => void;
  onCloseImportFileDialog: () => void;
  onCloseVariantPicker: () => void;
  onHealthCheck: () => void;
  onOpenModelsFolder: () => void;
  onImportManifest: () => void;
  onInstallArtifact: (templateId: string) => void;
  onInstallCatalogVariant: (item: LocalRuntimeCatalogItemDescriptor, variantFilename: string) => void;
  onInstallMissingArtifacts: (artifacts: LocalRuntimeVerifiedArtifactDescriptor[]) => void;
  onInstallVerifiedModel: (templateId: string) => void;
  onLoadMoreCatalog: () => void;
  onOpenImportFile: () => void;
  onOrphanCapabilityChange: (path: string, capability: CapabilityOption) => void;
  onPauseDownload: DownloadState['onPauseDownload'];
  onRefresh: () => void;
  onRefreshArtifacts: () => void;
  onRefreshQuickPicks: () => void;
  onRefreshUnregisteredAssets: () => void;
  onRemoveArtifact: (localArtifactId: string) => void;
  onRemoveModel: (localModelId: string) => void;
  onResumeDownload: DownloadState['onResumeDownload'];
  onScaffoldArtifactOrphan: (path: string) => void;
  onScaffoldOrphan: (path: string) => void;
  onSearchQueryChange: (value: string) => void;
  onToggleImportMenu: () => void;
  onToggleVariantPicker: (item: LocalRuntimeCatalogItemDescriptor) => void;
  onImportUnregisteredAsset: (path: string) => void;
  onUnregisteredAssetClassChange: (path: string, assetClass: AssetClassOption) => void;
  onUnregisteredModelTypeChange: (path: string, modelType: ModelTypeOption) => void;
  onUnregisteredArtifactKindChange: (path: string, kind: LocalRuntimeArtifactKind) => void;
  onUnregisteredAuxiliaryEngineChange: (path: string, engine: AssetEngineOption | '') => void;
  orphanCapabilities: Record<string, CapabilityOption>;
  orphanError: string;
  orphanFiles: OrphanModelFile[];
  orphanImportSessionByPath: Record<string, string>;
  relatedArtifactsByModelTemplate: Map<string, LocalRuntimeVerifiedArtifactDescriptor[]>;
  resolveUnregisteredAssetDraft: (asset: LocalRuntimeUnregisteredAssetDescriptor) => LocalRuntimeAssetDeclaration;
  scaffoldingArtifactOrphan: string | null;
  scaffoldingOrphan: string | null;
  searchQuery: string;
  selectedCatalogCapability: (item: LocalRuntimeCatalogItemDescriptor) => CapabilityOption;
  selectedCatalogEngine: (item: LocalRuntimeCatalogItemDescriptor) => InstallEngineOption;
  showImportFileDialog: boolean;
  showImportMenu: boolean;
  canChooseImportFile: boolean;
  variantError: string;
  variantList: GgufVariantDescriptor[];
  variantPickerItem: LocalRuntimeCatalogItemDescriptor | null;
  verifiedModels: LocalRuntimeVerifiedModelDescriptor[];
  visibleArtifactTasks: ArtifactTaskEntry[];
  visibleVerifiedArtifacts: LocalRuntimeVerifiedArtifactDescriptor[];
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
          importFileAssetClass={props.importFileAssetClass}
          importFileModelType={props.importFileModelType}
          importFileArtifactKind={props.importFileArtifactKind}
          importFileAuxiliaryEngine={props.importFileAuxiliaryEngine}
          onHealthCheck={props.onHealthCheck}
          onRefresh={props.onRefresh}
          onOpenModelsFolder={props.onOpenModelsFolder}
          onToggleImportMenu={props.onToggleImportMenu}
          onOpenImportFile={props.onOpenImportFile}
          onImportManifest={props.onImportManifest}
          onAssetClassChange={props.onAssetClassChange}
          onModelTypeChange={props.onAssetModelTypeChange}
          onArtifactKindChange={props.onAssetArtifactKindChange}
          onAuxiliaryEngineChange={props.onAssetAuxiliaryEngineChange}
          onCloseImportFileDialog={props.onCloseImportFileDialog}
          onChooseImportFile={props.onChooseImportFile}
          canChooseImportFile={props.canChooseImportFile}
        />
        <LocalModelCenterUnregisteredAssetsSection
          assets={props.unregisteredAssets}
          assetImportError={props.assetImportError}
          assetImportSessionByPath={props.assetImportSessionByPath}
          importingAssetPath={props.importingAssetPath}
          resolveDraft={props.resolveUnregisteredAssetDraft}
          onRefresh={props.onRefreshUnregisteredAssets}
          onAssetClassChange={props.onUnregisteredAssetClassChange}
          onModelTypeChange={props.onUnregisteredModelTypeChange}
          onArtifactKindChange={props.onUnregisteredArtifactKindChange}
          onAuxiliaryEngineChange={props.onUnregisteredAuxiliaryEngineChange}
          onImport={props.onImportUnregisteredAsset}
        />
        <LocalModelCenterCatalogCard
          searchQuery={props.searchQuery}
          catalogCapability={props.catalogCapability}
          filteredInstalledModels={props.filteredInstalledModels}
          filteredInstalledArtifacts={props.filteredInstalledArtifacts}
          loadingCatalog={props.loadingCatalog}
          loadingInstalledArtifacts={props.loadingInstalledArtifacts}
          loadingVerifiedArtifacts={props.loadingVerifiedArtifacts}
          artifactKindFilter={props.artifactKindFilter}
          artifactBusy={props.artifactBusy}
          orphanFiles={props.orphanFiles}
          orphanError={props.orphanError}
          orphanCapabilities={props.orphanCapabilities}
          orphanImportSessionByPath={props.orphanImportSessionByPath}
          scaffoldingOrphan={props.scaffoldingOrphan}
          artifactOrphanFiles={props.artifactOrphanFiles}
          artifactOrphanError={props.artifactOrphanError}
          artifactOrphanKinds={props.artifactOrphanKinds}
          scaffoldingArtifactOrphan={props.scaffoldingArtifactOrphan}
          hasSearchQuery={props.hasSearchQuery}
          verifiedModels={props.verifiedModels}
          catalogItems={props.catalogItems}
          catalogDisplayCount={props.catalogDisplayCount}
          relatedArtifactsByModelTemplate={props.relatedArtifactsByModelTemplate}
          installedArtifactsById={props.installedArtifactsById}
          variantPickerItem={props.variantPickerItem}
          variantList={props.variantList}
          variantError={props.variantError}
          loadingVariants={props.loadingVariants}
          selectedCatalogCapability={props.selectedCatalogCapability}
          selectedCatalogEngine={props.selectedCatalogEngine}
          isArtifactPending={props.isArtifactPending}
          onSearchQueryChange={props.onSearchQueryChange}
          onCatalogCapabilityChange={props.onCatalogCapabilityChange}
          onRemoveModel={props.onRemoveModel}
          onArtifactKindFilterChange={props.onArtifactKindFilterChange}
          onRefreshArtifacts={props.onRefreshArtifacts}
          onRemoveArtifact={props.onRemoveArtifact}
          onOrphanCapabilityChange={props.onOrphanCapabilityChange}
          onScaffoldOrphan={props.onScaffoldOrphan}
          onArtifactOrphanKindChange={props.onArtifactOrphanKindChange}
          onScaffoldArtifactOrphan={props.onScaffoldArtifactOrphan}
          onInstallMissingArtifacts={props.onInstallMissingArtifacts}
          onInstallVerifiedModel={props.onInstallVerifiedModel}
          onInstallArtifact={props.onInstallArtifact}
          onToggleVariantPicker={props.onToggleVariantPicker}
          onCloseVariantPicker={props.onCloseVariantPicker}
          onCatalogCapabilityOverrideChange={props.onCatalogCapabilityOverrideChange}
          onCatalogEngineOverrideChange={props.onCatalogEngineOverrideChange}
          onInstallCatalogVariant={props.onInstallCatalogVariant}
          onLoadMoreCatalog={props.onLoadMoreCatalog}
          installing={props.installing}
        />
        <LocalModelCenterVerifiedArtifactsSection
          hasSearchQuery={props.hasSearchQuery}
          loadingVerifiedArtifacts={props.loadingVerifiedArtifacts}
          artifactBusy={props.artifactBusy}
          visibleVerifiedArtifacts={props.visibleVerifiedArtifacts}
          isArtifactPending={props.isArtifactPending}
          onRefresh={props.onRefreshArtifacts}
          onInstallArtifact={props.onInstallArtifact}
        />
        <LocalModelCenterActiveDownloadsSection
          downloads={props.downloads}
          onPause={props.onPauseDownload}
          onResume={props.onResumeDownload}
          onCancel={props.onCancelDownload}
        />
        <LocalModelCenterActiveImportsSection imports={props.imports} onDismiss={props.onDismissSession} />
        <LocalModelCenterArtifactTasksSection
          tasks={props.visibleArtifactTasks}
          pendingTemplateIds={props.artifactPendingTemplateIds}
          onRetryTask={props.onInstallArtifact}
        />
        {!props.hasSearchQuery ? (
          <LocalModelCenterQuickPicksSection
            loadingVerifiedModels={props.loadingVerifiedModels}
            installing={props.installing}
            artifactBusy={props.artifactBusy}
            verifiedModels={props.verifiedModels}
            relatedArtifactsByModelTemplate={props.relatedArtifactsByModelTemplate}
            installedArtifactsById={props.installedArtifactsById}
            isArtifactPending={props.isArtifactPending}
            onRefresh={props.onRefreshQuickPicks}
            onInstallVerifiedModel={props.onInstallVerifiedModel}
            onInstallArtifact={props.onInstallArtifact}
            onInstallMissingArtifacts={props.onInstallMissingArtifacts}
          />
        ) : null}
      </ScrollArea>
    </div>
  );
}
