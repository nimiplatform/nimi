import { useHomeNavigation, useHomeDestination } from '../../app-shell/providers/app-store.js';
import { IntegrationsPanel, type IntegrationsPanelIntent } from '../integrations/integrations-panel.js';
import { Button, InlineAlert, LoadingSkeleton, ScrollArea } from '@nimiplatform/kit/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SHELL_PAGE_WIDTH_CLASS } from '../../app-shell/layouts/shell-chrome-classes.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { formatBytes, formatTransferRate } from '../../components/download-format.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useDesktopRendererCommands, useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { hasAvailableCatalogUpdate } from '../apps/apps-card-actions.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import { BundledZhiyuEntry } from '../apps/bundled-zhiyu-entry.js';
import { appIconUrlsForEntries } from '../apps/apps-entry-groups.js';
import { useAppsOverview } from '../apps/use-apps-overview.js';
import { useGlobalDownloads } from '../runtime-config/global-downloads-context.js';
import { capabilityPreparationState, useCapabilityInventory } from '../runtime-config/runtime-capability-inventory.js';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';
import { isDownloadTerminal } from '../runtime-config/runtime-config-model-center-utils.js';
import type { RuntimeAdvancedDiagnosticsPane } from '../runtime-config/runtime-config-state-types.js';
import { HomeAgentCard } from './home-agent-card.js';
import { HomeGettingStarted } from './home-getting-started.js';
import { HomeIntegrationsCard } from './home-integrations-card.js';
import { HomeMachineStatus, homeRuntimeState } from './home-machine-status.js';
import type { ExecutionNoticeAppArtworkResolver } from './execution-notices.js';
import type { HomeMessageCardContext } from './home-message-card.js';
import { HomeMessageCenter } from './home-message-center.js';
import { HomeMessagesColumn } from './home-messages-column.js';
import { useHomeMessages, type HomeMessages, type HomeSystemListing } from './home-messages-controller.js';
import { systemMessage, type HomeMessageFilter, type HomeSystemItemMessage } from './home-messages-model.js';
import { SystemEntryDetails } from '../system-entry/system-entry-details.js';

const HOME_APP_LIMIT = 8;

function greetingKey(hour: number): string {
  if (hour < 5) return 'runtimeConfig.overview.greetingNight';
  if (hour < 12) return 'runtimeConfig.overview.greetingMorning';
  if (hour < 18) return 'runtimeConfig.overview.greetingAfternoon';
  return 'runtimeConfig.overview.greetingEvening';
}

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {action && onAction ? (
        <Button tone="ghost" size="sm" onClick={onAction}>
          {action}
        </Button>
      ) : null}
    </div>
  );
}

/** Holds one account's message consumption layer for both Home views. */
function HomeMessagesScope({ systemMessages, systemSources, children }: {
  systemMessages: readonly HomeSystemItemMessage[];
  systemSources: readonly HomeSystemListing[];
  children: (messages: HomeMessages) => ReactNode;
}) {
  const messages = useHomeMessages({ systemMessages, systemSources });
  return <>{children(messages)}</>;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
export function NimiOverview() {

  const navigation = useHomeNavigation();
  const { t } = useTranslation();
  const i18n = useDesktopI18nResource();
  const sdk = useDesktopRendererSdk();
  const commands = useDesktopRendererCommands();

  const authUser = useAppStore((state) => state.auth.user);
  const authStatus = useAppStore((state) => state.auth.status);
  const destination = useHomeDestination();
  const inventory = useCapabilityInventory({ enabled: destination.id === 'home' && (destination.homeSection ?? 'overview') === 'overview' });
  const downloads = useGlobalDownloads();
  const apps = useAppsOverview();
  const homeEntryDestination = destination.id === 'notification' ? 'center' : destination.homeSection ?? 'overview';
  const view = homeEntryDestination;
  const setView = (homeSection: 'overview' | 'integrations' | 'ai-activity') => void navigation.push({ id: 'home', homeSection });
  const centerFilter = destination.messageFilter ?? 'all';
  const centerSource = destination.messageSource ?? null;
  const setCenterFilter = (messageFilter: HomeMessageFilter) => { void navigation.replace({ id: 'notification', messageFilter, messageSource: centerSource ?? undefined }); };
  const setCenterSource = (messageSource: string | null) => { void navigation.replace({ id: 'notification', messageFilter: centerFilter, messageSource: messageSource ?? undefined }); };
  const [integrationIntent, setIntegrationIntent] = useState<IntegrationsPanelIntent | null>(null);
  const openIntegrations = (intent?: IntegrationsPanelIntent) => {
    setIntegrationIntent(intent ?? null);
    void navigation.push({ id: 'home', homeSection: 'integrations' });
  };
  const health = useQuery({
    queryKey: ['nimi-overview', 'runtime-health'],
    queryFn: () => sdk.machineProduct().audit.getRuntimeHealth({}),
    staleTime: 15_000,
  });
  const entries = apps.data?.status === 'loaded' ? apps.data.entries : [];
  const iconUrls = appIconUrlsForEntries(entries);
  const unique = [
    ...new Map(
      entries
        .filter((entry) => entry.committedRelease || entry.localDevelopment)
        .sort(
          (left, right) =>
            Number(hasAvailableCatalogUpdate(left)) - Number(hasAvailableCatalogUpdate(right)) ||
            Number(Boolean(left.committedRelease)) - Number(Boolean(right.committedRelease)),
        )
        .map((entry) => [entry.identity.appId, entry]),
    ).values(),
  ];
  const updates = unique.filter(hasAvailableCatalogUpdate);
  const prepared = inventory.capabilities.filter((capability) =>
    capabilityPreparationState({
      capability,
      inventory: inventory.data,
      tasks: inventory.tasks,
      unavailable: inventory.isError,
    }).state === 'ready',
  );
  const failed = inventory.tasks.filter(
    (task) => task.status === 'failed' || task.status === 'needs-attention',
  );
  const activeTransfers = downloads?.transfers.filter((item) => !isDownloadTerminal(item.state)) ?? [];
  const displayName = authUser ? String(authUser.displayName || authUser.handle || '') : '';
  // Messages belong to one account; a different account remounts their scope
  // so the previous projection, subscriptions and display preferences are
  // dropped. A token refresh keeps the same account and scope.
  const messagesAccountKey = (authStatus === 'authenticated' || authStatus === 'refresh-pending') && authUser?.id
    ? JSON.stringify([authUser.realmEnvironmentId, authUser.id])
    : null;
  const now = new Date();
  const textPreparation = capabilityPreparationState({
    capability: 'text.generate',
    inventory: inventory.data,
    tasks: inventory.tasks,
    unavailable: inventory.isError,
  });
  const openApp = (appId: string, entryKey: string) => {
    void navigation.push({ id: 'apps', appId, appEntryKey: entryKey });
  };
  // Publish the intent, then switch tabs so the runtime panel controller
  // mounts and applies it (it is not mounted on Home).
  const openDiagnostics = (pane: RuntimeAdvancedDiagnosticsPane) => {
    commands.runtimeConfigNavigation.openPage('advancedDiagnostics', { pane });

  };
  const openChat = () => {
    void navigation.push({ id: 'chat', chat: { mode: 'ai', targetId: 'ai:assistant' } });
  };
  const openMessageSettings = () => {
    void navigation.push({ id: 'settings', settingsSection: 'notifications' });
  };
  const openCenter = (filter: HomeMessageFilter) => {
    void navigation.push({ id: 'notification', messageFilter: filter });
  };
  const systemSources: HomeSystemListing[] = [
    { kind: 'download', status: downloads?.transferStatus ?? 'unavailable', retry: downloads?.refresh },
    { kind: 'update', status: apps.updatesStatus, retry: apps.refreshUpdates },
  ];
  const systemMessages: HomeSystemItemMessage[] = [
    ...activeTransfers.map((item) => systemMessage({
      kind: 'download',
      id: item.installSessionId,
      title: item.sourceLabel || item.modelAssetId || item.installSessionId,
      detail: downloads?.transferStatus === 'unavailable' ? t('runtimeConfig.downloads.readFailed') : [
        item.bytesTotal ? `${formatBytes(item.bytesReceived + item.bytesReused)} / ${formatBytes(item.bytesTotal)}` : formatBytes(item.bytesReceived + item.bytesReused),
        formatTransferRate(item.speedBytesPerSec),
      ].filter(Boolean).join(' · '),
      progress: downloads?.transferStatus === 'ready' && item.bytesTotal ? { value: item.bytesReceived + item.bytesReused, max: item.bytesTotal } : null,
      time: item.createdAt || null,
      app: null,
      open: () => navigation.push({ id: 'downloads' }),
    })),
    ...failed.map((task) => systemMessage({
      kind: 'setup',
      id: task.taskId,
      title: t('runtimeConfig.overview.setupFailed', { capability: displayRuntimeConfigCapabilityLabel(task.capabilityContract, t) }),
      detail: t('runtimeConfig.overview.messages.setupNeedsReview'),
      progress: null,
      time: task.updatedAt || null,
      app: null,
      open: () => {
        commands.runtimeConfigNavigation.openSetupTask(task.taskId);

      },
    })),
    ...updates.map((entry) => systemMessage({
      kind: 'update',
      id: entry.identity.appId,
      title: t('runtimeConfig.overview.messages.system.updateTitle', { app: entry.identity.displayName }),
      detail: entry.catalogTarget?.version ? t('runtimeConfig.overview.messages.system.updateDetail', { version: entry.catalogTarget.version }) : '',
      progress: null,
      time: null,
      app: { appId: entry.identity.appId, displayName: entry.identity.displayName, iconUrl: iconUrls.get(entry.identity.appId) ?? null },
      open: () => openApp(entry.identity.appId, entry.identity.entryKey),
    })),
  ];
  const appArtworkForNotice: ExecutionNoticeAppArtworkResolver = (noticeDisplayName) => {
    const matches = entries.filter((entry) => entry.identity.displayName === noticeDisplayName);
    if (new Set(matches.map((entry) => entry.identity.appId)).size !== 1) return null;
    const entry = matches[0]!;
    return { appId: entry.identity.appId, iconUrl: iconUrls.get(entry.identity.appId) ?? null };
  };
  const cardContext = (messages: HomeMessages): HomeMessageCardContext => ({
    now,
    busy: { ...messages.app.busy, ...messages.realm.busy },
    notices: { ...messages.app.notices, ...Object.fromEntries(Object.entries(messages.realm.errors).map(([id, text]) => [id, { tone: 'warning' as const, text }])) },
    appIconUrl: (appId) => (appId ? iconUrls.get(appId) ?? null : null),
    canHide: messages.preferences.state.status === 'ready' && !messages.preferences.saving,
    onOpen: messages.open,
    onMarkRead: messages.markRead,
    onHide: messages.hide,
  });

  const heading = (
    <h1 className="min-w-0 text-2xl font-semibold leading-tight tracking-tight text-[var(--nimi-text-primary)] lg:text-[28px]">
      {displayName
        ? t('runtimeConfig.overview.greetingWithName', { greeting: t(greetingKey(now.getHours())), name: displayName })
        : t(greetingKey(now.getHours()))}
    </h1>
  );
  // Capability readiness stays visible here (r015) now that the capability grid
  // is gone; the segment doubles as the entry to AI capability management.
  const status = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 px-2 text-xs text-[var(--nimi-text-secondary)]" data-testid="home-status-line">
      {inventory.isError ? (
        <span>{t('runtimeConfig.capabilities.readFailed')}</span>
      ) : inventory.isPending || inventory.preparationPending ? null : (
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-0.5 rounded-md font-medium text-[var(--nimi-action-primary-bg)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
          onClick={() => navigation.push({ id: 'runtime' })}
          data-testid="home-status-capabilities"
        >
          {t('runtimeConfig.overview.statusCapabilities', { count: prepared.length })}
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      )}
      {downloads?.activeCount ? (
        <>
          <span className="text-[var(--nimi-text-muted)]">·</span>
          <button
            type="button"
            className="min-h-9 rounded-md text-[var(--nimi-action-primary-bg)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            onClick={() => navigation.push({ id: 'downloads' })}
          >
            {t('runtimeConfig.overview.statusDownloading', { count: downloads.activeCount })}
          </button>
        </>
      ) : null}
      {health.isError ? (
        <>
          <span className="text-[var(--nimi-text-muted)]">·</span>
          <button
            type="button"
            className="rounded-md text-[var(--nimi-status-warning)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            onClick={() => openDiagnostics('services')}
          >
            {t('runtimeConfig.overview.runtimeUnavailable')}
          </button>
        </>
      ) : null}
      {!inventory.isError && inventory.isPending && !activeTransfers.length && !health.isError ? (
        <span>{t('runtimeConfig.overview.runtimeChecking')}</span>
      ) : null}
    </div>
  );

  const renderOverview = (messages: HomeMessages | null) => (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-x-8">
      <div className="flex min-w-0 flex-col gap-4">
        <header className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1">
          {heading}
          <p className="text-sm text-[var(--nimi-text-secondary)]" data-testid="home-date">
            {i18n.formatDate(now, { month: 'long', day: 'numeric', weekday: 'long' })}
          </p>
        </header>
        <HomeAgentCard />
        {messagesAccountKey ? (
          <HomeGettingStarted
            key={messagesAccountKey}
            accountKey={messagesAccountKey}
            textPreparation={inventory.isPending ? 'unknown' : textPreparation.state}
            onOpenAI={() => void navigation.push({ id: 'runtime' })}
            onOpenCloud={() => void navigation.push({ id: 'cloud' })}
            onOpenChat={openChat}
            onExplore={() => void navigation.push({ id: 'explore', exploreSearchKind: 'characters' })}
            onOpenApps={() => void navigation.push({ id: 'apps' })}
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {messages ? (
          <HomeMessagesColumn
            messages={messages}
            context={cardContext(messages)}
            appArtworkForNotice={appArtworkForNotice}
            onViewAll={() => openCenter('all')}
          />
        ) : null}
        <section className="flex min-w-0 flex-col gap-2 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4" data-testid="home-apps">
          <SectionHeader
            title={t('runtimeConfig.overview.apps')}
            action={t('runtimeConfig.overview.allApps')}
            onAction={() => navigation.push({ id: 'apps' })}
          />
          <BundledZhiyuEntry />
          {apps.isError ||
          apps.data?.status === 'error' ||
          (apps.data?.status === 'loaded' &&
            (apps.data.catalogStatus === 'unavailable' || apps.data.runtimeError)) ? (
            <InlineAlert tone="warning">{t('runtimeConfig.overview.appsUnavailable')}</InlineAlert>
          ) : null}
          {apps.isPending ? <LoadingSkeleton lines={2} label={t('Common.loading')} /> : null}
          {unique.length ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-1">
              {unique.slice(0, HOME_APP_LIMIT).map((entry) => {
                const update = hasAvailableCatalogUpdate(entry);
                return (
                  <button
                    key={entry.identity.appId}
                    type="button"
                    className="flex min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium hover:bg-[var(--nimi-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                    onClick={() => openApp(entry.identity.appId, entry.identity.entryKey)}
                    data-testid={`home-app:${entry.identity.appId}`}
                  >
                    <AppArtworkIcon appId={entry.identity.appId} displayName={entry.identity.displayName} iconUrl={iconUrls.get(entry.identity.appId) ?? null} size="xl" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{entry.identity.displayName}</span>
                      {update ? <span className="flex items-center gap-1 text-xs text-[var(--nimi-action-primary-bg)]"><ArrowUp size={12} aria-hidden="true" />{t('runtimeConfig.overview.updateTag')}</span> : null}
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
      <div className="min-w-0 lg:col-span-2">
        <HomeIntegrationsCard appIconUrls={iconUrls} onOpen={openIntegrations} />
      </div>
    </div>
  );

  const renderPage = (messages: HomeMessages | null) => view === 'ai-activity' ? (
    <SystemEntryDetails onBack={() => setView('overview')} />
  ) : view === 'integrations' ? (
    <IntegrationsPanel
      appIconUrls={iconUrls}
      intent={integrationIntent}
      onIntentConsumed={() => setIntegrationIntent(null)}
    />
  ) : (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      {view === 'center' && messages ? (
        <HomeMessageCenter
          messages={messages}
          context={cardContext(messages)}
          appArtworkForNotice={appArtworkForNotice}
          filter={centerFilter}
          sourceKey={centerSource}
          onFilterChange={setCenterFilter}
          onSourceChange={setCenterSource}
          onBack={() => setView('overview')}
          onOpenSettings={openMessageSettings}
        />
      ) : (
        <>
          <ScrollArea
            className="min-h-0 flex-1"
            viewportClassName="bg-transparent [&>div]:!block"
            contentClassName={`${SHELL_PAGE_WIDTH_CLASS} pb-6 pt-4 lg:pt-6`}
          >
            {renderOverview(messages)}
          </ScrollArea>
          <footer className={`${SHELL_PAGE_WIDTH_CLASS} z-20 shrink-0 pt-2`} data-testid="home-status-dock">
            <HomeMachineStatus
              runtime={homeRuntimeState(health)}
              capabilities={status}
              onOpenDiagnostics={openDiagnostics}
              onOpenUsage={() => setView('ai-activity')}
            />
          </footer>
        </>
      )}
    </div>
  );

  return messagesAccountKey ? (
    <HomeMessagesScope key={messagesAccountKey} systemMessages={systemMessages} systemSources={systemSources}>
      {renderPage}
    </HomeMessagesScope>
  ) : renderPage(null);
}
