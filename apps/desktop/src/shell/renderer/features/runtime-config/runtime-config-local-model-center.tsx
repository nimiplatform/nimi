import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { type LocalModelCenterProps } from './runtime-config-model-center-utils';
import { LocalModelCenterRuntimeView } from './runtime-config-local-model-center-runtime-view';
import {
  catalogAssetLookupKey,
  useLocalModelCenterRuntimeState,
} from './runtime-config-use-local-model-center-runtime-state';

export function LocalModelCenter(props: LocalModelCenterProps) {
  const commands = useDesktopRendererCommands();
  const runtimeState = useLocalModelCenterRuntimeState({ props });
  const hasSearchQuery = runtimeState.searchQuery.trim().length > 0;

  return (
    <LocalModelCenterRuntimeView
      assetBusy={runtimeState.assetBusy}
      assetImportError={runtimeState.assetImportError}
      assetPendingTemplateIds={runtimeState.assetPendingTemplateIds}
      catalogCapability={runtimeState.catalogCapability}
      catalogDisplayCount={runtimeState.catalogDisplayCount}
      catalogItems={runtimeState.catalogItems}
      deferredSearchQuery={runtimeState.deferredSearchQuery}
      refreshing={runtimeState.loadingInstalledAssets || runtimeState.loadingVerifiedAssets}
      modelAssets={runtimeState.filteredModelAssets}
      runtimeInventoryError={runtimeState.runtimeInventoryError}
      hasSearchQuery={hasSearchQuery}
      importMenuRef={runtimeState.importMenuRef}
      installing={runtimeState.installing}
      isAssetPending={runtimeState.isAssetPending}
      isCatalogAssetInstalled={(assetId) => runtimeState.installedCatalogAssetsById.has(catalogAssetLookupKey(assetId))}
      loadingCatalog={runtimeState.loadingCatalog}
      loadingInstalledAssets={runtimeState.loadingInstalledAssets}
      loadingVariants={runtimeState.loadingVariants}
      loadingVerifiedAssets={runtimeState.loadingVerifiedAssets}
      loadingVerifiedModels={runtimeState.loadingVerifiedModels}
      openDiscoverRequest={props.openDiscoverRequest}
      showCatalogOverridesAction={props.showCatalogOverridesAction}
      onCancelDownload={runtimeState.onCancelDownload}
      onDismissImportError={runtimeState.dismissAssetImportError}
      onCatalogCapabilityChange={runtimeState.setCatalogCapability}
      onImportFile={() => {
        runtimeState.setShowImportMenu(false);
        return runtimeState.importPickedAssetFile();
      }}
      onImportDirectory={() => {
        runtimeState.setShowImportMenu(false);
        return runtimeState.importPickedAssetDirectory();
      }}
      onCloseVariantPicker={runtimeState.closeVariantPicker}
      onOpenModelsFolder={() => { void commands.revealLocalRuntimeAssetsRootFolder(); }}
      onOpenDiscoverRequestConsumed={props.onOpenDiscoverRequestConsumed}
      onOpenCatalogOverrides={props.onOpenCatalogOverrides}
      onInstallAsset={(templateId) => { void runtimeState.installCatalogAsset(templateId); }}
      onInstallCatalogVariant={(item, variantFilename) => { void runtimeState.installCatalogVariant(item, variantFilename); }}
      onInstallCatalogQuickPick={(templateId) => { void runtimeState.installCatalogQuickPick(templateId); }}
      onLoadMoreCatalog={() => runtimeState.setCatalogDisplayCount((prev) => prev + 10)}
      onPauseDownload={runtimeState.onPauseDownload}
      onRefresh={() => {
        void runtimeState.refreshAssetSections();
      }}
      onRefreshAssets={() => { void runtimeState.refreshAssetSections(); }}
      onRefreshQuickPicks={() => { void runtimeState.refreshVerifiedModels(); }}
      onInspectRemoval={runtimeState.inspectInstalledAssetRemoval}
      onRemoveAsset={runtimeState.removeInstalledAsset}
      onResumeDownload={runtimeState.onResumeDownload}
      onSearchQueryChange={runtimeState.setSearchQuery}
      onToggleImportMenu={() => runtimeState.setShowImportMenu((prev) => !prev)}
      onToggleVariantPicker={runtimeState.toggleVariantPicker}
      runtimeWritesDisabled={props.runtimeWritesDisabled}
      searchQuery={runtimeState.searchQuery}
      selectedCatalogCapability={runtimeState.selectedCatalogCapability}
      showImportMenu={runtimeState.showImportMenu}
      variantError={runtimeState.variantError}
      variantList={runtimeState.variantList}
      variantPickerItem={runtimeState.variantPickerItem}
      verifiedModels={runtimeState.verifiedModels}
      visibleAssetTasks={runtimeState.visibleAssetTasks}
      visibleVerifiedAssets={runtimeState.visibleVerifiedAssets}
      downloads={runtimeState.activeDownloads}
      imports={runtimeState.activeImports}
      terminalDownloads={runtimeState.terminalDownloads}
      terminalImports={runtimeState.terminalImports}
      onDismissSession={runtimeState.onDismissSession}
      onDismissAssetTask={runtimeState.dismissAssetTask}
    />
  );
}
