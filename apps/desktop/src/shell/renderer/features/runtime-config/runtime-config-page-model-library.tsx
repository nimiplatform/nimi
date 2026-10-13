// @nimi-authority: rule.nimi.desktop.shell-ui.r005

import { useEffect, useState } from 'react';
import { useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { homeRuntimeDestination } from '../../app-shell/providers/home-navigation.js';
import { useTranslation } from 'react-i18next';
import { NimiTabs } from '@nimiplatform/kit/ui';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { RuntimePageHeader, RuntimePageShell } from './runtime-config-page-shell';
import { RecommendPage } from './runtime-config-page-recommend';
import { LocalModelCenter } from './runtime-config-local-model-center';
import type { LocalModelCenterSection } from './runtime-config-local-model-center-runtime-view';
import { useRuntimeModelLibrary } from './use-runtime-model-library';

const MODEL_LIBRARY_SECTIONS: ReadonlyArray<{
  id: LocalModelCenterSection;
  labelKey: string;
  defaultLabel: string;
}> = [
  { id: 'discover', labelKey: 'runtimeConfig.modelLibrary.discoverTab', defaultLabel: 'Discover' },
  { id: 'downloaded', labelKey: 'runtimeConfig.modelLibrary.downloadedTab', defaultLabel: 'Downloaded' },
];

/**
 * Model Library: discovery (the Nimi collection and community picks),
 * downloaded assets, and transfers share one destination. The transfer runtime state lives in
 * the always-mounted LocalModelCenter so in-flight sessions survive sub-tab
 * switches.
 */
export function ModelLibraryPage(props: {
  readonly model: RuntimeConfigPanelControllerModel;
  readonly onClearActionFocus: () => void;
}) {
  const { t } = useTranslation();
  const { model } = props;
  const actionFocus = model.actionFocus;
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  // The downloaded tab carries the installed-asset count badge.
  const downloadedCount = useRuntimeModelLibrary().data?.assets.length ?? 0;
  // Local-files intents open on the downloaded files from the first render, so
  // discovery never mounts (or queries the market) on the way there.
  const section = destination.runtime?.section === 'downloaded' ? 'downloaded' : 'discover';
  const openSection = (value: 'discover' | 'downloaded') => { void navigation.push(homeRuntimeDestination('modelLibrary', { ...destination.runtime, section: value })); };
  // Counts import requests so a repeated deep link reopens the menu.
  const [importMenuRequest, setImportMenuRequest] = useState(0);

  // The install-model deep link lands here: discovery is the acquisition
  // entry, so the intent focuses this tab and is consumed once.
  const { onClearActionFocus } = props;
  useEffect(() => {
    if (actionFocus?.focus === 'runtime-config-action-focus.model-library-install') {
      onClearActionFocus();
      return;
    }
    // "Manage model files" lands on the local files.
    if (actionFocus?.focus === 'runtime-config-action-focus.model-library-files') {
      onClearActionFocus();
      return;
    }
    // "Import model files" lands on the local files with the import menu open.
    if (actionFocus?.focus === 'runtime-config-action-focus.model-library-import') {
      setImportMenuRequest((value) => value + 1);
      onClearActionFocus();
    }
  }, [actionFocus, onClearActionFocus]);

  return (
    <RuntimePageShell>
      <RuntimePageHeader
        title={t('runtimeConfig.nav.modelLibrary', { defaultValue: 'Model Library' })}
      />
      <div data-testid="runtime-model-library-subtabs">
        <NimiTabs
          ariaLabel={t('runtimeConfig.nav.modelLibrary', { defaultValue: 'Model Library' })}
          className="[&_[aria-selected='true']]:text-[var(--nimi-action-primary-bg)]"
          items={MODEL_LIBRARY_SECTIONS.map((item) => ({
            value: item.id,
            label: item.id === 'downloaded' ? (
              <span className="inline-flex items-center gap-1.5">
                {t(item.labelKey, { defaultValue: item.defaultLabel })}
                {downloadedCount > 0 ? (
                  <span className="rounded-full bg-[var(--nimi-surface-active)] px-1.5 py-0.5 text-[11px] leading-none font-medium text-[var(--nimi-text-secondary)]">
                    {downloadedCount}
                  </span>
                ) : null}
              </span>
            ) : t(item.labelKey, { defaultValue: item.defaultLabel }),
          }))}
          value={section}
          onValueChange={(value) => openSection(value as 'discover' | 'downloaded')}
        />
      </div>
      <LocalModelCenter
        activeSection={section}
        renderDiscover={(refreshInstalledAssets) => (
          <RecommendPage
            key={model.modelMarketContext ? `${model.modelMarketContext.kind}:${model.modelMarketContext.capabilityContract}` : 'market'}
            model={model}
            context={model.modelMarketContext}
            onModelInstalled={refreshInstalledAssets}
            onReturnToLoadout={model.onReturnToContextualLoadout}
            onOpenDownloaded={() => openSection('downloaded')}
          />
        )}
        importMenuRequest={importMenuRequest}
        onOpenDiscover={() => openSection('discover')}
        runtimeWritesDisabled={model.runtimeWritesDisabled}
      />
    </RuntimePageShell>
  );
}
