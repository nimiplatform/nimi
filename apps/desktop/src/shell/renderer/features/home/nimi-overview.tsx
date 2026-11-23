import { useHomeNavigation, useHomeDestination } from '../../app-shell/providers/app-store.js';
import { IntegrationsPanel, type IntegrationsPanelIntent } from '../integrations/integrations-panel.js';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { useQuery } from '@tanstack/react-query';
import { Bell, Search } from 'lucide-react';
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
import { useSystemResources } from '../runtime-config/runtime-config-system-resources.js';
import { useHomePrimaryRuntimeQuery, useHomeRemoteAccessQuery } from '../settings/home-remote-access-query.js';
import { openHomeSettings } from '../settings/settings-entry.js';
import { useSystemEntry, useSystemEntryAI } from '../system-entry/system-entry-context.js';
import { SystemEntryDetails } from '../system-entry/system-entry-details.js';
import type { ExecutionNoticeAppArtworkResolver } from './execution-notices.js';
import { activeExecutionsFromAI, type HomeActiveDownloadItem } from './home-active-work-card.js';
import { HomeAmbientStatusStrip } from './home-ambient-status-strip.js';
import { HomeAppsWorkbench } from './home-apps-workbench.js';
import { HomeAttentionStrip, type HomeAttentionItem } from './home-attention-strip.js';
import { resolveHomeGreetingName } from './home-greeting-model.js';
import { deriveHomeRemoteSummary } from './home-host-status-card.js';
import { HOME_RESOURCE_WARN_PERCENT, homeRuntimeState } from './home-machine-status.js';
import type { HomeMessageCardContext } from './home-message-card.js';
import { HomeMessageCenter } from './home-message-center.js';
import { pendingSummary } from './home-messages-column.js';
import { useHomeMessages, type HomeMessages, type HomeSystemListing } from './home-messages-controller.js';
import { HomeMessagesDrawer } from './home-messages-drawer.js';
import {
  setHomeMessagesDrawerOpen,
  toggleHomeMessagesDrawer,
  useHomeMessagesDrawerOpen,
} from './home-messages-drawer-state.js';
import {
  isUnreadMessage,
  systemMessage,
  type HomeMessageFilter,
  type HomeSystemItemMessage,
} from './home-messages-model.js';
import { HomePartnersHeroCard } from './home-partners-hero-card.js';
import { buildHomeQuickJumpItems, HomeQuickJumpModal } from './home-quick-jump-modal.js';
import { HomeQuickStartBar } from './home-quick-start-bar.js';
import { BUNDLED_ZHIYU_RECENT_KEY, recordHomeRecentAppOpen } from './home-recent-apps-model.js';

const HOME_RESOURCE_POLL_MS = 15_000;

function greetingKey(hour: number): string {
  if (hour < 5) return 'runtimeConfig.overview.greetingNight';
  if (hour < 12) return 'runtimeConfig.overview.greetingMorning';
  if (hour < 18) return 'runtimeConfig.overview.greetingAfternoon';
  return 'runtimeConfig.overview.greetingEvening';
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac/i.test(navigator.platform || navigator.userAgent || '');
}

function percentOf(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (used / total) * 100));
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
  const { hostContext } = useSystemEntry();
  const ai = useSystemEntryAI();
  const focusGeneration = hostContext?.state === 'ready' ? hostContext.generation : null;

  const authUser = useAppStore((state) => state.auth.user);
  const authStatus = useAppStore((state) => state.auth.status);
  const setPendingNimiComposerPrefill = useAppStore((state) => state.setPendingNimiComposerPrefill);
  const destination = useHomeDestination();
  const isOverviewActive = destination.id === 'home' && (destination.homeSection ?? 'overview') === 'overview';
  const inventory = useCapabilityInventory({ enabled: isOverviewActive });
  const downloads = useGlobalDownloads();
  const apps = useAppsOverview();
  const resources = useSystemResources(HOME_RESOURCE_POLL_MS);
  const primaryRuntime = useHomePrimaryRuntimeQuery();
  const remoteAccess = useHomeRemoteAccessQuery();

  const ownerUserId = String(authUser?.id || '').trim();
  const agents = useQuery({
    queryKey: localAgentListQueryKey(ownerUserId),
    queryFn: () => fetchLocalAgentList(ownerUserId, sdk),
    enabled: authStatus === 'authenticated' && Boolean(ownerUserId) && isOverviewActive,
    staleTime: 30_000,
  });

  const integrationsQuery = useQuery({
    queryKey: ['nimi-overview', 'integration-management'],
    queryFn: () => sdk.appProduct().integration.getManagement(),
    enabled: isOverviewActive && authStatus === 'authenticated',
    staleTime: 30_000,
    retry: false,
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
  const messagesDrawerOpen = useHomeMessagesDrawerOpen();

  useEffect(() => {
    if (!isOverviewActive) {
      setQuickJumpOpen(false);
      setHomeMessagesDrawerOpen(false);
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
  const activeDownloads: HomeActiveDownloadItem[] = activeTransfers.map((item) => ({
    id: item.installSessionId,
    title: item.sourceLabel || item.modelAssetId || item.installSessionId,
    bytesReceived: item.bytesReceived + item.bytesReused,
    bytesTotal: item.bytesTotal ?? null,
    speedBytesPerSec: item.speedBytesPerSec,
  }));
  const activeExecutions = activeExecutionsFromAI(ai);

  const displayName = resolveHomeGreetingName(authUser);
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
  const textNeedsSetup = !inventory.isPending
    && !inventory.preparationPending
    && !inventory.isError
    && (effectiveTextState === 'unset' || effectiveTextState === 'attention');

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
  const submitChatDraft = (text: string) => {
    setPendingNimiComposerPrefill(text);
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
          onOpenAIProfiles: () => void navigation.push({ id: 'runtime', runtime: { page: 'aiSettings' } }),
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
    onOpen: (message) => {
      setHomeMessagesDrawerOpen(false);
      messages.open(message);
    },
    onMarkRead: messages.markRead,
    onHide: messages.hide,
  });

  // Remote catalog offline does not invalidate installed local apps on this device.
  const localAppsUnavailable = Boolean(
    apps.isError
    || apps.data?.status === 'error'
    || (apps.data?.status === 'loaded' && Boolean(apps.data.runtimeError)),
  );

  const remoteSummary = deriveHomeRemoteSummary({
    primarySuccess: primaryRuntime.isSuccess,
    primaryData: primaryRuntime.data,
    remoteData: remoteAccess.isSuccess ? remoteAccess.data : undefined,
  });
  const activeIntegrationCount = integrationsQuery.data?.targets.length ?? 0;

  const shortcutText = t(
    isMacPlatform()
      ? 'runtimeConfig.overview.quickJump.shortcutMac'
      : 'runtimeConfig.overview.quickJump.shortcutWin',
  );

  const runtimeState = homeRuntimeState(health);

  const resourceSnapshot = resources.snapshot;
  const diskPercent = resourceSnapshot?.diskUsedBytes != null && resourceSnapshot.diskTotalBytes != null
    ? Math.round(percentOf(resourceSnapshot.diskUsedBytes, resourceSnapshot.diskTotalBytes))
    : null;
  const diskCritical = diskPercent !== null && diskPercent >= HOME_RESOURCE_WARN_PERCENT.disk;
  const memoryCritical = resourceSnapshot?.memoryPressure === 'critical';

  const renderOverview = (messages: HomeMessages | null) => {
    const pending = messages ? pendingSummary(messages) : null;
    const hasPending = Boolean(pending && pending.count > 0);
    const hasUnread = Boolean(messages?.homeMessages?.some(isUnreadMessage));
    const showHeaderMessageSignal = hasPending || hasUnread;
    const drawerTriggerLabel = pending && pending.count > 0
      ? t(
          pending.more
            ? 'runtimeConfig.overview.messages.drawerTriggerPendingMore'
            : 'runtimeConfig.overview.messages.drawerTriggerPending',
          { count: pending.count },
        )
      : t('runtimeConfig.overview.messages.hasUnread');

    const attentionItems: HomeAttentionItem[] = [];
    if (runtimeState === 'unavailable') {
      attentionItems.push({
        id: 'runtime-unavailable',
        tone: 'danger',
        message: t('runtimeConfig.overview.attention.runtimeUnavailable'),
        actionLabel: t('runtimeConfig.overview.attention.diagnoseAction'),
        onAction: () => openDiagnostics('services'),
      });
    } else if (runtimeState === 'attention') {
      attentionItems.push({
        id: 'runtime-attention',
        tone: 'warning',
        message: t('runtimeConfig.overview.attention.runtimeAttention'),
        actionLabel: t('runtimeConfig.overview.attention.diagnoseAction'),
        onAction: () => openDiagnostics('services'),
      });
    }

    if (remoteSummary.pendingConfirmCount > 0) {
      attentionItems.push({
        id: 'remote-pending',
        tone: 'warning',
        message: t('runtimeConfig.overview.attention.remotePending', { count: remoteSummary.pendingConfirmCount }),
        actionLabel: t('runtimeConfig.overview.attention.reviewAction'),
        onAction: () => void navigation.push({ id: 'connections' }),
      });
    }

    if (failed.length > 0) {
      const firstFailed = failed[0]!;
      attentionItems.push({
        id: `setup-failed:${firstFailed.taskId}`,
        tone: 'warning',
        message: t('runtimeConfig.overview.setupFailed', {
          capability: displayRuntimeConfigCapabilityLabel(firstFailed.capabilityContract, t),
        }),
        actionLabel: t('runtimeConfig.overview.attention.reviewAction'),
        onAction: () => commands.runtimeConfigNavigation.openSetupTask(firstFailed.taskId),
      });
    } else if (textNeedsSetup) {
      attentionItems.push({
        id: 'text-setup',
        tone: effectiveTextState === 'attention' ? 'warning' : 'setup',
        message: t(
          effectiveTextState === 'attention'
            ? 'runtimeConfig.overview.attention.textSetupAttention'
            : 'runtimeConfig.overview.attention.textSetupUnset',
        ),
        actionLabel: t('runtimeConfig.overview.attention.configureAction'),
        onAction: () => void navigation.push({ id: 'runtime', runtime: { page: 'aiSettings', capabilityContract: 'text.generate' } }),
      });
    }

    if (hasPending && pending) {
      attentionItems.push({
        id: 'messages-pending',
        tone: 'info',
        message: t(
          pending.more
            ? 'runtimeConfig.overview.attention.pendingItemsMore'
            : 'runtimeConfig.overview.attention.pendingItems',
          { count: pending.count },
        ),
        actionLabel: t('runtimeConfig.overview.attention.openMessagesAction'),
        onAction: () => setHomeMessagesDrawerOpen(true),
      });
    }

    if (diskCritical && diskPercent !== null) {
      attentionItems.push({
        id: 'disk-critical',
        tone: 'warning',
        message: t('runtimeConfig.overview.attention.diskCritical', { percent: diskPercent }),
        actionLabel: t('runtimeConfig.overview.attention.manageStorageAction'),
        onAction: () => void openHomeSettings(navigation, 'data'),
      });
    } else if (memoryCritical) {
      attentionItems.push({
        id: 'memory-critical',
        tone: 'warning',
        message: t('runtimeConfig.overview.attention.memoryCritical'),
        actionLabel: t('runtimeConfig.overview.attention.diagnoseAction'),
        onAction: () => openDiagnostics('services'),
      });
    }

    if (localAppsUnavailable) {
      attentionItems.push({
        id: 'apps-unavailable',
        tone: 'warning',
        message: t('runtimeConfig.overview.attention.appsReadFailed'),
        actionLabel: t('runtimeConfig.overview.attention.retryAction'),
        onAction: () => void apps.refreshUpdates(),
      });
    }

    return (
      <div
        className="mx-auto flex w-full max-w-[780px] min-w-0 flex-1 flex-col justify-between gap-8"
        data-testid="home-overview-root"
      >
        <div className="flex min-w-0 flex-col gap-7">
          <header className="flex min-w-0 flex-col gap-5 pt-2" data-testid="home-hero-header">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span data-testid="home-date" className="text-xs text-[var(--nimi-text-secondary)]">
                {i18n.formatDate(now, { month: 'long', day: 'numeric', weekday: 'long' })}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {showHeaderMessageSignal ? (
                  <button
                    type="button"
                    aria-expanded={messagesDrawerOpen}
                    onClick={toggleHomeMessagesDrawer}
                    data-testid="home-messages-drawer-trigger"
                    className="inline-flex items-center gap-2 rounded-full bg-[var(--nimi-home-porcelain-card)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-primary)] shadow-[var(--nimi-home-porcelain-shadow)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[var(--nimi-home-porcelain-shadow-hover)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                  >
                    <span className="relative inline-flex items-center justify-center text-[var(--nimi-action-primary-bg)]">
                      <Bell size={13} aria-hidden="true" />
                      <span
                        className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-[var(--nimi-action-primary-bg)]"
                        aria-hidden="true"
                      />
                    </span>
                    <span>{drawerTriggerLabel}</span>
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => setQuickJumpOpen(true)}
                  aria-label={t('runtimeConfig.overview.quickJump.title')}
                  data-testid="home-quick-jump-trigger"
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--nimi-home-porcelain-card)] px-3 py-1.5 text-xs text-[var(--nimi-text-secondary)] shadow-[var(--nimi-home-porcelain-shadow)] transition-all duration-150 hover:text-[var(--nimi-text-primary)] hover:shadow-[var(--nimi-home-porcelain-shadow-hover)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                >
                  <Search size={13} aria-hidden="true" />
                  <kbd className="font-mono text-[11px]">{shortcutText}</kbd>
                </button>
              </div>
            </div>

            <h1 className="min-w-0 text-3xl font-semibold leading-tight tracking-tight text-[var(--nimi-text-primary)] md:text-[32px]">
              {displayName
                ? t('runtimeConfig.overview.greetingWithName', { greeting: t(greetingKey(now.getHours())), name: displayName })
                : t(greetingKey(now.getHours()))}
            </h1>

            <HomeQuickStartBar
              onSubmitDraft={submitChatDraft}
              onOpenChat={openChat}
            />
          </header>

          <HomeAttentionStrip
            attention={attentionItems}
            executions={activeExecutions}
            downloads={activeDownloads}
            onOpenActivity={() => setView('ai-activity')}
            onOpenDownloads={() => void navigation.push({ id: 'downloads' })}
          />

          <HomePartnersHeroCard enabled={isOverviewActive} />

          <HomeAppsWorkbench
            focusGeneration={focusGeneration}
            key={`apps-dock:${messagesAccountKey ?? 'device'}`}
            accountKey={messagesAccountKey}
            entries={entries}
            iconUrls={iconUrls}
            loading={apps.isPending}
            unavailable={localAppsUnavailable && !attentionItems.slice(0, 2).some((item) => item.id === 'apps-unavailable')}
            onOpenAllApps={() => void navigation.push({ id: 'apps' })}
            onOpenApp={openApp}
            onAppsMutated={() => void apps.refetch()}
          />
        </div>

        <HomeAmbientStatusStrip
          runtime={runtimeState}
          capabilitiesLoading={inventory.isPending && !inventory.data}
          capabilitiesFailed={inventory.isError}
          readyCapabilityCount={prepared.length}
          ai={ai}
          remote={remoteSummary}
          activeIntegrationCount={activeIntegrationCount}
          onOpenDiagnostics={openDiagnostics}
          onOpenCapabilities={() => void navigation.push({ id: 'runtime' })}
          onOpenUsageDetails={() => setView('ai-activity')}
          onOpenConnections={() => void navigation.push({ id: 'connections' })}
          onOpenIntegrations={() => openIntegrations()}
        />

        <HomeQuickJumpModal
          open={quickJumpOpen}
          onClose={() => setQuickJumpOpen(false)}
          items={quickJumpItems}
        />
      </div>
    );
  };

  const renderPage = (messages: HomeMessages | null) => {
    const resolvedContext = messages ? cardContext(messages) : null;
    const content = view === 'ai-activity' ? (
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
            context={resolvedContext!}
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
            viewportClassName="bg-transparent [&>div]:!flex [&>div]:min-h-full [&>div]:flex-col"
            contentClassName={`${SHELL_PAGE_WIDTH_CLASS} flex flex-1 flex-col pb-5 pt-5 lg:pt-8`}
          >
            {renderOverview(messages)}
          </ScrollArea>
        )}
      </div>
    );

    return (
      <>
        {content}
        {isOverviewActive ? (
          <HomeMessagesDrawer
            open={messagesDrawerOpen}
            messages={messages}
            context={resolvedContext}
            appArtworkForNotice={appArtworkForNotice}
            onClose={() => setHomeMessagesDrawerOpen(false)}
            onViewAll={() => openCenter('all')}
            onOpenSettings={openMessageSettings}
            onOpenPermissions={() => openIntegrations({ service: 'all-permissions' })}
          />
        ) : null}
      </>
    );
  };

  return messagesAccountKey ? (
    <HomeMessagesScope key={messagesAccountKey} systemMessages={systemMessages} systemSources={systemSources}>
      {renderPage}
    </HomeMessagesScope>
  ) : renderPage(null);
}
