import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, EmptyState, InlineAlert, LoadingSkeleton, ScrollArea, SearchField, SidebarShell } from '@nimiplatform/kit/ui';
import { AgentCenter, type AgentCenterI18n } from '@nimiplatform/kit/features/agent-center';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { ArrowLeft, BookOpen, Globe, MessageCircle, Settings } from 'lucide-react';
import { useAppStore, useAppStoreApi, useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { captureHomeNavigationScope } from '../../app-shell/providers/home-navigation.js';
import { useHomeListPosition } from '../../app-shell/providers/use-home-list-position.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useDesktopAgentCenterSession } from '../chat/chat-agent-shell-adapter-runtime.js';
import { launchAgentConversationFromDisplay } from '../chat/agent-conversation-launcher.js';
import { resolveCurrentPartnerSource } from '../source-detail/data/realm-source-detail-data.js';
import { getRuntimeSetupTaskStore } from '../runtime-config/runtime-setup-task-store.js';
import { openRuntimeSetupTaskFromEntry } from '../runtime-config/runtime-setup-task-open.js';
import { projectPartnerRecord, partnerDirectoryQueryKey, readPartnerDirectoryPage } from './partner-directory-model.js';
import { openPartnerConversation } from './partner-navigation.js';

const P = 'runtimeConfig.partners';

export function PartnerDirectory() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const auth = useAppStore(state => state.auth);
  const realm = useAppStore(state => state.runtimeDefaults?.realm.realmBaseUrl ?? '');
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const accountId = String(auth.user?.id ?? '');
  const selectedRef = destination.partner?.localAgentRef ?? '';
  const query = destination.partnerQuery ?? '';
  const inventory = useInfiniteQuery({
    queryKey: [...partnerDirectoryQueryKey(accountId, realm), auth.authorizationRevision],
    queryFn: ({ pageParam }) => readPartnerDirectoryPage(bindings.sdk, accountId, pageParam),
    initialPageParam: '', getNextPageParam: page => page.nextPageToken || undefined,
    enabled: auth.status === 'authenticated', staleTime: 15_000, networkMode: 'always',
  });
  const partners = useMemo(() => [...new Map((inventory.data?.pages.flatMap(page => page.items) ?? []).map(item => [item.localAgentRef, item])).values()], [inventory.data]);
  const visible = partners.filter(partner => partner.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const viewport = useHomeListPosition(JSON.stringify(['partners', accountId, realm, query]), !inventory.isPending);
  const heading = useRef<HTMLHeadingElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const previousSelection = useRef(selectedRef);
  useLayoutEffect(() => {
    const previous = previousSelection.current;
    previousSelection.current = selectedRef;
    const narrow = window.matchMedia?.('(max-width: 1023px)');
    const moveFocus = (event?: MediaQueryListEvent) => {
      if (!narrow?.matches) return;
      if (selectedRef && (!event || viewport.current?.contains(document.activeElement) || document.activeElement === document.body)) detail.current?.focus({ preventScroll: true });
      else if (!selectedRef && previous && !event) ([...(viewport.current?.querySelectorAll<HTMLElement>('[data-view-key]') ?? [])].find(node => node.dataset.viewKey === previous) ?? heading.current)?.focus({ preventScroll: true });
    };
    moveFocus();
    narrow?.addEventListener('change', moveFocus);
    return () => narrow?.removeEventListener('change', moveFocus);
  }, [selectedRef, viewport]);
  if (auth.status !== 'authenticated' && auth.status !== 'refresh-pending') return <EmptyState title={t(`${P}.signIn`)} />;
  const showList = () => { void navigation.push({ ...destination, partner: undefined }); };
  return <div className="flex min-h-0 flex-1 gap-3" data-testid="partner-directory">
    <SidebarShell className={`min-h-0 w-full shrink-0 lg:w-[272px] ${selectedRef ? 'hidden lg:flex' : 'flex'}`}>
      <header className="space-y-3 px-4 pb-3 pt-5">
        <h1 ref={heading} tabIndex={-1} className="text-lg font-semibold">{t(`${P}.title`)}</h1>
        <p className="text-xs text-[var(--nimi-text-secondary)]">{t(`${P}.scope`)}</p>
        <SearchField aria-label={t(`${P}.search`)} placeholder={t(`${P}.search`)} value={query}
          onChange={event => { void navigation.replace({ ...destination, partnerQuery: event.target.value }); }} />
      </header>
      <ScrollArea viewportRef={viewport} className="min-h-0 flex-1" contentClassName="space-y-1 px-2 pb-4">
        {inventory.isPending ? <LoadingSkeleton lines={3} /> : null}
        {inventory.isError ? <InlineAlert tone="warning" action={<Button size="sm" onClick={() => { void inventory.refetch(); }}>{t('Common.retry')}</Button>}>{t(`${P}.loadFailed`)}</InlineAlert> : null}
        {visible.map(partner => <button key={partner.localAgentRef} data-testid="partner-row" data-view-key={partner.localAgentRef} aria-current={selectedRef === partner.localAgentRef ? 'true' : undefined}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${selectedRef === partner.localAgentRef ? 'bg-[var(--nimi-surface-active)]' : 'hover:bg-[var(--nimi-surface-panel)]'}`}
          onClick={() => { void navigation.push({ ...destination, partner: { localAgentRef: partner.localAgentRef } }); }}>
          <Avatar alt={partner.displayName} fallback={partner.displayName.slice(0, 1) || '?'} />
          <span className="min-w-0"><span className="block break-words text-sm font-medium">{partner.displayName || t(`${P}.unnamed`)}</span>
            <span className="mt-1 block text-xs text-[var(--nimi-text-secondary)]">{partner.lifecycle === AgentLifecycleStatus.ACTIVE
              ? (partner.createdAt ? t(`${P}.created`, { time: new Date(partner.createdAt).toLocaleString() }) : t(`${P}.creationUnknown`))
              : t(`${P}.lifecycle.${partner.lifecycle}`, { defaultValue: t(`${P}.lifecycle.0`) })}</span></span>
        </button>)}
        {!inventory.isPending && !inventory.isError && !partners.length && !inventory.hasNextPage ? <EmptyState title={t(`${P}.empty`)} action={<Button onClick={() => { void navigation.push({ id: 'explore', exploreSection: 'worlds' }); }}>{t(`${P}.discover`)}</Button>} /> : null}
        {partners.length > 0 && !visible.length ? <p className="p-3 text-sm text-[var(--nimi-text-secondary)]">{t(`${P}.noMatch`)}</p> : null}
        {inventory.hasNextPage ? <div className="px-3 pt-3 text-xs text-[var(--nimi-text-secondary)]"><p>{t(`${P}.partial`, { count: partners.length })}</p>
          <Button size="sm" disabled={inventory.isFetchingNextPage} onClick={() => { void inventory.fetchNextPage(); }}>{t(`${P}.loadMore`)}</Button></div> : null}
      </ScrollArea>
    </SidebarShell>
    <ScrollArea className={`min-h-0 min-w-0 flex-1 ${selectedRef ? '' : 'hidden lg:block'}`} contentClassName="mx-auto max-w-[1120px] p-5">
      {selectedRef ? <div ref={detail} tabIndex={-1} role="region" aria-label={t(`${P}.details`)}><Button tone="ghost" size="sm" onClick={showList} className="mb-4 lg:hidden"><ArrowLeft size={16} />{t(`${P}.title`)}</Button>
        <PartnerDetails key={`${accountId}:${realm}:${auth.authorizationRevision}:${selectedRef}`} scopeKey={`${realm}:${auth.authorizationRevision}`} localAgentRef={selectedRef} accountId={accountId} /></div>
        : <EmptyState title={t(`${P}.choose`)} />}
    </ScrollArea>
  </div>;
}

function PartnerDetails({ localAgentRef, accountId, scopeKey }: { localAgentRef: string; accountId: string; scopeKey: string }) {
  const { t, i18n } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const store = useAppStoreApi();
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const selected = useQuery({ queryKey: ['home-partner', accountId, scopeKey, localAgentRef],
    queryFn: async () => {
      const response = await bindings.sdk.withRuntimeProtectedScopes(['runtime.agent.read'], options => bindings.sdk.accountProduct().agents.getAgent({ agentId: localAgentRef }, options));
      if (!response.agent || response.agent.localAgentRef !== localAgentRef) throw new Error('Selected partner is unavailable.');
      return projectPartnerRecord(response.agent, accountId);
    }, staleTime: 0, networkMode: 'always' });
  const partner = selected.data;
  const active = !selected.isError && partner?.lifecycle === AgentLifecycleStatus.ACTIVE;
  const reference = useQuery({ queryKey: ['home-partner-reference', accountId, scopeKey, localAgentRef],
    queryFn: () => bindings.sdk.resolveDesktopAgentReference({ localAgentRef }), enabled: active, staleTime: 0, gcTime: 0, networkMode: 'always' });
  const settings = destination.partner?.settingsSection;
  const session = useDesktopAgentCenterSession({ agentHandle: active && settings && !reference.isError ? reference.data?.reference?.agentHandle : null });
  const source = useQuery({ queryKey: ['partner-current-source', accountId, scopeKey, localAgentRef, partner?.sourceRef],
    queryFn: () => resolveCurrentPartnerSource(bindings.sdk.realm(), partner!.sourceRef!),
    enabled: Boolean(partner?.sourceRef) && !selected.isError, staleTime: 60_000, retry: false });
  const [actionError, setActionError] = useState<string | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const copy = useMemo<AgentCenterI18n>(() => ({ language: i18n.resolvedLanguage || i18n.language,
    exists: key => key === 'AgentCenter.chrome.title' || i18n.exists(key),
    t: (key, values) => key === 'AgentCenter.chrome.title' ? t(`${P}.settings`) : t(key, values) as string,
  }), [i18n, t]);
  const openSetup = (capabilityContract: string, creation = false) => {
    void openRuntimeSetupTaskFromEntry(getRuntimeSetupTaskStore(), {
      navigation, capabilityContract, loadSource: async origin => ({ kind: creation ? 'app' : 'local-agent',
        ...(creation ? { ownerAppId: bindings.sdk.appId() } : {}), accountId,
        returnFocus: 'home:' + encodeURIComponent(JSON.stringify(origin)) }),
      openTask: taskId => bindings.app.commands.runtimeConfigNavigation.openSetupTask(taskId),
    }).catch(() => setActionError(t(`${P}.actionFailed`)));
  };
  const chat = async () => {
    if (!active || !partner || openingChat) return;
    const scope = captureAccountActionScope(store);
    if (!scope || scope.accountId !== accountId) { scope?.dispose(); return; }
    const position = captureHomeNavigationScope(navigation);
    const isCurrent = () => scope.isCurrent() && position.isCurrent() && mounted.current;
    setOpeningChat(true); setActionError(null);
    try {
      const target = await openPartnerConversation({ sdk: bindings.sdk, accountId, localAgentRef, isCurrent });
      if (!target || !isCurrent()) return;
      await launchAgentConversationFromDisplay({ navigation, setAgentConversationTargetSnapshot: store.getState().setAgentConversationTargetSnapshot,
        target });
    } catch { if (isCurrent()) setActionError(t(`${P}.actionFailed`)); }
    finally { scope.dispose(); position.dispose(); if (mounted.current) setOpeningChat(false); }
  };
  if (selected.isPending) return <LoadingSkeleton lines={4} />;
  if (selected.isError || !partner) return <InlineAlert tone="warning" action={<Button size="sm" onClick={() => { void selected.refetch(); }}>{t('Common.retry')}</Button>}>{t(`${P}.unavailable`)}</InlineAlert>;
  return <div className="space-y-5" data-testid="partner-details">
    <header className="rounded-[20px] bg-[var(--nimi-surface-card)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4"><Avatar alt={partner.displayName} size="lg" src={reference.data?.reference?.avatarUrl || undefined} fallback={partner.displayName.slice(0, 1)} />
          <div><h2 className="break-words text-2xl font-semibold">{partner.displayName || t(`${P}.unnamed`)}</h2>
            <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{partner.createdAt ? t(`${P}.created`, { time: new Date(partner.createdAt).toLocaleString() }) : t(`${P}.creationUnknown`)}</p></div></div>
        <div className="flex flex-wrap gap-2"><Button tone="secondary" disabled={!active || reference.isPending || reference.isError} onClick={() => { void navigation.push({ ...destination, partner: { localAgentRef, settingsSection: 'overview' } }); }}><Settings size={16} />{t(`${P}.manage`)}</Button>
          <Button tone="primary" disabled={!active || openingChat || reference.isError} onClick={() => { void chat(); }}><MessageCircle size={16} />{t(`${P}.chat`)}</Button></div>
      </div>
      {!active ? <p className="mt-4 text-sm text-[var(--nimi-text-secondary)]">{t(`${P}.lifecycle.${partner.lifecycle}`, { defaultValue: t(`${P}.lifecycle.0`) })}</p> : null}
      {reference.isError || actionError ? <InlineAlert tone="warning" className="mt-4">{actionError || t(`${P}.managerUnavailable`)}</InlineAlert> : null}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--nimi-border-subtle)] pt-4 text-sm">
        {source.data && !source.isError ? <Button tone="ghost" size="sm" onClick={() => { void navigation.push({ id: 'source-detail', sourceRef: source.data.sourceRef }); }}><BookOpen size={15} />{t(`${P}.source`, { name: source.data.displayName })}</Button>
          : <span className="text-[var(--nimi-text-secondary)]">{t(source.isPending && source.fetchStatus !== 'paused' && partner.sourceRef ? `${P}.sourceLoading` : `${P}.sourceUnavailable`)}</span>}
        {partner.sourceRef ? <Button tone="ghost" size="sm" onClick={() => { void navigation.push({ id: 'world-detail', worldId: partner.sourceRef!.worldId }); }}><Globe size={15} />{source.data?.worldName || t(`${P}.world`)}</Button> : null}
        {source.isError ? <Button tone="ghost" size="sm" onClick={() => { void source.refetch(); }}>{t('Common.retry')}</Button> : null}
      </div>
      {source.data?.updated && !source.isError ? <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{t(`${P}.sourceUpdated`)}</p> : null}
    </header>
    {settings && session ? <>{settings === 'ai-config' ? <p className="text-sm text-[var(--nimi-text-secondary)]">{t(`${P}.sharedAI`)}</p> : null}
      <AgentCenter session={session} activeSection={settings} chrome="standalone" identity={{ displayName: partner.displayName, avatarUrl: reference.data?.reference?.avatarUrl }} i18n={copy}
        onSectionChange={settingsSection => { void navigation.replace({ ...destination, partner: { localAgentRef, settingsSection } }); }}
        placementActions={{ close: () => { void navigation.replace({ ...destination, partner: { localAgentRef } }); },
          openRuntimeSettings: () => bindings.app.commands.runtimeConfigNavigation.openPage('aiSettings'),
          openMachineLoadout: capability => openSetup(capability), openReferenceVoiceSetup: scope => openSetup(scope === 'creation' ? 'voice.create' : 'audio.synthesize', scope === 'creation') }} />
      </> : settings && active && reference.isPending ? <LoadingSkeleton lines={3} /> : null}
  </div>;
}
