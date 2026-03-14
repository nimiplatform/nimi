import { useTranslation } from 'react-i18next';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { LocalModelCenter } from './runtime-config-local-model-center';

type LocalPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

export function LocalPage({ model, state }: LocalPageProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {model.runtimeWritesDisabled ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">{t('RuntimeConfigLocal.runtimeUnavailableTitle')}</p>
          <p className="mt-1 text-xs opacity-80">{t('RuntimeConfigLocal.runtimeUnavailableBody')}</p>
        </div>
      ) : null}
      <LocalModelCenter
        state={state}
        discovering={model.discovering}
        checkingHealth={model.checkingHealth}
        displayMode="runtime"
        runtimeProfileTargets={model.runtimeProfileTargets}
        localModelQuery={model.localModelQuery}
        filteredLocalModels={model.filteredLocalModels}
        onDiscover={model.discoverLocalModels}
        onHealthCheck={model.runLocalHealthCheck}
        onResolveProfile={model.resolveRuntimeProfile}
        onApplyProfile={model.applyRuntimeProfile}
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
    </div>
  );
}
