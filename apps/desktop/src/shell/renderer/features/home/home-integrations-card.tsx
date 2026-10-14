import { useQuery } from '@tanstack/react-query';
import { Plus, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/kit/ui';
import type { NimiIntegrationManagement } from '@nimiplatform/sdk/app';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import type { IntegrationsPanelIntent } from '../integrations/integrations-panel.js';
import { INTEGRATION_SERVICES, IntegrationServiceIcon, serviceLabel } from '../integrations/integration-workspace.js';
import { useHomeRowCapacity } from './use-home-row-capacity.js';

/** App chips shown beside the authorization summary before a +N overflow. */
const HOME_AUTHORIZED_APP_SLOTS = 3;
// Tile geometry matches the Home apps row (w-[92px] + gap-1): only as many
// tiles as fit one row are rendered, measured from the row itself; the rest
// stay reachable through the more-services tile and the full panel.
const HOME_INTEGRATION_TILE_WIDTH = 92;
const HOME_INTEGRATION_TILE_GAP = 4;

const serviceTileClass =
  'flex w-[92px] flex-col items-center gap-2 rounded-2xl px-1 py-2.5 text-center transition-colors hover:bg-[var(--nimi-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]';

type HomeAuthorizedApp = {
  readonly consumerRef: string;
  readonly appId: string;
  readonly displayName: string;
};

/** Unique apps holding at least one allowed operation, in Runtime's permission order. */
function homeAuthorizedApps(snapshot: NimiIntegrationManagement, unavailableLabel: string): HomeAuthorizedApp[] {

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

// Home only projects Runtime-owned connections and permissions; management
// itself stays in the full Integrations destination this card routes to.
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
  const services = INTEGRATION_SERVICES.filter((kind) => kind !== 'app');
  const { ref: servicesRowRef, capacity: servicesRowCapacity } = useHomeRowCapacity({
    tileWidth: HOME_INTEGRATION_TILE_WIDTH,
    tileGap: HOME_INTEGRATION_TILE_GAP,
    limit: services.length + 1,
  });
  // The last tile of the single row is always the more-services entry.
  const shownServices = services.slice(0, Math.max(0, servicesRowCapacity - 1));
  const connectionCount = (kind: string) =>
    snapshot?.targets.filter((target) => target.kind === kind).length ?? 0;
  const authorizedApps = snapshot ? homeAuthorizedApps(snapshot, t('Integrations.unavailableApp')) : [];
  const shownApps = authorizedApps.slice(0, HOME_AUTHORIZED_APP_SLOTS);
  const hiddenAppCount = authorizedApps.length - shownApps.length;
  return (
    <section
      className="flex flex-col gap-3 rounded-[24px] bg-[var(--nimi-surface-panel)] p-5 shadow-[var(--nimi-home-card-elevation)]"
      data-testid="home-integrations"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('Integrations.title')}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button
            tone="ghost"
            size="sm"
            onClick={() => onOpen()}
            data-testid="home-integrations-enter"
          >
            {t('Integrations.homeEnter')}
          </Button>
        </div>
      </header>
      <div ref={servicesRowRef} className="flex flex-wrap gap-1">
        {shownServices.map((kind) => {
          const count = connectionCount(kind);
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onOpen({ service: kind })}
              className={serviceTileClass}
              data-testid={`home-integration-service:${kind}`}
              title={serviceLabel(kind, t)}
            >
              <IntegrationServiceIcon kind={kind} large />
              <span className="flex w-full flex-col items-center gap-0.5">
                <span className="w-full truncate text-xs font-medium">{serviceLabel(kind, t)}</span>
                {snapshot ? (
                  <span className="flex items-center gap-1 text-xs text-[var(--nimi-text-secondary)]">
                    <span
                      className={`size-1.5 rounded-full ${count ? 'bg-[var(--nimi-status-success)]' : 'bg-[var(--nimi-text-muted)]'}`}
                      aria-hidden="true"
                    />
                    {count
                      ? t('Integrations.homeConnectionCount', { count })
                      : t('Integrations.homeNotConnected')}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onOpen()}
          className={`${serviceTileClass} text-[var(--nimi-text-secondary)]`}
          data-testid="home-integrations-more-services"
        >
          <span className="flex size-14 items-center justify-center rounded-2xl border border-dashed border-[var(--nimi-border-subtle)]">
            <Plus size={20} aria-hidden="true" />
          </span>
          <span className="text-xs">{t('Integrations.homeMoreServices')}</span>
        </button>
      </div>
      {snapshot ? (
        <footer
          className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--nimi-border-subtle)] pt-4"
          data-testid="home-integrations-authorized"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-1.5 text-[13px] font-medium">
              <Sparkles size={15} className="text-[var(--nimi-action-primary-bg)]" aria-hidden="true" />
              {t('Integrations.homeAuthorizedSummary', { count: authorizedApps.length })}
            </span>
            {shownApps.map((app) => (
              <span
                key={app.consumerRef}
                className="flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--nimi-text-secondary)]"
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
    </section>
  );
}
