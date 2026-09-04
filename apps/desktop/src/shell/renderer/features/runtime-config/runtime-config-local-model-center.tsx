import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { LocalModelCenterRuntimeView } from './runtime-config-local-model-center-runtime-view';
import { useLocalModelCenterRuntimeState } from './runtime-config-use-local-model-center-runtime-state';

export function LocalModelCenter(props: { readonly runtimeWritesDisabled: boolean }) {
  const commands = useDesktopRendererCommands();
  const runtimeState = useLocalModelCenterRuntimeState();

  return (
    <LocalModelCenterRuntimeView
      assetBusy={runtimeState.assetBusy}
      assetImportError={runtimeState.assetImportError}
      loadingInstalledAssets={runtimeState.loadingInstalledAssets}
      modelAssets={runtimeState.modelAssets}
      runtimeInventoryError={runtimeState.runtimeInventoryError}
      importMenuRef={runtimeState.importMenuRef}
      showImportMenu={runtimeState.showImportMenu}
      runtimeWritesDisabled={props.runtimeWritesDisabled}
      downloads={runtimeState.activeDownloads}
      imports={runtimeState.activeImports}
      terminalDownloads={runtimeState.terminalDownloads}
      terminalImports={runtimeState.terminalImports}
      onCancelDownload={runtimeState.onCancelDownload}
      onDismissImportError={runtimeState.dismissAssetImportError}
      onDismissSession={runtimeState.onDismissSession}
      onImportFile={() => {
        runtimeState.setShowImportMenu(false);
        return runtimeState.importPickedAssetFile();
      }}
      onImportDirectory={() => {
        runtimeState.setShowImportMenu(false);
        return runtimeState.importPickedAssetDirectory();
      }}
      onInspectRemoval={runtimeState.inspectInstalledAssetRemoval}
      onOpenModelsFolder={() => { void commands.revealLocalRuntimeAssetsRootFolder(); }}
      onPauseDownload={runtimeState.onPauseDownload}
      onRefreshAssets={() => { void runtimeState.refreshInstalledAssets(); }}
      onRemoveAsset={runtimeState.removeInstalledAsset}
      onResumeDownload={runtimeState.onResumeDownload}
      onToggleImportMenu={() => runtimeState.setShowImportMenu((previous) => !previous)}
    />
  );
}
