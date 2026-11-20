import { useHomeNavigation, useHomeDestination } from '../../app-shell/providers/app-store.js';
import { IntegrationsPanel, type IntegrationsPanelIntent } from '../integrations/integrations-panel.js';
import { FieldTrigger, ScrollArea, Surface } from '@nimiplatform/kit/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SHELL_PAGE_WIDTH_CLASS } from '../../app-shell/layouts/shell-chrome-classes.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { invokeChecked } from '../../bridge/runtime-bridge/invoke.js';
import { formatBytes, formatTransferRate } from '../../components/download-format.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useDesktopRendererCommands, useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';
import { fetchLocalAgentList, localAgentListQueryKey } from '../agents/local-agent-list-model.js';
import { hasAvailableCatalogUpdate } from '../apps/apps-card-actions.js';
import { appIconUrlsForEntries } from '../apps/apps-entry-groups.js';
import { useAppsOverview } from '../apps/use-apps-overview.js';
import { useGlobalDownloads } from '../runtime-config/global-downloads-context.js';
import { capabilityPreparationState, useCapabilityInventory } from '../runtime-config/runtime-capability-inventory.js';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';
import { isDownloadTerminal } from '../runtime-config/runtime-config-model-center-utils.js';
import type { RuntimeAdvancedDiagnosticsPane } from '../runtime-config/runtime-config-state-types.js';
import { openHomeSettings } from '../settings/settings-entry.js';
import { useSystemEntryAI } from '../system-entry/system-entry-context.js';
import { SystemEntryDetails } from '../system-entry/system-entry-details.js';
import type { ExecutionNoticeAppArtworkResolver } from './execution-notices.js';
import { HomeActiveWorkCard, type HomeActiveDownloadItem } from './home-active-work-card.js';
import { HomeAgentCard } from './home-agent-card.js';
import { HomeAppsWorkbench } from './home-apps-workbench.js';
import { deriveHomeCapabilityMatrixItems, HomeCapabilityMatrixView } from './home-capability-matrix.js';
import { HomeDailySpendCard } from './home-daily-spend-card.js';
import { HomeGettingStarted } from './home-getting-started.js';
import { HomeHostStatusCard } from './home-host-status-card.js';
import { HomeIntegrationsCard } from './home-integrations-card.js';
import { homeRuntimeState } from './home-machine-status.js';
import type { HomeMessageCardContext } from './home-message-card.js';
import { HomeMessageCenter } from './home-message-center.js';
import { HomeMessagesColumn } from './home-messages-column.js';
import { useHomeMessages, type HomeMessages, type HomeSystemListing } from './home-messages-controller.js';
import { systemMessage, type HomeMessageFilter, type HomeSystemItemMessage } from './home-messages-model.js';
import { buildHomeQuickJumpItems, HomeQuickJumpModal } from './home-quick-jump-modal.js';
import { BUNDLED_ZHIYU_RECENT_KEY, recordHomeRecentAppOpen } from './home-recent-apps-model.js';

function greetingKey(hour: number): string {
  if (hour < 5) return 'runtimeConfig.overview.greetingNight';
  if (hour < 12) return 'runtimeConfig.overview.greetingMorning';
  if (hour < 18) return 'runtimeConfig.overview.greetingAfternoon';
  return 'runtimeConfig.overview.greetingEvening';
}

function normalizedGreetingName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'nimi user') return '';
  return trimmed;
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac/i.test(navigator.platform || navigator.userAgent || '');
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
  const ai = useSystemEntryAI();

  const authUser = useAppStore((state) => state.auth.user);
  const authStatus = useAppStore((state) => state.auth.status);
  const destination = useHomeDestination();
  const isOverviewActive = destination.id === 'home' && (destination.homeSection ?? 'overview') === 'overview';
  const inventory = useCapabilityInventory({ enabled: isOverviewActive });
  const downloads = useGlobalDownloads();
  const apps = useAppsOverview();

  const ownerUserId = String(authUser?.id || '').trim();
  const agents = useQuery({
    queryKey: localAgentListQueryKey(ownerUserId),
    queryFn: () => fetchLocalAgentList(ownerUserId, sdk),
    enabled: authStatus === 'authenticated' && Boolean(ownerUserId) && isOverviewActive,
    staleTime: 30_000,
  });

  const homeEntryDestination = destination.id === 'notification' ? 'center' : destination.homeSection ?? 'overview';
  const view = homeEntryDestination;
  const setView = (homeSection: 'overview' | 'integrations' | 'ai-activity') => void navigation.push({ id: 'home', homeSection });
  const centerFilter = destination.messageFilter ?? 'all';
  const centerSource = destination.messageSource ?? null;
  const setCenterFilter = (messageFilter: HomeMessageFilter) => { void navigation.replace({ id: 'notification', messageFilter, messageSource: centerSource ?? undefined }); };
  const setCenterSource = (messageSource: string | null) => { void navigation.replace({ id: 'notification', messageFilter: centerFilter, messageSource: messageSource ?? undefined }); };
  const [integrationIntent, setIntegrationIntent] = useState<IntegrationsPanelIntent | null>(null);
  const [quickJumpOpen, setQuickJumpOpen] = useState(false);

  useEffect(() => {
    if (!isOverviewActive) {
      setQuickJumpOpen(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuickJumpOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOverviewActive]);

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
  const activeDownloadItems: HomeActiveDownloadItem[] = activeTransfers.map((item) => ({
    id: item.installSessionId,
    title: item.sourceLabel || item.modelAssetId || item.installSessionId,
    bytesReceived: item.bytesReceived + item.bytesReused,
    bytesTotal: downloads?.transferStatus === 'ready' && item.bytesTotal ? item.bytesTotal : null,
    speedBytesPerSec: item.speedBytesPerSec,
  }));

  const displayName = normalizedGreetingName(authUser ? String(authUser.displayName || authUser.handle || '') : '');
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
  const effectiveTextState = inventory.isPending ? 'unknown' : textPreparation.state;
  const isTextReady = effectiveTextState === 'ready' || prepared.length > 0;

  const capabilityMatrixItems = useMemo(
    () =>
      deriveHomeCapabilityMatrixItems({
        inventory: inventory.data,
        tasks: inventory.tasks,
        unavailable: inventory.isError,
      }),
    [inventory.data, inventory.tasks, inventory.isError],
  );

  const openApp = (appId: string, entryKey: string) => {
    recordHomeRecentAppOpen(messagesAccountKey, appId);
    void navigation.push({ id: 'apps', appId, appEntryKey: entryKey });
  };
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
  const openZhiyu = () => {
    recordHomeRecentAppOpen(messagesAccountKey, BUNDLED_ZHIYU_RECENT_KEY);
    void invokeChecked('bundled_zhiyu_open', {}, (value) => {
      if (!value || typeof value !== 'object' || !('opened' in value) || value.opened !== true) {
        throw new Error('bundled-zhiyu-open-invalid');
      }
      return value;
    }).catch(() => emitFeedbackToast({ kind: 'error', message: t('Apps.bundled.openFailed') }));
  };

  const quickJumpItems = useMemo(
    () =>
      buildHomeQuickJumpItems({
        t,
        apps: entries,
        partners: agents.data ?? [],
        capabilities: inventory.capabilities,
        actions: {
          onOpenZhiyu: openZhiyu,
          onOpenApp: openApp,
          onOpenPartner: (localAgentRef) => void navigation.push({ id: 'contacts', partnerChat: { localAgentRef } }),
          onOpenCapability: (capabilityContract) =>
            void navigation.push({ id: 'runtime', runtime: { page: 'aiSettings', capabilityContract } }),
          onOpenChat: openChat,
          onOpenExplore: () => void navigation.push({ id: 'explore', exploreSearchKind: 'characters' }),
          onOpenApps: () => void navigation.push({ id: 'apps' }),
          onOpenModelLibrary: () => void navigation.push({ id: 'runtime', runtime: { page: 'modelLibrary' } }),
          onOpenAIProfiles: () => void navigation.push({ id: 'runtime', runtime: { page: 'aiSettings', section: 'saved' } }),
          onOpenCloud: () => void navigation.push({ id: 'cloud' }),
          onOpenConnections: () => void navigation.push({ id: 'connections' }),
          onOpenIntegrations: () => openIntegrations(),
          onOpenDownloads: () => void navigation.push({ id: 'downloads' }),
          onOpenAIActivity: () => setView('ai-activity'),
          onOpenTroubleshooting: () => void openHomeSettings(navigation, 'troubleshooting'),
          onOpenDataStorage: () => void openHomeSettings(navigation, 'data'),
        },
      }),
    [t, entries, agents.data, inventory.capabilities, navigation],
  );

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

  const appsUnavailable = Boolean(
    apps.isError
    || apps.data?.status === 'error'
    || (apps.data?.status === 'loaded' && (apps.data.catalogStatus === 'unavailable' || apps.data.runtimeError)),
  );

  const onboardingSection = messagesAccountKey ? (
    <HomeGettingStarted
      key={`onboarding:${messagesAccountKey}`}
      accountKey={messagesAccountKey}
      textPreparation={effectiveTextState}
      onOpenAI={() => void navigation.push({ id: 'runtime' })}
      onOpenCloud={() => void navigation.push({ id: 'cloud' })}
      onOpenChat={openChat}
      onExplore={() => void navigation.push({ id: 'explore', exploreSearchKind: 'characters' })}
      onOpenApps={() => void navigation.push({ id: 'apps' })}
    />
  ) : null;

  const shortcutText = t(
    isMacPlatform()
      ? 'runtimeConfig.overview.quickJump.shortcutMac'
      : 'runtimeConfig.overview.quickJump.shortcutWin',
  );

  const runtimeState = homeRuntimeState(health);
  const runtimeDotClass = runtimeState === 'ready'
    ? 'bg-[var(--nimi-status-success)]'
    : runtimeState === 'attention'
      ? 'bg-[var(--nimi-status-warning)]'
      : runtimeState === 'unavailable'
        ? 'bg-[var(--nimi-status-danger)]'
        : 'bg-[var(--nimi-text-muted)]';
  const runtimeLabelKey = runtimeState === 'ready'
    ? 'runtimeConfig.overview.runtimeReady'
    : runtimeState === 'attention'
      ? 'runtimeConfig.overview.runtimeNotReady'
      : runtimeState === 'unavailable'
        ? 'runtimeConfig.overview.runtimeUnavailable'
        : 'runtimeConfig.overview.runtimeChecking';

  const renderOverview = (messages: HomeMessages | null) => (
    <div className="flex min-w-0 flex-col gap-4" data-testid="home-overview-root">
      <Surface
        as="header"
        tone="hero"
        elevation="raised"
        padding="none"
        className="flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-4"
        data-testid="home-hero-header"
      >
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="min-w-0 text-2xl font-bold leading-tight tracking-tight text-[var(--nimi-text-primary)]">
              {displayName
                ? t('runtimeConfig.overview.greetingWithName', { greeting: t(greetingKey(now.getHours())), name: displayName })
                : t(greetingKey(now.getHours()))}
            </h1>
            <p className="text-xs font-medium text-[var(--nimi-text-secondary)]" data-testid="home-date">
              {i18n.formatDate(now, { month: 'long', day: 'numeric', weekday: 'long' })}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openDiagnostics('services')}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-1 text-xs font-medium text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)] transition-colors hover:border-[var(--nimi-border-strong)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              <span className={`size-2 shrink-0 rounded-full ${runtimeDotClass}`} aria-hidden="true" />
              <span>{t(runtimeLabelKey)}</span>
            </button>

            {!inventory.isPending && !inventory.isError ? (
              <button
                type="button"
                onClick={() => void navigation.push({ id: 'runtime' })}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-1 text-xs font-medium text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)] transition-colors hover:border-[var(--nimi-border-strong)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
              >
                <Sparkles size={12} aria-hidden="true" className="text-[var(--nimi-action-primary-bg)]" />
                <span>{t('runtimeConfig.overview.statusCapabilities', { count: prepared.length })}</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={openChat}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--nimi-action-primary-bg)] px-3 py-1 text-xs font-semibold text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              <span>{t('runtimeConfig.overview.firstRun.chat.action')}</span>
              <ArrowRight size={12} aria-hidden="true" />
            </button>
          </div>
        </div>

        <FieldTrigger
          onClick={() => setQuickJumpOpen(true)}
          data-testid="home-quick-jump-trigger"
          className="w-full justify-between sm:w-80"
        >
          <span className="flex min-w-0 items-center gap-2 truncate text-xs text-[var(--nimi-text-secondary)]">
            <Search size={14} aria-hidden="true" className="shrink-0 text-[var(--nimi-action-primary-bg)]" />
            <span className="truncate">{t('runtimeConfig.overview.quickJump.trigger')}</span>
          </span>
          <kbd className="shrink-0 rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-1.5 py-0.5 font-mono text-[11px] font-medium text-[var(--nimi-text-secondary)]">
            {shortcutText}
          </kbd>
        </FieldTrigger>
      </Surface>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_350px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          {!inventory.isPending && !inventory.preparationPending && !isTextReady ? onboardingSection : null}

          <HomeActiveWorkCard
            entries={entries}
            iconUrls={iconUrls}
            ai={ai}
            downloads={activeDownloadItems}
            onOpenApp={openApp}
            onOpenActivity={() => setView('ai-activity')}
            onOpenDownloads={() => void navigation.push({ id: 'downloads' })}
          />

          <HomeAppsWorkbench
            key={`apps-dock:${messagesAccountKey ?? 'device'}`}
            accountKey={messagesAccountKey}
            entries={entries}
            iconUrls={iconUrls}
            loading={apps.isPending}
            unavailable={appsUnavailable}
            onOpenAllApps={() => void navigation.push({ id: 'apps' })}
            onOpenApp={openApp}
          />

          <HomeAgentCard onOpenAssistantChat={openChat} />

          <HomeCapabilityMatrixView
            loading={inventory.isPending && !inventory.data}
            failed={inventory.isError}
            readyCount={prepared.length}
            items={capabilityMatrixItems}
            onSelectCapability={(capabilityContract) =>
              void navigation.push({ id: 'runtime', runtime: { page: 'aiSettings', capabilityContract } })
            }
            onOpenProfiles={() =>
              void navigation.push({ id: 'runtime', runtime: { page: 'aiSettings', section: 'saved' } })
            }
            onOpenCloud={() => void navigation.push({ id: 'cloud' })}
            onOpenAllCapabilities={() => void navigation.push({ id: 'runtime' })}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <HomeDailySpendCard
            onOpenDetails={() => setView('ai-activity')}
            onOpenCloud={() => void navigation.push({ id: 'cloud' })}
          />

          <HomeHostStatusCard
            runtime={runtimeState}
            onOpenDiagnostics={openDiagnostics}
            onOpenConnections={() => void navigation.push({ id: 'connections' })}
            onOpenStorage={() => void openHomeSettings(navigation, 'data')}
          />

          {messages ? (
            <HomeMessagesColumn
              messages={messages}
              context={cardContext(messages)}
              appArtworkForNotice={appArtworkForNotice}
              onViewAll={() => openCenter('all')}
            />
          ) : null}

          <HomeIntegrationsCard appIconUrls={iconUrls} onOpen={openIntegrations} />
        </div>
      </div>

      <HomeQuickJumpModal
        open={quickJumpOpen}
        onClose={() => setQuickJumpOpen(false)}
        items={quickJumpItems}
      />
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
        <ScrollArea
          className="min-h-0 flex-1"
          viewportClassName="bg-transparent [&>div]:!block"
          contentClassName={`${SHELL_PAGE_WIDTH_CLASS} pb-6 pt-3 lg:pt-4`}
        >
          {renderOverview(messages)}
        </ScrollArea>
      )}
    </div>
  );

  return messagesAccountKey ? (
    <HomeMessagesScope key={messagesAccountKey} systemMessages={systemMessages} systemSources={systemSources}>
      {renderPage}
    </HomeMessagesScope>
  ) : renderPage(null);
}
