import { AppCardSurface, Button, InlineAlert, LoadingSkeleton, Tooltip } from '@nimiplatform/kit/ui';
import type { NimiIntegrationManagement } from '@nimiplatform/sdk/app';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import type { IntegrationsPanelIntent } from '../integrations/integrations-panel.js';
import {
  INTEGRATION_SERVICES,
  IntegrationServiceIcon,
  serviceLabel,
} from '../integrations/integration-workspace.js';
import { homeAuthorizedApps } from './home-integrations-card.js';

const HOME_INTEGRATION_PRIMARY_SERVICES = INTEGRATION_SERVICES.filter((kind) => kind !== 'app');
const HOME_AUTHORIZED_APP_SLOTS = 3;

export type HomeIntegrationsWorkbenchViewProps = {
  loading: boolean;
  unavailable: boolean;
  snapshot: NimiIntegrationManagement | null;
  appIconUrls: ReadonlyMap<string, string | null>;
  onOpen: (intent?: IntegrationsPanelIntent) => void;
};

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
// @nimi-authority: rule.nimi.desktop.shell-ui.r029
// @nimi-authority: rule.nimi.runtime.integration.fixed-operations
export function HomeIntegrationsWorkbenchView({
  loading,
  unavailable,
  snapshot,
  appIconUrls,
  onOpen,
}: HomeIntegrationsWorkbenchViewProps) {
  const { t } = useTranslation();
  const targets = snapshot?.targets ?? [];
  const activeConnectionCount = targets.length;
  const authorizedApps = snapshot ? homeAuthorizedApps(snapshot, t('Integrations.unavailableApp')) : [];

  const targetCountByKind = new Map<string, number>();
  for (const target of targets) {
    targetCountByKind.set(target.kind, (targetCountByKind.get(target.kind) ?? 0) + 1);
  }

  const extraActiveKinds = [...targetCountByKind.keys()].filter(
    (kind) => !HOME_INTEGRATION_PRIMARY_SERVICES.includes(kind as (typeof HOME_INTEGRATION_PRIMARY_SERVICES)[number]),
  );
  const serviceKinds: readonly string[] = [...HOME_INTEGRATION_PRIMARY_SERVICES, ...extraActiveKinds];

  const summaryText = loading || unavailable || !snapshot
    ? null
    : activeConnectionCount > 0 && authorizedApps.length > 0
      ? t('runtimeConfig.overview.integrationsWorkbench.connectedSummary', {
          connections: activeConnectionCount,
          apps: authorizedApps.length,
        })
      : activeConnectionCount > 0
        ? t('runtimeConfig.overview.integrationsWorkbench.connectedOnlySummary', {
            connections: activeConnectionCount,
          })
        : authorizedApps.length > 0
          ? t('runtimeConfig.overview.integrationsWorkbench.authorizedOnlySummary', {
              apps: authorizedApps.length,
            })
          : null;

  const shownApps = authorizedApps.slice(0, HOME_AUTHORIZED_APP_SLOTS);
  const hiddenAppCount = authorizedApps.length - shownApps.length;

  return (
    <AppCardSurface
      kind="operational-solid"
      className="flex h-full min-w-0 flex-col gap-4 rounded-3xl border-transparent! bg-[var(--nimi-home-porcelain-card)]! p-6 shadow-[var(--nimi-home-porcelain-shadow)]!"
      data-testid="home-integrations-workbench"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary)]">
            {t('Integrations.title')}
          </h2>
          {summaryText ? (
            <span
              className="text-xs tabular-nums text-[var(--nimi-text-secondary)]"
              data-testid="home-integrations-summary"
            >
              {summaryText}
            </span>
          ) : null}
        </div>
        <Button tone="ghost" size="sm" onClick={() => onOpen()} data-testid="home-integrations-open-all">
          {t('runtimeConfig.overview.integrationsWorkbench.manageAction')} →
        </Button>
      </header>

      {unavailable ? (
        <InlineAlert tone="warning">{t('Integrations.unavailable')}</InlineAlert>
      ) : null}

      {loading ? (
        <LoadingSkeleton lines={2} label={t('Common.loading')} />
      ) : (
        <div
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
          data-testid="home-integrations-services"
        >
          {serviceKinds.map((kind) => {
            const count = targetCountByKind.get(kind) ?? 0;
            const connected = count > 0;
            const label = serviceLabel(kind, t);
            const addLabel = t('runtimeConfig.overview.integrationsWorkbench.addServiceAria', {
              service: label,
            });
            return (
              <Tooltip key={kind} content={connected ? label : addLabel} placement="top">
                <button
                  type="button"
                  aria-label={connected ? undefined : addLabel}
                  onClick={() => onOpen({ service: kind })}
                  data-testid={`home-integration-service:${kind}`}
                  data-connected={connected ? 'true' : 'false'}
                  className={
                    connected
                      ? 'group/service relative flex min-w-0 cursor-pointer items-center gap-2.5 rounded-2xl border border-transparent bg-[var(--nimi-home-soft-well)] px-3 py-2.5 text-left transition-[transform,opacity,background-color,border-color,color] duration-150 hover:bg-[var(--nimi-home-soft-well-hover)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]'
                      : 'group/service relative flex min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-2xl border border-dashed border-[var(--nimi-border-strong)] bg-transparent px-2.5 py-2.5 text-left transition-[transform,opacity,background-color,border-color,color] duration-150 hover:border-solid hover:border-[var(--nimi-action-primary-bg)]/40 hover:bg-[var(--nimi-home-soft-well)] active:scale-[0.99] focus-visible:border-solid focus-visible:border-[var(--nimi-action-primary-bg)]/40 focus-visible:bg-[var(--nimi-home-soft-well)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]'
                  }
                >
                  <span className="relative inline-flex shrink-0">
                    <IntegrationServiceIcon
                      kind={kind}
                      className={
                        connected
                          ? 'shadow-[var(--nimi-elevation-base)]'
                          : 'opacity-55 transition-opacity duration-150 group-hover/service:opacity-100 group-focus-visible/service:opacity-100'
                      }
                    />
                    {connected ? (
                      <span
                        className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-[var(--nimi-status-success)] ring-2 ring-[var(--nimi-home-soft-well)]"
                        aria-hidden="true"
                      />
                    ) : null}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-xs transition-colors duration-150 ${
                      connected
                        ? 'font-medium text-[var(--nimi-text-primary)]'
                        : 'font-normal text-[var(--nimi-text-secondary)] group-hover/service:text-[var(--nimi-text-primary)] group-focus-visible/service:text-[var(--nimi-text-primary)]'
                    }`}
                  >
                    {label}
                  </span>
                  {connected ? (
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--nimi-status-success)]">
                      {count}
                    </span>
                  ) : (
                    <>
                      <span
                        aria-hidden="true"
                        className="inline-flex shrink-0 items-center justify-center text-[var(--nimi-text-muted)]/70 transition-opacity duration-150 group-hover/service:opacity-0 group-focus-visible/service:opacity-0"
                      >
                        <Plus size={12} />
                      </span>
                      <span
                        aria-hidden="true"
                        data-testid={`home-integration-add-hint:${kind}`}
                        className="pointer-events-none absolute inset-y-0 right-0 flex items-center bg-gradient-to-l from-[var(--nimi-home-soft-well)] via-[var(--nimi-home-soft-well)] via-75% to-transparent pr-2 pl-4 opacity-0 transition-opacity duration-150 group-hover/service:opacity-100 group-focus-visible/service:opacity-100"
                      >
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--nimi-action-primary-bg)] px-2 py-0.5 text-[11px] font-medium leading-4 text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)]">
                          <Plus size={11} strokeWidth={2.5} />
                          <span>{t('runtimeConfig.overview.integrationsWorkbench.addServiceAction')}</span>
                        </span>
                      </span>
                    </>
                  )}
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
        {authorizedApps.length > 0 ? (
          <button
            type="button"
            onClick={() => onOpen({ service: 'all-permissions' })}
            data-testid="home-integrations-permissions"
            className="flex min-w-0 items-center gap-2 text-left text-[var(--nimi-text-secondary)] transition-colors hover:text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
          >
            <span className="shrink-0 font-medium">
              {t('runtimeConfig.overview.integrationsWorkbench.authorizedAppsSummary', { count: authorizedApps.length })}
            </span>
            <span className="flex min-w-0 items-center gap-1">
              {shownApps.map((app) => (
                <AppArtworkIcon
                  key={app.consumerRef}
                  appId={app.appId}
                  displayName={app.displayName}
                  iconUrl={appIconUrls.get(app.appId) ?? null}
                  size="xs"
                />
              ))}
              {hiddenAppCount > 0 ? (
                <span className="text-[var(--nimi-text-muted)]">{`+${hiddenAppCount}`}</span>
              ) : null}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onOpen({ service: 'all-permissions' })}
            data-testid="home-integrations-permissions"
            className="min-w-0 truncate text-[var(--nimi-text-secondary)] transition-colors hover:text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
          >
            {t('runtimeConfig.overview.integrationsWorkbench.permissionsAction')}
          </button>
        )}

        <button
          type="button"
          onClick={() => onOpen({ service: 'all-calls' })}
          data-testid="home-integrations-calls"
          className="shrink-0 font-medium text-[var(--nimi-text-primary)] transition-colors hover:text-[var(--nimi-action-primary-bg)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
        >
          {t('runtimeConfig.overview.integrationsWorkbench.callsAction')} →
        </button>
      </footer>
    </AppCardSurface>
  );
}

export function HomeIntegrationsWorkbench({
  enabled,
  appIconUrls,
  onOpen,
}: {
  enabled: boolean;
  appIconUrls: ReadonlyMap<string, string | null>;
  onOpen: (intent?: IntegrationsPanelIntent) => void;
}) {
  const sdk = useDesktopRendererSdk();
  const authStatus = useAppStore((state) => state.auth.status);
  const canQuery = enabled && authStatus === 'authenticated';
  const management = useQuery({
    queryKey: ['nimi-overview', 'integration-management'],
    queryFn: () => sdk.appProduct().integration.getManagement(),
    enabled: canQuery,
    staleTime: 30_000,
    retry: false,
  });

  return (
    <HomeIntegrationsWorkbenchView
      loading={canQuery && management.isPending && !management.data}
      unavailable={management.isError}
      snapshot={management.data ?? null}
      appIconUrls={appIconUrls}
      onOpen={onOpen}
    />
  );
}
