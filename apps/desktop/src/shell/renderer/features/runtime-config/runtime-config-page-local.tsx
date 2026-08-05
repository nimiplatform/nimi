import { useTranslation } from 'react-i18next';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
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
        <div className="border-b border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] px-4 py-3 text-sm text-[var(--nimi-status-warning)]">
          <p className="font-medium">{t('RuntimeConfigLocal.runtimeUnavailableTitle')}</p>
          <p className="mt-1 text-xs text-[color-mix(in_srgb,var(--nimi-status-warning)_80%,var(--nimi-text-secondary))]">
            {t('RuntimeConfigLocal.runtimeUnavailableBody')}
          </p>
        </div>
      ) : null}
      <LocalModelCenter
        state={state}
        discovering={model.discovering}
        checkingHealth={model.checkingHealth}
        localModelQuery={model.localModelQuery}
        filteredLocalModels={model.filteredLocalModels}
        onDiscover={model.discoverLocalModels}
        onHealthCheck={model.runLocalHealthCheck}
        onInstallCatalogItem={model.installCatalogLocalModel}
        onInstall={model.installLocalModel}
        onInstallVerified={model.installVerifiedLocalModel}
        onImport={model.importLocalModel}
        onInstallVerifiedAsset={model.installVerifiedLocalAsset}
        onImportAsset={model.importLocalAsset}
        onScaffoldAssetOrphan={model.scaffoldLocalAssetOrphan}
        onImportFile={model.importLocalModelFile}
        onRemove={model.removeLocalModel}
        onRemoveAsset={model.removeLocalAsset}
        onSetLocalModelQuery={model.setLocalModelQuery}
        onDownloadComplete={model.onDownloadComplete}
        onRetryInstall={model.retryInstall}
        installSessionMeta={model.installSessionMeta}
      />
    </div>
  );
}
