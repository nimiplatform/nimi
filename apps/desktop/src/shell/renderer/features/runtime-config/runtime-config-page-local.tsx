import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { LocalModelCenter } from './runtime-config-local-model-center';
import { CatalogOverridesDrawer } from './runtime-config-catalog-overrides-drawer';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { InlineFeedback } from '../../ui/feedback/inline-feedback';

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
        <InlineFeedback
          className="mx-4 mt-4"
          title={t('RuntimeConfigLocal.runtimeUnavailableTitle')}
          feedback={{ kind: 'warning', message: t('RuntimeConfigLocal.runtimeUnavailableBody') }}
        />
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
