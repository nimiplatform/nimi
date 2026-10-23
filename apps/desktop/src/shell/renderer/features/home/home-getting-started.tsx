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
  const actions = { model: props.onOpenAI, chat: props.onOpenChat, apps: props.onOpenApps };
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
        <ol id="home-getting-started-steps" className="grid gap-3 md:grid-cols-3">
          {(['model', 'chat', 'apps'] as const).map((step, index) => (
            <li key={step} className="flex flex-col gap-3 rounded-2xl bg-[var(--nimi-surface-card)] p-4">
              <span className="flex size-8 items-center justify-center rounded-full bg-[var(--nimi-surface-active)] text-sm font-semibold text-[var(--nimi-action-primary-bg)]">{index + 1}</span>
              <div className="flex-1">
                <h3 className="font-semibold">{t(`runtimeConfig.overview.firstRun.${step}.title`)}</h3>
                <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">
                  {t(step === 'model'
                    ? `runtimeConfig.overview.firstRun.model.states.${props.textPreparation}`
                    : `runtimeConfig.overview.firstRun.${step}.body`)}
                </p>
              </div>
              <Button tone={step === 'chat' ? 'primary' : 'secondary'} size="sm" onClick={actions[step]}>
                {t(`runtimeConfig.overview.firstRun.${step}.action`)}
                <ArrowRight size={14} aria-hidden="true" />
              </Button>
              {step === 'model' ? (
                <Button tone="ghost" size="sm" onClick={props.onOpenCloud}>{t('runtimeConfig.overview.firstRun.model.cloud')}</Button>
              ) : step === 'chat' ? (
                <Button tone="ghost" size="sm" onClick={props.onExplore}>{t('runtimeConfig.overview.firstRun.chat.partner')}</Button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
