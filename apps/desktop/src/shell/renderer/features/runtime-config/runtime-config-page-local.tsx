import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { LocalModelCenter } from './runtime-config-local-model-center';

type LocalPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

export function LocalPage({ model, state }: LocalPageProps) {
  return (
    <LocalModelCenter
      state={state}
      discovering={model.discovering}
      checkingHealth={model.checkingHealth}
      displayMode="runtime"
      runtimeDependencyTargets={model.runtimeDependencyTargets}
      localModelQuery={model.localModelQuery}
      filteredLocalModels={model.filteredLocalModels}
      onDiscover={model.discoverLocalModels}
      onHealthCheck={model.runLocalHealthCheck}
      onResolveDependencies={model.resolveRuntimeDependencies}
      onApplyDependencies={model.applyRuntimeDependencies}
      onInstallCatalogItem={model.installCatalogLocalModel}
      onInstall={model.installLocalModel}
      onInstallVerified={model.installVerifiedLocalModel}
      onImport={model.importLocalModel}
      onInstallVerifiedArtifact={model.installVerifiedLocalArtifact}
      onImportArtifact={model.importLocalArtifact}
      onScaffoldArtifactOrphan={model.scaffoldLocalArtifactOrphan}
      onImportFile={model.importLocalModelFile}
      onStart={model.startLocalModel}
      onStop={model.stopLocalModel}
      onRestart={model.restartLocalModel}
      onRemove={model.removeLocalModel}
      onRemoveArtifact={model.removeLocalArtifact}
      onSetLocalModelQuery={model.setLocalModelQuery}
      onChangeLocalEndpoint={(endpoint) => {
        model.updateState((prev) => ({
          ...prev,
          local: { ...prev.local, endpoint },
        }));
      }}
      onNavigateToSetup={(pageId) => model.onChangePage(pageId)}
      onDownloadComplete={model.onDownloadComplete}
      onRetryInstall={model.retryInstall}
      installSessionMeta={model.installSessionMeta}
    />
  );
}
