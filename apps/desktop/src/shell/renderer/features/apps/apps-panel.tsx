import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea, Surface } from '@nimiplatform/nimi-kit/ui';
import { createDesktopHomeLiveBridge } from '../nimi-home/nimi-home-live-bridge.js';
import { projectAppsPanel, type DesktopAppsPanelProjection } from './apps-panel-projection.js';
import { AppsPanelView } from './apps-panel-view.js';

function LoadingAppsProjection(): ReactElement {
  const { t } = useTranslation();
  return (
    <section data-testid="apps-panel-loading" className="flex min-h-32 animate-pulse items-center justify-center rounded-lg border border-dashed border-[color:var(--nimi-border-subtle)] text-sm text-[var(--nimi-text-secondary)]">
      {t('Apps.loading')}
    </section>
  );
}

export function AppsPanel(): ReactElement {
  const { t } = useTranslation();
  const liveBridge = useMemo(() => createDesktopHomeLiveBridge(), []);
  const [projection, setProjection] = useState<DesktopAppsPanelProjection | null>(null);

  useEffect(() => {
    let cancelled = false;
    void projectAppsPanel(liveBridge.appClient).then((next) => {
      if (!cancelled) setProjection(next);
    });
    return () => {
      cancelled = true;
    };
  }, [liveBridge]);

  return (
    <div data-testid="apps-panel" className="flex min-h-0 flex-1 flex-col">
      <ScrollArea
        className="flex-1"
        viewportClassName="bg-transparent"
        contentClassName="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5"
      >
        <header>
          <p className="text-xs font-semibold uppercase text-[var(--nimi-text-secondary)]">Nimi</p>
          <h1 className="mt-2 text-3xl font-semibold text-[var(--nimi-text-primary)]">
            {t('Navigation.apps', { defaultValue: 'Apps' })}
          </h1>
        </header>

        <Surface tone="panel" material="glass-regular" padding="none" className="min-h-[220px] p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)]">
          {projection ? <AppsPanelView projection={projection} /> : <LoadingAppsProjection />}
        </Surface>
      </ScrollArea>
    </div>
  );
}
