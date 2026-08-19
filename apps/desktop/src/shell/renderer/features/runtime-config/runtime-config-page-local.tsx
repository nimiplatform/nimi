import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { LocalModelCenter } from './runtime-config-local-model-center';
import { CatalogOverridesDrawer } from './runtime-config-catalog-overrides-drawer';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

type LocalPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

export function LocalPage({ model, state }: LocalPageProps) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const [catalogOverridesOpen, setCatalogOverridesOpen] = useState(false);
  const developerModeEnabled = bindings.app.projection.developerModeEnabled();
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
        runtimeWritesDisabled={model.runtimeWritesDisabled}
        openDiscoverRequest={state.actionFocus?.focus === 'runtime-config-action-focus.local-models-discover'}
        onOpenDiscoverRequestConsumed={() => {
          model.updateState((previous) => (
            previous.actionFocus?.focus === 'runtime-config-action-focus.local-models-discover'
              ? { ...previous, actionFocus: null }
              : previous
          ));
        }}
        showCatalogOverridesAction={developerModeEnabled}
        onOpenCatalogOverrides={() => setCatalogOverridesOpen(true)}
        onInstallCatalogItem={model.installCatalogLocalModel}
        onInstallCatalogAsset={model.installCatalogModelAsset}
      />
      <CatalogOverridesDrawer
        open={catalogOverridesOpen}
        providerId="local"
        onClose={() => setCatalogOverridesOpen(false)}
      />
    </div>
  );
}
