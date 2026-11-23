import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ActionMenu, Avatar, Button, IconButton, InlineAlert, LoadingSkeleton, Popover, PopoverContent, PopoverTrigger, type NimiMenuItem } from '@nimiplatform/kit/ui';
import { AgentCenter, type AgentCenterI18n } from '@nimiplatform/kit/features/agent-center';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { BookOpen, Globe, MessageCircle, MoreHorizontal, Settings, List, Sparkles, UserRound } from 'lucide-react';
import { useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useDesktopAgentCenterSession } from './agent-center-session.js';
import { resolveCurrentPartnerSource } from '../source-detail/data/realm-source-detail-data.js';
import { fetchSourceDisplayDetail, sourceDisplayDetailQueryKey } from '../source-detail/source-detail-queries.js';
import { SourceDetailSkeleton } from '../source-detail/source-detail-skeleton.js';
import { CharacterSourceDetailPage } from '../source-detail/source-detail-world-character-view.js';
import { getRuntimeSetupTaskStore } from '../runtime-config/runtime-setup-task-store.js';
import { openRuntimeSetupTaskFromEntry } from '../runtime-config/runtime-setup-task-open.js';
import { projectPartnerRecord } from './partner-directory-model.js';
import { usePartnerChat } from './use-partner-chat.js';
import { PartnerStatus } from './partner-status.js';
import { PartnerActivity } from './partner-activity.js';
import { usePartnerAvatarAction } from './partner-avatar-action.js';
import { PartnerProfileLoading } from './partner-profile-loading.js';
import { PartnerUtopiaPresence } from './partner-utopia-presence.js';

const P = 'runtimeConfig.partners';

// @nimi-authority: rule.nimi.desktop.product-surfaces.partners
export function PartnerDetails({ localAgentRef, accountId, scopeKey }: { localAgentRef: string; accountId: string; scopeKey: string }) {
  const { t, i18n } = useTranslation();
  const bindings = useDesktopRendererBindings();
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
  const showActivity = Boolean(destination.partner?.activity);
  const session = useDesktopAgentCenterSession({ agentHandle: active && !reference.isError ? reference.data?.reference?.agentHandle : null });
  const source = useQuery({ queryKey: ['partner-current-source', accountId, scopeKey, localAgentRef, partner?.sourceRef],
    queryFn: () => resolveCurrentPartnerSource(bindings.sdk.realm(), partner!.sourceRef!),
    enabled: Boolean(partner?.sourceRef) && !selected.isError, staleTime: 60_000, retry: false });
  const profile = useQuery({
    queryKey: [...(source.data ? sourceDisplayDetailQueryKey(source.data.sourceRef) : ['partner-profile-unavailable']), accountId, scopeKey],
    queryFn: () => fetchSourceDisplayDetail(source.data!.sourceRef, bindings.sdk, { prefetchedSource: source.data }),
    enabled: Boolean(source.data) && !source.isError && !selected.isError,
    staleTime: 60_000, retry: false,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const chat = usePartnerChat(accountId);
  const avatarAction = usePartnerAvatarAction({
    session: active ? session : null,
    accountId,
    localAgentRef,
    onConfigure: () => { void navigation.push({ ...destination, partner: { localAgentRef, settingsSection: 'appearance' } }); },
  });
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
  if (selected.isPending) {
    return settings || showActivity ? <LoadingSkeleton lines={4} /> : <SourceDetailSkeleton variant="partner" />;
  }
  if (selected.isError || !partner) return <InlineAlert tone="warning" action={<Button size="sm" onClick={() => { void selected.refetch(); }}>{t('Common.retry')}</Button>}>{t(`${P}.unavailable`)}</InlineAlert>;
  const moreMenuItems: NimiMenuItem[] = [
    {
      id: 'manage',
      label: t(`${P}.manage`),
      icon: <Settings size={15} />,
      disabled: !active || reference.isPending || reference.isError,
      onSelect: () => {
        void navigation.push({ ...destination, partner: { localAgentRef, settingsSection: 'overview' } });
      },
    },
    ...(session && active ? [{
      id: 'avatar',
      label: avatarAction.label,
      icon: <UserRound size={15} />,
      disabled: avatarAction.disabled,
      onSelect: () => { void avatarAction.trigger(); },
    }] : []),
    {
      id: 'activity',
      label: t(showActivity ? `${P}.profile` : `${P}.activity.title`),
      icon: <List size={15} />,
      onSelect: () => {
        void navigation.push({ ...destination, partner: { localAgentRef, ...(showActivity ? {} : { activity: {} }) } });
      },
    },
    {
      id: 'zhiyu',
      label: t('Chat.contactsOpenZhiyu'),
      icon: <Sparkles size={15} />,
      disabled: !active || Boolean(chat.openingRef),
      onSelect: () => { void chat.openChat(partner, 'zhiyu'); },
    },
  ];
  const actions = <div className="flex flex-wrap items-center justify-end gap-2 max-[760px]:justify-start">
          <Button tone="primary" className="px-4" disabled={!active || Boolean(chat.openingRef) || reference.isError} onClick={() => { void chat.openChat(partner); }}><MessageCircle size={16} />{t('Chat.contactsOpenConversation')}</Button>
          <Popover open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
            <PopoverTrigger asChild>
              <IconButton
                tone="secondary"
                aria-label={t('SourceDetail.worldCharacter.morePartnerActions', { defaultValue: 'More partner actions' })}
                icon={<MoreHorizontal size={16} />}
              />
            </PopoverTrigger>
            <PopoverContent align="end" className="p-1.5">
              <ActionMenu
                ariaLabel={t('SourceDetail.worldCharacter.morePartnerActions', { defaultValue: 'More partner actions' })}
                items={moreMenuItems}
                onRequestClose={() => setMoreMenuOpen(false)}
              />
            </PopoverContent>
          </Popover>
        </div>;
  const renderStatusContent = (layout: 'grid' | 'stack') => (
    <div className="space-y-3">
      {layout === 'stack' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--nimi-text-muted)]">
          <span>{partner.createdAt ? t(`${P}.created`, { time: new Date(partner.createdAt).toLocaleDateString() }) : t(`${P}.creationUnknown`)}</span>
          <span className="font-medium text-[var(--nimi-text-secondary)]">{t(`${P}.lifecycle.${partner.lifecycle}`, { defaultValue: t(`${P}.lifecycle.0`) })}</span>
        </div>
      ) : null}
      {session ? <PartnerStatus session={session} layout={layout} onManage={section => { void navigation.push({ ...destination, partner: { localAgentRef, settingsSection: section } }); }} /> : null}
      {session && active ? <PartnerUtopiaPresence session={session} agentHandle={!reference.isError ? reference.data?.reference?.agentHandle : null} accountId={accountId} scopeKey={scopeKey} /> : null}
      {reference.isError || actionError || chat.failed ? <InlineAlert tone="warning">{actionError || t(chat.failed ? `${P}.actionFailed` : `${P}.managerUnavailable`)}</InlineAlert> : null}
    </div>
  );
  const publicProfile = !source.isError && !profile.isError ? profile.data?.source ?? null : null;
  const isProfilePaused = Boolean(partner.sourceRef) && (
    (source.isPending && source.fetchStatus === 'paused')
    || (Boolean(source.data) && profile.isPending && profile.fetchStatus === 'paused')
  );
  const isProfileFailed = Boolean(partner.sourceRef) && (
    source.isError
    || profile.isError
    || isProfilePaused
    || (Boolean(source.data) && profile.isSuccess && !profile.data?.source)
  );
  const isLoadingPublicProfile = Boolean(partner.sourceRef)
    && !publicProfile
    && !isProfileFailed
    && (source.isPending || profile.isPending);
  const showFallbackCard = Boolean(settings || showActivity || (!publicProfile && !isLoadingPublicProfile));
  const loadingWorldId = source.data?.sourceRef.worldId ?? partner.sourceRef?.worldId ?? null;
  const retryProfile = () => {
    if (source.isError || !source.data) {
      void source.refetch();
      return;
    }
    void profile.refetch();
  };
  return <div className="space-y-5" data-testid="partner-details">
    {!settings && !showActivity && publicProfile ? <CharacterSourceDetailPage source={publicProfile}
      onOpenWorld={() => { void navigation.push({ id: 'world-detail', worldId: publicProfile.worldId }); }}
      onPrimaryAction={() => { void chat.openChat(partner); }}
      partner={{ displayName: partner.displayName, avatarUrl: reference.data?.reference?.avatarUrl,
        actions, status: renderStatusContent('stack'),
        sourceNotice: <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-[var(--nimi-text-muted)]">{t(`${P}.characterProfile`)}</span>
          {source.data?.updated ? <p role="status" className="text-xs text-[var(--nimi-text-secondary)]">{t(`${P}.sourceUpdated`)}</p> : null}
        </div>,
      }} /> : !settings && !showActivity && isLoadingPublicProfile ? <PartnerProfileLoading
      displayName={partner.displayName || t(`${P}.unnamed`)}
      avatarUrl={reference.data?.reference?.avatarUrl}
      source={source.data}
      worldId={loadingWorldId}
      onOpenWorld={loadingWorldId ? () => { void navigation.push({ id: 'world-detail', worldId: loadingWorldId }); } : undefined}
      actions={actions}
      status={renderStatusContent('stack')}
      sourceNotice={<div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-[var(--nimi-text-muted)]">{t(`${P}.characterProfile`)}</span>
        <span role="status" className="text-xs text-[var(--nimi-text-muted)]">{t(`${P}.sourceLoading`)}</span>
      </div>}
    /> : showFallbackCard ? <header data-testid="partner-fallback-header" className="rounded-[20px] bg-[var(--nimi-surface-card)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4"><Avatar alt={partner.displayName} size="lg" src={reference.data?.reference?.avatarUrl || undefined} fallback={partner.displayName.slice(0, 1)} />
          <div><h2 className="break-words text-2xl font-semibold">{partner.displayName || t(`${P}.unnamed`)}</h2>
            <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
              {partner.createdAt ? t(`${P}.created`, { time: new Date(partner.createdAt).toLocaleString() }) : t(`${P}.creationUnknown`)}
              {active ? ` · ${t(`${P}.lifecycle.${partner.lifecycle}`, { defaultValue: t(`${P}.lifecycle.0`) })}` : null}
            </p></div></div>
        {actions}
      </div>
      {!active ? <p className="mt-4 text-sm text-[var(--nimi-text-secondary)]">{t(`${P}.lifecycle.${partner.lifecycle}`, { defaultValue: t(`${P}.lifecycle.0`) })}</p> : null}
      {settings && (reference.isError || actionError || chat.failed) ? <InlineAlert tone="warning" className="mt-4">{actionError || t(chat.failed ? `${P}.actionFailed` : `${P}.managerUnavailable`)}</InlineAlert> : null}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--nimi-border-subtle)] pt-4 text-sm">
        {source.data && !source.isError ? <Button tone="ghost" size="sm" onClick={() => { void navigation.push({ id: 'source-detail', sourceRef: source.data.sourceRef }); }}><BookOpen size={15} />{t(`${P}.source`, { name: source.data.displayName })}</Button>
          : <span className="text-[var(--nimi-text-secondary)]">{t(source.isPending && source.fetchStatus !== 'paused' && partner.sourceRef ? `${P}.sourceLoading` : `${P}.sourceUnavailable`)}</span>}
        {partner.sourceRef ? <Button tone="ghost" size="sm" onClick={() => { void navigation.push({ id: 'world-detail', worldId: partner.sourceRef!.worldId }); }}><Globe size={15} />{source.data?.worldName || t(`${P}.world`)}</Button> : null}
        {source.isError ? <Button tone="ghost" size="sm" onClick={() => { void source.refetch(); }}>{t('Common.retry')}</Button> : null}
      </div>
      {source.data?.updated && !source.isError ? <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{t(`${P}.sourceUpdated`)}</p> : null}
    </header> : null}
    {!settings && !showActivity && !publicProfile && !isLoadingPublicProfile ? <div className="space-y-4 px-6">{renderStatusContent('grid')}
      {isProfileFailed ? <InlineAlert tone="warning" action={<Button size="sm" onClick={retryProfile}>{t('Common.retry')}</Button>}>{t(`${P}.sourceUnavailable`)}</InlineAlert> : null}
    </div> : null}
    {showActivity ? !active || reference.isError || (!reference.isPending && !reference.data?.reference?.agentHandle)
      ? <InlineAlert tone="warning">{t(`${P}.activity.unavailable`)}</InlineAlert>
      : reference.isPending ? <LoadingSkeleton lines={4} />
        : <PartnerActivity key={reference.data!.reference!.agentHandle} agentHandle={reference.data!.reference!.agentHandle} /> : null}
    {settings && session ? <>{settings === 'ai-config' ? <p className="text-sm text-[var(--nimi-text-secondary)]">{t(`${P}.sharedAI`)}</p> : null}
      <AgentCenter session={session} activeSection={settings} chrome="standalone" identity={{ displayName: partner.displayName, avatarUrl: reference.data?.reference?.avatarUrl }} i18n={copy}
        onSectionChange={settingsSection => { void navigation.replace({ ...destination, partner: { localAgentRef, settingsSection } }); }}
        placementActions={{ close: () => { void navigation.replace({ ...destination, partner: { localAgentRef } }); },
          openRuntimeSettings: () => bindings.app.commands.runtimeConfigNavigation.openPage('aiSettings'),
          openMachineLoadout: capability => openSetup(capability), openReferenceVoiceSetup: scope => openSetup(scope === 'creation' ? 'voice.create' : 'audio.synthesize', scope === 'creation') }} />
      </> : settings && active && reference.isPending ? <LoadingSkeleton lines={3} /> : null}
  </div>;
}
