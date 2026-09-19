// @nimi-authority: rule.nimi.desktop.shell-ui.r005

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PillTabs } from '@nimiplatform/kit/ui';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { RuntimePageHeader, RuntimePageShell } from './runtime-config-page-shell';
import { RecommendPage } from './runtime-config-page-recommend';
import { LocalModelCenter } from './runtime-config-local-model-center';
import type { LocalModelCenterSection } from './runtime-config-local-model-center-runtime-view';

const MODEL_LIBRARY_SECTIONS: ReadonlyArray<{
  id: LocalModelCenterSection;
  labelKey: string;
  defaultLabel: string;
}> = [
  { id: 'discover', labelKey: 'runtimeConfig.modelLibrary.discoverTab', defaultLabel: 'Discover' },
  { id: 'downloaded', labelKey: 'runtimeConfig.modelLibrary.downloadedTab', defaultLabel: 'Downloaded' },
  { id: 'transfers', labelKey: 'runtimeConfig.modelLibrary.transfersTab', defaultLabel: 'Transfers' },
];

/**
 * Model Library: market discovery, the built-in catalog, downloaded assets,
 * and transfers share one destination. The transfer runtime state lives in
 * the always-mounted LocalModelCenter so in-flight sessions survive sub-tab
 * switches.
 */
export function ModelLibraryPage(props: {
  readonly model: RuntimeConfigPanelControllerModel;
  readonly onClearActionFocus: () => void;
}) {
  const { t } = useTranslation();
  const { model } = props;
  const [section, setSection] = useState<LocalModelCenterSection>('discover');

  // The install-model deep link lands here: discovery is the acquisition
  // entry, so the intent focuses this tab and is consumed once.
  const actionFocus = model.state?.actionFocus;
  const { onClearActionFocus } = props;
  useEffect(() => {
    if (actionFocus?.focus !== 'runtime-config-action-focus.model-library-install') return;
    setSection('discover');
    onClearActionFocus();
  }, [actionFocus, onClearActionFocus]);

  return (
    <RuntimePageShell>
      <RuntimePageHeader
        title={t('runtimeConfig.nav.modelLibrary', { defaultValue: 'Model Library' })}
        description={t('runtimeConfig.modelLibrary.description', {
          defaultValue: 'Find models, manage downloads and import files.',
        })}
        actions={(
          <div data-testid="runtime-model-library-subtabs">
            <PillTabs
              size="sm"
              ariaLabel={t('runtimeConfig.nav.modelLibrary', { defaultValue: 'Model Library' })}
              items={MODEL_LIBRARY_SECTIONS.map((item) => ({
                value: item.id,
                label: t(item.labelKey, { defaultValue: item.defaultLabel }),
              }))}
              value={section}
              onValueChange={(value) => setSection(value as LocalModelCenterSection)}
            />
          </div>
        )}
      />
      {section === 'discover' ? (
        <RecommendPage
          model={model}
          context={model.modelMarketContext}
          onReturnToLoadout={model.onReturnToContextualLoadout}
          onOpenDownloaded={() => setSection('downloaded')}
        />
      ) : null}
      <LocalModelCenter
        activeSection={section}
        runtimeWritesDisabled={model.runtimeWritesDisabled}
        installResolvedModelPlan={model.installResolvedModelPlan}
      />
    </RuntimePageShell>
  );
}
