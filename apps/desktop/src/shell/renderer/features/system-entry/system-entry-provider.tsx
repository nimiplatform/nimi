import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNimiTheme } from '@nimiplatform/kit/ui';
import { hasElectronInvoke, listenShell } from '@nimiplatform/kit/shell/renderer/bridge';
import { projectNimiRuntimeHealthStatusName } from '@nimiplatform/sdk/runtime';
import {
  SYSTEM_ENTRY_ACTION_EVENT, SYSTEM_ENTRY_HOME_COMMANDS, SYSTEM_ENTRY_VISIBILITY_EVENT,
  parseSystemEntryActionDispatch, parseSystemEntryProjection,
  type SystemEntryActionDispatch, type SystemEntryActionResult, type SystemEntryContext,
  type SystemEntryProjection,
} from '../../../shared/system-entry-types.js';
import { useAppStore, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { invokeChecked } from '../../bridge/runtime-bridge/invoke.js';
import { useAppsOverview } from '../apps/use-apps-overview.js';
import { useAppsDownloads } from '../apps/apps-downloads-context.js';
import { useGlobalDownloads } from '../runtime-config/global-downloads-context.js';
import { useRuntimeHealthCoordinatorState } from '../runtime-config/runtime-health-coordinator.js';
import { fetchLocalAgentList, localAgentListQueryKey } from '../agents/local-agent-list-model.js';
import { fetchHomeRecentChatPartners } from '../home/home-recent-conversations-model.js';
import { mergeActivitySnapshots } from '../home/home-app-activity-model.js';
import { createSystemEntryAIObserver, type SystemEntryAIObserver } from './system-entry-ai-observer.js';
import { projectSystemEntryUsage, projectSystemEntryWork, type SystemEntryAIState } from './system-entry-ai-model.js';
import { useSystemEntryActivityOwner } from './system-entry-activity-owner.js';
import { SystemEntryProviderContext } from './system-entry-context.js';
import { createSystemEntryPublisher, type SystemEntryProjectionDraft } from './system-entry-publisher.js';
import { executeSystemEntryRendererAction, type SystemEntryNotificationControls, type SystemEntryReadingNavigation } from './system-entry-renderer-actions.js';
import { emptySystemEntrySection, projectSystemEntryApps, projectSystemEntryAttention, projectSystemEntryDownloads, projectSystemEntryRecent } from './system-entry-source-model.js';
import { systemEntryDayRange } from './system-entry-time.js';

export type SystemEntryProviderProps = PropsWithChildren<{
  notifications: SystemEntryNotificationControls;
  reading: SystemEntryReadingNavigation;
  onHomeVisibility?(visible: boolean): void;
  /** Omit to follow the current system IANA time zone. */
  timeZone?: string;
}>;

// @nimi-authority: rule.nimi.desktop.shell-ui.system-entry-projection
export function SystemEntryProvider({ children, notifications, reading, timeZone, onHomeVisibility }: SystemEntryProviderProps) {
  const bindings = useDesktopRendererBindings();
  const navigation = useHomeNavigation();
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  const { scheme: colorScheme } = useNimiTheme();
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id ?? ''));
  const authenticated = useAppStore((state) => state.auth.status === 'authenticated' || state.auth.status === 'refresh-pending');
  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const [hostContext, setHostContext] = useState<SystemEntryContext | null>(null);
  const [homeVisible, setHomeVisible] = useState(true);
  useEffect(() => { onHomeVisibility?.(homeVisible); }, [homeVisible, onHomeVisibility]);
  const [published, setPublished] = useState<SystemEntryProjection | null>(null);
  const [aiState, setAIState] = useState<{ scope: string; state: SystemEntryAIState } | null>(null);
  const [appsReadScope, setAppsReadScope] = useState<string | null>(null);
  const [recentReadScope, setRecentReadScope] = useState<string | null>(null);
  const [agentsReadScope, setAgentsReadScope] = useState<string | null>(null);
  const ownerRef = useRef(ownerUserId);
  ownerRef.current = ownerUserId;
  const contextOwner = useRef<string | null>(null);
  const draftRef = useRef<SystemEntryProjectionDraft | null>(null);
  const refreshSourcesRef = useRef<() => Promise<void>>(async () => {});
  const observer = useRef<SystemEntryAIObserver | null>(null);
  const nativeEnabled = hasElectronInvoke() && bindings.app.projection.menuBarShellEnabled();
  const publisher = useMemo(() => createSystemEntryPublisher({
    readContext: async () => {
      const account = ownerRef.current;
      const result = await invokeChecked(SYSTEM_ENTRY_HOME_COMMANDS.context, {}, parseContext);
      if (ownerRef.current !== account) throw new Error('system-entry-view-stale');
      contextOwner.current = account;
      return result;
    },
    heartbeat: async (generation) => { await invokeChecked(SYSTEM_ENTRY_HOME_COMMANDS.heartbeat, { payload: { generation } }, parseAccepted); },
    publish: async (projection) => { await invokeChecked(SYSTEM_ENTRY_HOME_COMMANDS.publish, { payload: projection }, parseAccepted); },
    draft: () => draftRef.current,
    onContext: (context) => { setHostContext(context); if (context) setHomeVisible(context.homeVisible); },
    onPublished: setPublished,
    refreshSources: () => refreshSourcesRef.current(),
  }), []);

  useEffect(() => {
    if (!nativeEnabled) return;
    publisher.start();
    return () => publisher.stop();
  }, [nativeEnabled, publisher]);
  useEffect(() => { if (nativeEnabled) void publisher.refreshContext(); }, [authenticated, ownerUserId, nativeEnabled, publisher]);
  useEffect(() => {
    if (!nativeEnabled) return;
    return bindings.app.events.subscribeProductControlRecord(() => { void publisher.refreshContext(); });
  }, [bindings.app.events, nativeEnabled, publisher]);
  const scope = authenticated && ownerUserId && contextOwner.current === ownerUserId && hostContext?.state === 'ready'
    ? `${hostContext.generation}:${ownerUserId}` : null;
  useEffect(() => {
    if (hostContext?.state !== 'ready') return;
    // Native scope loss disables notifications even if the renderer survives.
    // Re-read and acknowledge the same preference owner after scope recovery.
    void queryClient.invalidateQueries({ queryKey: ['desktop-execution-notification-preferences'] });
  }, [hostContext?.generation, hostContext?.state, queryClient]);
  const activityOwner = useSystemEntryActivityOwner(bindings.sdk, scope);
  const activity = activityOwner.activity;
  const apps = useAppsOverview({ enabled: Boolean(scope) });
  const appDownloads = useAppsDownloads();
  const downloads = useGlobalDownloads();
  const health = useRuntimeHealthCoordinatorState();
  const agents = useQuery({ queryKey: localAgentListQueryKey(ownerUserId), queryFn: () => fetchLocalAgentList(ownerUserId, bindings.sdk), enabled: Boolean(scope), staleTime: 30_000 });
  const agentList = agents.data ?? [];
  const agentRefs = agentList.map((agent) => agent.localAgentRef).join(',');
  const recent = useQuery({
    queryKey: ['home-recent-chat-partners', ownerUserId, agentRefs],
    queryFn: () => fetchHomeRecentChatPartners({ ownerUserId, sdk: bindings.sdk, agents: agentList }),
    enabled: Boolean(scope) && agentsReadScope === scope && agentList.length > 0, staleTime: 30_000,
  });

  useEffect(() => {
    setAgentsReadScope(null);
    if (!scope) return;
    let active = true;
    void agents.refetch({ cancelRefetch: false }).then(() => { if (active) setAgentsReadScope(scope); });
    return () => { active = false; };
  }, [scope, agents.refetch]);
  useEffect(() => {
    setAppsReadScope(null);
    if (!scope) return;
    let active = true;
    const read = () => { void apps.refetch({ cancelRefetch: false }).then(() => { if (active) setAppsReadScope(scope); }); };
    read();
    const timer = setInterval(read, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [scope, apps.refetch]);
  useEffect(() => {
    setRecentReadScope(null);
    if (!scope || agentsReadScope !== scope || !agentList.length) return;
    let active = true;
    void recent.refetch({ cancelRefetch: false }).then(() => { if (active) setRecentReadScope(scope); });
    return () => { active = false; };
  }, [scope, agentsReadScope, agentRefs, recent.refetch]);
  const recentActivityRevision = activity.recent.records.filter((record) => record.source.kind === 'runtime-agent').map((record) => `${record.activityId}:${record.changeSeq}`).join('|');
  useEffect(() => {
    if (scope && recentActivityRevision) void queryClient.invalidateQueries({ queryKey: ['home-recent-chat-partners', ownerUserId] });
  }, [scope, recentActivityRevision, ownerUserId, queryClient]);

  useEffect(() => {
    setAIState(null);
    if (!scope) return;
    let active = true;
    try {
      const current = createSystemEntryAIObserver({ audit: bindings.sdk.accountProduct().audit,
        onChange: (state) => { if (active) setAIState({ scope, state }); }, timeZone: () => timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone });
      observer.current = current; current.start();
      return () => { active = false; current.stop(); if (observer.current === current) observer.current = null; };
    } catch {
      setAIState({ scope, state: { range: systemEntryDayRange(Date.now(), timeZone),
        activity: { status: 'unavailable', value: null, error: 'system-entry-activity-unavailable' },
        usage: { status: 'unavailable', value: null, error: 'system-entry-usage-unavailable' } } });
      return () => { active = false; };
    }
  }, [bindings.sdk, scope, timeZone]);

  const refresh = useCallback(async (): Promise<void> => {
    activity.retry();
    await Promise.allSettled([
      apps.refetch({ cancelRefetch: false }),
      agents.refetch({ cancelRefetch: false }),
      ...(agentList.length ? [recent.refetch({ cancelRefetch: false })] : []),
      downloads?.refresh() ?? Promise.resolve(),
      observer.current?.refresh() ?? Promise.resolve(),
    ]);
  }, [activity.retry, apps.refetch, agents.refetch, recent.refetch, downloads?.refresh, agentList.length]);
  refreshSourcesRef.current = refresh;
  const locale = i18n.resolvedLanguage?.startsWith('zh') ? 'zh' : 'en';
  const currentAI = scope && aiState?.scope === scope ? aiState.state : null;
  const draft = useMemo<SystemEntryProjectionDraft | null>(() => {
    if (!scope || !hostContext || hostContext.state !== 'ready') return null;
    const projectedDownloads = projectSystemEntryDownloads({
      transfers: downloads?.transfers ?? [], environments: downloads?.environments ?? [], appJobs: appDownloads?.jobs ?? [],
      loading: !downloads || downloads.loading || !appDownloads || appDownloads.status === 'loading',
      unavailable: Boolean(downloads?.errors.length) || appDownloads?.status === 'unavailable', locale,
    });
    const attention = projectSystemEntryAttention({ pending: activity.pending, recent: activity.recent, observedAt: activityOwner.observedAt,
      downloadFailures: projectedDownloads.failures, downloadsComplete: projectedDownloads.complete, locale });
    const work = currentAI ? projectSystemEntryWork(currentAI.activity, locale) : emptySystemEntrySection();
    const usage = projectSystemEntryUsage(currentAI?.usage ?? { status: 'loading', value: null, error: null }, currentAI?.range ?? systemEntryDayRange(Date.now(), timeZone), locale);
    const appsSection = projectSystemEntryApps({ projection: apps.data, readable: appsReadScope === scope, failed: apps.isError,
      loading: apps.isPending || appsReadScope !== scope, observedAt: apps.dataUpdatedAt ? new Date(apps.dataUpdatedAt).toISOString() : null, locale });
    const recentStatus = agents.isError || recent.isError ? 'unavailable'
      : agents.isPending || agentsReadScope !== scope || agentList.length > 0 && (recent.isPending || recentReadScope !== scope) ? 'loading' : 'ready';
    const recentSection = projectSystemEntryRecent({ partners: recent.data ?? [], agentCount: agentList.length, status: recentStatus,
      observedAt: recent.dataUpdatedAt ? new Date(recent.dataUpdatedAt).toISOString() : null, locale });
    const name = health.runtimeHealth && !health.error && !health.streamError ? projectNimiRuntimeHealthStatusName(health.runtimeHealth.status) : 'UNAVAILABLE';
    const service = name === 'READY' ? 'running' : name === 'DEGRADED' ? 'degraded' : name === 'STARTING' ? 'starting' : name === 'STOPPED' ? 'stopped' : 'unavailable';
    const observed = [attention.observedAt, work.observedAt, appsSection.observedAt, recentSection.observedAt, projectedDownloads.section.observedAt,
      usage.observedAt, health.lastFetchedAt, health.lastStreamAt].filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value!)));
    const value = { generation: hostContext.generation, revision: 0, locale, colorScheme, service,
      observedAt: observed.length ? new Date(Math.max(...observed.map(Date.parse))).toISOString() : new Date(0).toISOString(),
      attention: { ...attention, items: attention.items.slice(0, 2) }, work: { ...work, items: work.items.slice(0, 3) },
      recent: { ...recentSection, items: recentSection.items.slice(0, 5) }, apps: { ...appsSection, items: appsSection.items.slice(0, 8) },
      downloads: { ...projectedDownloads.section, items: projectedDownloads.section.items.slice(0, 3) }, usage,
      notificationsEnabled: notifications.enabled, notificationsPausedUntil: notifications.pausedUntil };
    const { revision: _revision, ...validated } = parseSystemEntryProjection(value);
    return validated;
  }, [scope, hostContext?.generation, hostContext?.state, locale, colorScheme, downloads?.transfers, downloads?.environments, downloads?.loading, downloads?.errors,
    appDownloads?.jobs, appDownloads?.status, activity.pending, activity.recent, activityOwner.observedAt, currentAI, apps.data, appsReadScope, apps.isError,
    apps.isPending, apps.dataUpdatedAt, recent.data, recent.isError, recent.isPending, recent.dataUpdatedAt, recentReadScope, agents.isError, agents.isPending,
    agentsReadScope, agentList.length, health, notifications.enabled, notifications.pausedUntil, timeZone]);
  draftRef.current = draft;
  useEffect(() => { if (nativeEnabled) publisher.update(); }, [draft, nativeEnabled, publisher]);

  const actionRef = useRef<(request: SystemEntryActionDispatch) => Promise<void>>(async () => {});
  actionRef.current = (request) => executeSystemEntryRendererAction(request, {
    context: () => publisher.currentContext(), published: () => publisher.published(), readCurrentContext: () => publisher.refreshContext(),
    navigation, sdk: bindings.sdk, ownerUserId,
    appEntries: appsReadScope === scope && apps.data?.status === 'loaded' ? apps.data.entries : [],
    agents: agentList, activityRecords: mergeActivitySnapshots(activity.pending, activity.recent), openActivity: activityOwner.openActivity,
    notifications, reading, setAgentConversationTargetSnapshot, refresh,
  });
  useEffect(() => {
    if (!nativeEnabled) return;
    let active = true;
    const requests = new Map<string, Promise<SystemEntryActionResult>>();
    const retentionTimers = new Set<ReturnType<typeof setTimeout>>();
    const actionListener = Promise.resolve(listenShell(SYSTEM_ENTRY_ACTION_EVENT, (event) => {
      if (!active) return;
      let request: SystemEntryActionDispatch;
      try { request = parseSystemEntryActionDispatch(event.payload); } catch { return; }
      let response = requests.get(request.requestId);
      if (!response) {
        if (requests.size >= 128) {
          void invokeChecked(SYSTEM_ENTRY_HOME_COMMANDS.actionResult, { payload: { requestId: request.requestId, generation: request.generation, error: 'system-entry-action-busy' } }, parseAccepted).catch(() => undefined);
          return;
        }
        response = actionRef.current(request).then(() => ({ requestId: request.requestId, generation: request.generation, error: null }),
          (error: unknown) => ({ requestId: request.requestId, generation: request.generation, error: boundedActionError(error) }));
        requests.set(request.requestId, response);
        void response.finally(() => {
          if (!active) return;
          const timer = setTimeout(() => { requests.delete(request.requestId); retentionTimers.delete(timer); }, 30_000);
          retentionTimers.add(timer);
        });
      }
      void response.then((result) => {
        if (!active || publisher.currentContext()?.generation !== result.generation) return;
        return invokeChecked(SYSTEM_ENTRY_HOME_COMMANDS.actionResult, { payload: result }, parseAccepted);
      }).catch(() => undefined);
    }));
    const visibilityListener = Promise.resolve(listenShell(SYSTEM_ENTRY_VISIBILITY_EVENT, (event) => {
      if (!active || !event.payload || typeof event.payload !== 'object') return;
      const value = event.payload as Record<string, unknown>;
      if (Object.keys(value).sort().join('|') !== 'generation|homeVisible' || typeof value.homeVisible !== 'boolean') return;
      if (publisher.currentContext()?.generation !== value.generation) return;
      setHomeVisible(value.homeVisible);
      setHostContext((current) => current && current.generation === value.generation ? { ...current, homeVisible: value.homeVisible as boolean } : current);
    }));
    void actionListener.catch(() => undefined); void visibilityListener.catch(() => undefined);
    return () => {
      active = false; requests.clear();
      for (const timer of retentionTimers) clearTimeout(timer);
      retentionTimers.clear();
      void actionListener.then((unsubscribe) => unsubscribe(), () => undefined);
      void visibilityListener.then((unsubscribe) => unsubscribe(), () => undefined);
    };
  }, [nativeEnabled, publisher]);

  return <SystemEntryProviderContext.Provider value={{ hostContext, homeVisible,
    projection: scope && published?.generation === hostContext?.generation ? published : null,
    appActivity: activity, ai: currentAI, refresh, openUsage: reading.openUsage, openCurrentWork: reading.openCurrentWork }}>
    {children}
  </SystemEntryProviderContext.Provider>;
}

function parseContext(value: unknown): SystemEntryContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('system-entry-context-invalid');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join('|') !== 'generation|homeVisible|state' || typeof record.generation !== 'string' || !record.generation
    || record.generation.length > 128 || typeof record.homeVisible !== 'boolean'
    || !['ready', 'login-required', 'recovery-required', 'unknown', 'locked'].includes(String(record.state))) throw new Error('system-entry-context-invalid');
  return { generation: record.generation, homeVisible: record.homeVisible, state: record.state as SystemEntryContext['state'] };
}
function parseAccepted(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join('|') !== 'accepted' || (value as { accepted?: unknown }).accepted !== true) {
    throw new Error('system-entry-command-not-accepted');
  }
}
function boundedActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^system-entry-[a-z-]{1,100}$/u.test(message) ? message : 'system-entry-action-failed';
}
