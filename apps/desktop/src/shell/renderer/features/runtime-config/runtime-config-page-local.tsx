import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { LocalRuntimeModelCenter } from '../panels/setup/local-runtime-model-center';

type LocalPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

export function LocalPage({ model, state }: LocalPageProps) {
  return (
    <LocalRuntimeModelCenter
      state={state}
      discovering={model.discovering}
      checkingHealth={model.checkingHealth}
      displayMode="runtime"
      runtimeDependencyTargets={model.runtimeDependencyTargets}
      localRuntimeModelQuery={model.localRuntimeModelQuery}
      filteredLocalRuntimeModels={model.filteredLocalRuntimeModels}
      onDiscover={model.discoverLocalRuntimeModels}
      onHealthCheck={model.runLocalRuntimeHealthCheck}
      onResolveDependencies={model.resolveRuntimeDependencies}
      onApplyDependencies={model.applyRuntimeDependencies}
      onInstallCatalogItem={model.installCatalogLocalRuntimeModel}
      onInstall={model.installLocalRuntimeModel}
      onInstallVerified={model.installVerifiedLocalRuntimeModel}
      onImport={model.importLocalRuntimeModel}
      onInstallVerifiedArtifact={model.installVerifiedLocalRuntimeArtifact}
      onImportArtifact={model.importLocalRuntimeArtifact}
      onImportFile={model.importLocalRuntimeModelFile}
      onStart={model.startLocalRuntimeModel}
      onStop={model.stopLocalRuntimeModel}
      onRestart={model.restartLocalRuntimeModel}
      onRemove={model.removeLocalRuntimeModel}
      onRemoveArtifact={model.removeLocalRuntimeArtifact}
      onSetLocalRuntimeModelQuery={model.setLocalRuntimeModelQuery}
      onChangeLocalRuntimeEndpoint={(endpoint) => {
        model.updateState((prev) => ({
          ...prev,
          localRuntime: { ...prev.localRuntime, endpoint },
        }));
      }}
      onNavigateToSetup={(pageId) => model.onChangePage(pageId)}
      onDownloadComplete={model.onDownloadComplete}
      onRetryInstall={model.retryInstall}
      installSessionMeta={model.installSessionMeta}
    />
  );
}
