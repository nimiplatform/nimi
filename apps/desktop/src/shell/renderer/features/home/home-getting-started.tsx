import { Button, IconButton, Surface, Tooltip } from '@nimiplatform/kit/ui';
import { readStorageTextFrom, resolveBrowserStorage, writeStorageTextTo } from '@nimiplatform/kit/core/storage-json';
import { ArrowRight, X } from 'lucide-react';
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
  // Display-only dismissal preference for cold-start onboarding, scoped per account.
  const storageKey = `nimi.home.getting-started.dismissed:${encodeURIComponent(props.accountKey)}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    const stored = readStorageTextFrom(resolveBrowserStorage('local'), storageKey);
    return stored.state === 'ready' && stored.value === 'true';
  });

  // Cold-start onboarding only: once AI compute is ready or the user dismisses it,
  // it retires completely and never occupies permanent Dashboard real estate.
  if (props.textPreparation === 'ready' || dismissed) {
    return null;
  }

  const dismiss = () => {
    setDismissed(true);
    writeStorageTextTo(resolveBrowserStorage('local'), storageKey, 'true');
  };

  return (
    <Surface
      as="section"
      tone="card"
      elevation="base"
      padding="none"
      className="flex min-w-0 flex-col gap-4 rounded-3xl border-transparent! bg-[var(--nimi-home-porcelain-card)]! p-6 shadow-[var(--nimi-home-porcelain-shadow)]!"
      data-testid="home-first-run"
      data-ready="false"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.overview.firstRunTitle')}
          </h2>
          <p className="truncate text-xs text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.overview.firstRunSteps.coldStartHint')}
          </p>
        </div>
        <Tooltip content={t('runtimeConfig.overview.firstRunDismiss')} placement="top">
          <IconButton
            tone="ghost"
            size="sm"
            aria-label={t('runtimeConfig.overview.firstRunDismiss')}
            onClick={dismiss}
            data-testid="home-first-run-dismiss"
            className="size-8 shrink-0 rounded-full bg-[var(--nimi-home-soft-well)] text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-home-soft-well-hover)]"
            icon={<X size={15} aria-hidden="true" />}
          />
        </Tooltip>
      </div>

      <div id="home-getting-started-steps" className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col justify-between gap-3 rounded-2xl bg-[var(--nimi-home-soft-well)] p-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--nimi-text-primary)] text-xs font-semibold text-[var(--nimi-surface-card)]">
                1
              </span>
              <p className="text-xs font-semibold text-[var(--nimi-text-primary)]">
                {t('runtimeConfig.overview.firstRunSteps.step1Badge')}
              </p>
            </div>
            <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
              {t(`runtimeConfig.overview.firstRun.model.states.${props.textPreparation}`)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button tone="primary" size="sm" onClick={props.onOpenAI}>
              {t('runtimeConfig.overview.firstRun.model.action')}
            </Button>
            <Button tone="ghost" size="sm" onClick={props.onOpenCloud}>
              {t('runtimeConfig.overview.firstRun.model.cloud')}
            </Button>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-3 rounded-2xl bg-[var(--nimi-home-soft-well)] p-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--nimi-home-porcelain-card)] text-xs font-semibold text-[var(--nimi-text-secondary)] shadow-[var(--nimi-elevation-base)]">
                2
              </span>
              <p className="text-xs font-semibold text-[var(--nimi-text-primary)]">
                {t('runtimeConfig.overview.firstRunSteps.step2Badge')}
              </p>
            </div>
            <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.overview.firstRun.chat.body')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button tone="secondary" size="sm" onClick={props.onOpenChat}>
              {t('runtimeConfig.overview.firstRun.chat.action')}
              <ArrowRight size={14} aria-hidden="true" />
            </Button>
            <Button tone="ghost" size="sm" onClick={props.onExplore}>
              {t('runtimeConfig.overview.firstRun.chat.partner')}
            </Button>
            <Button tone="ghost" size="sm" onClick={props.onOpenApps}>
              {t('runtimeConfig.overview.firstRun.apps.action')}
            </Button>
          </div>
        </div>
      </div>
    </Surface>
  );
}
