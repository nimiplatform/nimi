import { useQuery } from '@tanstack/react-query';
import { Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppCardSurface, Button } from '@nimiplatform/kit/ui';
import type { NimiIntegrationManagement } from '@nimiplatform/sdk/app';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import type { IntegrationsPanelIntent } from '../integrations/integrations-panel.js';

/** App chips shown beside the authorization summary before a +N overflow. */
const HOME_AUTHORIZED_APP_SLOTS = 3;

type HomeAuthorizedApp = {
  readonly consumerRef: string;
  readonly appId: string;
  readonly displayName: string;
};

/** Unique apps holding at least one allowed operation, in Runtime's permission order. */
export function homeAuthorizedApps(snapshot: NimiIntegrationManagement, unavailableLabel: string): HomeAuthorizedApp[] {
  const seen = new Set<string>();
  const apps: HomeAuthorizedApp[] = [];
  for (const permission of snapshot.permissions) {
    if (!permission.operations.length) continue;
    const consumer =
      snapshot.consumers.find((item) => item.consumerRef === permission.consumerRef) ?? permission.consumer;
    const identity = consumer?.appId ? `app:${consumer.appId}` : `consumer:${permission.consumerRef}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    apps.push({
      consumerRef: permission.consumerRef,
      appId: consumer?.appId || permission.consumerRef,
      displayName: consumer?.displayName || consumer?.appId || unavailableLabel,
    });
  }
  return apps;
}

// Home only projects active Runtime-owned connections and permissions; when
// neither exists, Home renders no disconnected service wall.
export function HomeIntegrationsCard({
  appIconUrls,
  onOpen,
}: {
  appIconUrls: ReadonlyMap<string, string | null>;
  onOpen: (intent?: IntegrationsPanelIntent) => void;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const management = useQuery({
    queryKey: ['nimi-overview', 'integration-management'],
    queryFn: () => sdk.appProduct().integration.getManagement(),
    staleTime: 30_000,
  });
  const snapshot = management.data ?? null;
  if (!snapshot) return null;

  const activeConnectionCount = snapshot.targets.length;
  const authorizedApps = homeAuthorizedApps(snapshot, t('Integrations.unavailableApp'));
  if (activeConnectionCount === 0 && authorizedApps.length === 0) {
    return null;
  }

  const shownApps = authorizedApps.slice(0, HOME_AUTHORIZED_APP_SLOTS);
  const hiddenAppCount = authorizedApps.length - shownApps.length;

  return (
    <AppCardSurface
      kind="operational-solid"
      className="flex min-w-0 flex-col gap-2.5 p-4 shadow-[var(--nimi-elevation-base)]"
      data-testid="home-integrations"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-primary)]">
            <Plug size={15} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{t('Integrations.title')}</h2>
            <p className="truncate text-xs text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.overview.integrationsSummary.activeSummary', {
                connections: activeConnectionCount,
                apps: authorizedApps.length,
              })}
            </p>
          </div>
        </div>
        <Button
          tone="ghost"
          size="sm"
          onClick={() => onOpen()}
          data-testid="home-integrations-enter"
        >
          {t('Integrations.homeEnter')}
        </Button>
      </header>

      {authorizedApps.length > 0 ? (
        <footer
          className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--nimi-border-subtle)] pt-2.5"
          data-testid="home-integrations-authorized"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-xs font-medium text-[var(--nimi-text-secondary)]">
              {t('Integrations.homeAuthorizedSummary', { count: authorizedApps.length })}
            </span>
            {shownApps.map((app) => (
              <span
                key={app.consumerRef}
                className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--nimi-text-primary)]"
              >
                <AppArtworkIcon
                  appId={app.appId}
                  displayName={app.displayName}
                  iconUrl={appIconUrls.get(app.appId) ?? null}
                  size="xs"
                />
                <span className="max-w-28 truncate">{app.displayName}</span>
              </span>
            ))}
            {hiddenAppCount > 0 ? (
              <span className="text-xs text-[var(--nimi-text-muted)]">{`+${hiddenAppCount}`}</span>
            ) : null}
          </div>
          <Button
            tone="ghost"
            size="sm"
            onClick={() => onOpen({ service: 'all-permissions' })}
            className="shrink-0"
            data-testid="home-integrations-manage-permissions"
          >
            {t('Integrations.homeManagePermissions')}
          </Button>
        </footer>
      ) : null}
    </AppCardSurface>
  );
}
