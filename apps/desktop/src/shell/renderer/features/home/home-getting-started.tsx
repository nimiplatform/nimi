import { Button } from '@nimiplatform/kit/ui';
import { readStorageTextFrom, resolveBrowserStorage, writeStorageTextTo } from '@nimiplatform/kit/core/storage-json';
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CapabilityPreparationState } from '../runtime-config/runtime-capability-inventory.js';

export type HomeGettingStartedProps = {
  accountKey: string;
  textPreparation: CapabilityPreparationState;
  onOpenAI: () => void;
  onOpenCloud: () => void;
  onOpenChat: () => void;
  onExplore: () => void;
  onOpenApps: () => void;
};

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
export function HomeGettingStarted(props: HomeGettingStartedProps) {
  const { t } = useTranslation();
  // A display preference only, never task completion or Runtime readiness.
  // The parent keys this component by account so the preference cannot leak.
  const storageKey = `nimi.home.getting-started.collapsed:${encodeURIComponent(props.accountKey)}`;
  const [collapsed, setCollapsed] = useState(() => {
    const stored = readStorageTextFrom(resolveBrowserStorage('local'), storageKey);
    return stored.state === 'ready' && stored.value === 'true';
  });
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeStorageTextTo(resolveBrowserStorage('local'), storageKey, String(next));
  };
  return (
    <section className="flex flex-col gap-4 rounded-[24px] bg-[var(--nimi-surface-panel)] p-5 shadow-[var(--nimi-home-card-elevation)]" data-testid="home-first-run">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t('runtimeConfig.overview.firstRunTitle')}</h2>
        <Button tone="ghost" size="sm" aria-expanded={!collapsed} aria-controls="home-getting-started-steps" onClick={toggle}>
          {t(collapsed ? 'runtimeConfig.overview.firstRunExpand' : 'runtimeConfig.overview.firstRunCollapse')}
          {collapsed ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronUp size={15} aria-hidden="true" />}
        </Button>
      </div>
      {!collapsed ? (
        <div id="home-getting-started-steps" className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="min-w-0 flex-1 basis-64 text-sm text-[var(--nimi-text-secondary)]">
              {t(`runtimeConfig.overview.firstRun.model.states.${props.textPreparation}`)}
            </p>
            <div className="flex flex-wrap gap-1">
              <Button tone="ghost" size="sm" onClick={props.onOpenAI}>{t('runtimeConfig.overview.firstRun.model.action')}</Button>
              <Button tone="ghost" size="sm" onClick={props.onOpenCloud}>{t('runtimeConfig.overview.firstRun.model.cloud')}</Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button tone="primary" size="sm" onClick={props.onOpenChat}>
              {t('runtimeConfig.overview.firstRun.chat.action')}<ArrowRight size={14} aria-hidden="true" />
            </Button>
            <Button tone="secondary" size="sm" onClick={props.onExplore}>{t('runtimeConfig.overview.firstRun.chat.partner')}</Button>
            <Button tone="secondary" size="sm" onClick={props.onOpenApps}>{t('runtimeConfig.overview.firstRun.apps.action')}</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
