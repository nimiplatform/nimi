import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import {
  LocalModelCenterRuntimeView,
  type LocalModelCenterSection,
} from './runtime-config-local-model-center-runtime-view';
import { useLocalModelCenterRuntimeState } from './runtime-config-use-local-model-center-runtime-state';

export function LocalModelCenter(props: {
  readonly activeSection: LocalModelCenterSection;
  /** Discovery content; it refreshes the downloaded files after an install completes. */
  readonly renderDiscover: (refreshInstalledAssets: () => Promise<void>) => ReactNode;
  /** Each increment opens the import menu (deep link "import model files"). */
  readonly importMenuRequest?: number;
  /** Empty-state shortcut back to the Discover tab. */
  readonly onOpenDiscover?: () => void;
  readonly runtimeWritesDisabled: boolean;
}) {
  const commands = useDesktopRendererCommands();
  const runtimeState = useLocalModelCenterRuntimeState();
  const { importMenuRequest } = props;
  const { setShowImportMenu } = runtimeState;
  useEffect(() => {
    if (importMenuRequest) setShowImportMenu(true);
  }, [importMenuRequest, setShowImportMenu]);

  return (
    <LocalModelCenterRuntimeView
      activeSection={props.activeSection}
      discoveryContent={props.renderDiscover(async () => { await runtimeState.refreshInstalledAssets(); })}
      assetBusy={runtimeState.assetBusy}
      assetImportError={runtimeState.assetImportError}
      loadingInstalledAssets={runtimeState.loadingInstalledAssets}
      modelAssets={runtimeState.modelAssets}
      runtimeInventoryError={runtimeState.runtimeInventoryError}
      importMenuRef={runtimeState.importMenuRef}
      showImportMenu={runtimeState.showImportMenu}
      runtimeWritesDisabled={props.runtimeWritesDisabled}
      downloads={runtimeState.activeDownloads}
      observedAtBySessionId={runtimeState.observedAtBySessionId}
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
      onOpenDiscover={props.onOpenDiscover}
    />
  );
}
