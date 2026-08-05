import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { type LocalModelCenterProps } from './runtime-config-model-center-utils';
import { LocalModelCenterRuntimeView } from './runtime-config-local-model-center-runtime-view';
import { useLocalModelCenterRuntimeState } from './runtime-config-use-local-model-center-runtime-state';

export function LocalModelCenter(props: LocalModelCenterProps) {
  const commands = useDesktopRendererCommands();
  const runtimeState = useLocalModelCenterRuntimeState({ props });
  const hasSearchQuery = runtimeState.searchQuery.trim().length > 0;

  return (
    <LocalModelCenterRuntimeView
      assetBusy={runtimeState.assetBusy}
      assetKindFilter={runtimeState.assetKindFilter}
      assetPendingTemplateIds={runtimeState.assetPendingTemplateIds}
      catalogCapability={runtimeState.catalogCapability}
      catalogDisplayCount={runtimeState.catalogDisplayCount}
      catalogItems={runtimeState.catalogItems}
      checkingHealth={props.checkingHealth}
      deferredSearchQuery={runtimeState.deferredSearchQuery}
      discovering={props.discovering}
      filteredInstalledDependencyAssets={runtimeState.filteredInstalledDependencyAssets}
      filteredInstalledRunnableAssets={runtimeState.filteredInstalledRunnableAssets}
      sharedRuntimeDependency={runtimeState.sharedRuntimeDependency}
      sharedRuntimeDependencyJobs={runtimeState.sharedRuntimeDependencyJobs}
      runtimeDependencyByLocalAssetId={runtimeState.runtimeDependencyByLocalAssetId}
      runtimeDependencyError={runtimeState.runtimeDependencyError}
      runtimeInventoryError={runtimeState.runtimeInventoryError}
      hasSearchQuery={hasSearchQuery}
      importFileAssetKind={runtimeState.importFileAssetKind}
      importFileAuxiliaryEngine={runtimeState.importFileAuxiliaryEngine}
      importFileEndpoint={runtimeState.importFileEndpoint}
      importCompatibilityHint={runtimeState.importCompatibilityHint}
      importEndpointRequired={runtimeState.importEndpointRequired}
      importEndpointHint={runtimeState.importEndpointHint}
      importMenuRef={runtimeState.importMenuRef}
      importingAssetPath={runtimeState.importingAssetPath}
      installing={runtimeState.installing}
      installedAssetsById={runtimeState.installedAssetsById}
      isAssetPending={runtimeState.isAssetPending}
      lastCheckedAt={props.state.local.lastCheckedAt}
      loadingCatalog={runtimeState.loadingCatalog}
      loadingInstalledAssets={runtimeState.loadingInstalledAssets}
      loadingVariants={runtimeState.loadingVariants}
      loadingVerifiedAssets={runtimeState.loadingVerifiedAssets}
      loadingVerifiedModels={runtimeState.loadingVerifiedModels}
      assetImportError={runtimeState.assetImportError}
      assetImportSessionByPath={runtimeState.assetImportSessionByPath}
      unregisteredCompatibilityHintByPath={runtimeState.unregisteredCompatibilityHintByPath}
      unregisteredImportAllowedByPath={runtimeState.unregisteredImportAllowedByPath}
      unregisteredEndpointByPath={runtimeState.unregisteredEndpointByPath}
      unregisteredEndpointRequiredByPath={runtimeState.unregisteredEndpointRequiredByPath}
      unregisteredEndpointHintByPath={runtimeState.unregisteredEndpointHintByPath}
      onArtifactKindFilterChange={runtimeState.setAssetKindFilter}
      onCancelDownload={runtimeState.onCancelDownload}
      onAssetKindChange={(kind) => {
        runtimeState.setImportFileAssetKind(kind);
        if (kind !== 'auxiliary') {
          runtimeState.setImportFileAuxiliaryEngine('');
        }
      }}
      onAssetAuxiliaryEngineChange={runtimeState.setImportFileAuxiliaryEngine}
      onImportEndpointChange={runtimeState.setImportFileEndpoint}
      onCatalogCapabilityChange={runtimeState.setCatalogCapability}
      onCatalogCapabilityOverrideChange={(itemId, capability) => runtimeState.setCatalogCapabilityOverrides((prev) => ({
        ...prev,
        [itemId]: capability,
      }))}
      onChooseImportFile={() => {
        runtimeState.setShowImportFileDialog(false);
        void runtimeState.importPickedAssetFile(
          runtimeState.importFileDeclaration,
          runtimeState.importFileEndpoint,
        );
      }}
      onChooseImportDirectory={() => {
        runtimeState.setShowImportFileDialog(false);
        void runtimeState.importPickedAssetDirectory(
          runtimeState.importFileDeclaration,
          runtimeState.importFileEndpoint,
        );
      }}
      onCloseImportFileDialog={() => runtimeState.setShowImportFileDialog(false)}
      onCloseVariantPicker={runtimeState.closeVariantPicker}
      onOpenModelsFolder={() => { void commands.revealLocalRuntimeAssetsRootFolder(); }}
      onHealthCheck={() => void props.onHealthCheck()}
      onImportManifest={() => {
        runtimeState.setShowImportMenu(false);
        void runtimeState.importPickedAssetManifest();
      }}
      onInstallAsset={(templateId) => { void runtimeState.installVerifiedAsset(templateId); }}
      onInstallCatalogVariant={(item, variantFilename) => { void runtimeState.installCatalogVariant(item, variantFilename); }}
      onInstallMissingAssets={(assets) => { void runtimeState.installMissingAssetsForModel(assets); }}
      onInstallVerifiedModel={(templateId) => { void runtimeState.installVerifiedModel(templateId); }}
      onLoadMoreCatalog={() => runtimeState.setCatalogDisplayCount((prev) => prev + 10)}
      onOpenImportFile={() => {
        runtimeState.setShowImportMenu(false);
        runtimeState.setShowImportFileDialog(true);
      }}
      onOpenImportBundle={() => {
        runtimeState.setShowImportMenu(false);
        runtimeState.setImportFileAssetKind('chat');
        runtimeState.setShowImportFileDialog(true);
      }}
      onPauseDownload={runtimeState.onPauseDownload}
      onRefresh={() => {
        void props.onDiscover().finally(() => {
          void runtimeState.refreshUnregisteredAssets();
        });
      }}
      onRefreshAssets={() => { void runtimeState.refreshAssetSections(); }}
      onRefreshQuickPicks={() => { void runtimeState.refreshVerifiedModels(); }}
      onRefreshUnregisteredAssets={() => { void runtimeState.refreshUnregisteredAssets(); }}
      onRemoveAsset={(localAssetId) => { void runtimeState.removeInstalledAsset(localAssetId); }}
      onSetupRuntimeDependency={() => { void runtimeState.setupRuntimeDependency(); }}
      onCancelRuntimeDependencyJob={(jobId) => { void runtimeState.cancelRuntimeDependencyJob(jobId); }}
      onRetryRuntimeDependencyJob={(jobId) => { void runtimeState.retryRuntimeDependencyJob(jobId); }}
      onRepairRuntimeDependency={() => { void runtimeState.repairRuntimeDependency(); }}
      onRescanAsset={(localAssetId) => { void runtimeState.rescanInstalledAsset(localAssetId); }}
      onResumeDownload={runtimeState.onResumeDownload}
      onSearchQueryChange={runtimeState.setSearchQuery}
      onToggleImportMenu={() => runtimeState.setShowImportMenu((prev) => !prev)}
      onToggleVariantPicker={runtimeState.toggleVariantPicker}
      onImportUnregisteredAsset={(path) => { void runtimeState.importUnregisteredAsset(path); }}
      onUnregisteredAssetKindChange={runtimeState.setUnregisteredAssetKind}
      onUnregisteredAuxiliaryEngineChange={runtimeState.setUnregisteredAuxiliaryEngine}
      onUnregisteredEndpointChange={runtimeState.setUnregisteredEndpoint}
      relatedAssetsByModelTemplate={runtimeState.relatedAssetsByModelTemplate}
      resolveUnregisteredAssetDraft={runtimeState.resolveUnregisteredAssetDraft}
      searchQuery={runtimeState.searchQuery}
      selectedCatalogCapability={runtimeState.selectedCatalogCapability}
      showImportFileDialog={runtimeState.showImportFileDialog}
      showImportMenu={runtimeState.showImportMenu}
      canChooseImportFile={runtimeState.canChooseImportFile}
      canChooseImportDirectory={runtimeState.canChooseImportDirectory}
      variantError={runtimeState.variantError}
      variantList={runtimeState.variantList}
      variantPickerItem={runtimeState.variantPickerItem}
      verifiedModels={runtimeState.verifiedModels}
      visibleAssetTasks={runtimeState.visibleAssetTasks}
      visibleVerifiedAssets={runtimeState.visibleVerifiedAssets}
      downloads={runtimeState.activeDownloads}
      imports={runtimeState.activeImports}
      onDismissSession={runtimeState.onDismissSession}
      unregisteredAssets={runtimeState.unregisteredAssets}
    />
  );
}
