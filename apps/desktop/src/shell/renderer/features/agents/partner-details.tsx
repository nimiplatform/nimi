import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, InlineAlert, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { AgentCenter, type AgentCenterI18n } from '@nimiplatform/kit/features/agent-center';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { BookOpen, Globe, MessageCircle, Settings } from 'lucide-react';
import { useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useDesktopAgentCenterSession } from '../chat/chat-agent-shell-adapter-runtime.js';
import { resolveCurrentPartnerSource } from '../source-detail/data/realm-source-detail-data.js';
import { fetchSourceDisplayDetail, sourceDisplayDetailQueryKey } from '../source-detail/source-detail-queries.js';
import { CharacterSourceDetailPage } from '../source-detail/source-detail-world-character-view.js';
import { getRuntimeSetupTaskStore } from '../runtime-config/runtime-setup-task-store.js';
import { openRuntimeSetupTaskFromEntry } from '../runtime-config/runtime-setup-task-open.js';
import { projectPartnerRecord } from './partner-directory-model.js';
import { usePartnerChat } from './use-partner-chat.js';
import { PartnerStatus } from './partner-status.js';

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
  const session = useDesktopAgentCenterSession({ agentHandle: active && !reference.isError ? reference.data?.reference?.agentHandle : null });
  const source = useQuery({ queryKey: ['partner-current-source', accountId, scopeKey, localAgentRef, partner?.sourceRef],
    queryFn: () => resolveCurrentPartnerSource(bindings.sdk.realm(), partner!.sourceRef!),
    enabled: Boolean(partner?.sourceRef) && !selected.isError, staleTime: 60_000, retry: false });
  const profile = useQuery({
    queryKey: [...(source.data ? sourceDisplayDetailQueryKey(source.data.sourceRef) : ['partner-profile-unavailable']), accountId, scopeKey],
    queryFn: () => fetchSourceDisplayDetail(source.data!.sourceRef, bindings.sdk),
    enabled: Boolean(source.data) && !source.isError && !selected.isError,
    staleTime: 60_000, retry: false,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const chat = usePartnerChat(accountId);
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
  if (selected.isPending) return <LoadingSkeleton lines={4} />;
  if (selected.isError || !partner) return <InlineAlert tone="warning" action={<Button size="sm" onClick={() => { void selected.refetch(); }}>{t('Common.retry')}</Button>}>{t(`${P}.unavailable`)}</InlineAlert>;
  const actions = <div className="flex flex-wrap gap-2"><Button tone="secondary" disabled={!active || reference.isPending || reference.isError} onClick={() => { void navigation.push({ ...destination, partner: { localAgentRef, settingsSection: 'overview' } }); }}><Settings size={16} />{t(`${P}.manage`)}</Button>
          <Button tone="primary" disabled={!active || Boolean(chat.openingRef) || reference.isError} onClick={() => { void chat.openChat(partner); }}><MessageCircle size={16} />{t(`${P}.chat`)}</Button></div>;
  const statusContent = <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--nimi-text-secondary)]">
      <span>{partner.createdAt ? t(`${P}.created`, { time: new Date(partner.createdAt).toLocaleDateString() }) : t(`${P}.creationUnknown`)}</span>
      <span>{t(`${P}.lifecycle.${partner.lifecycle}`, { defaultValue: t(`${P}.lifecycle.0`) })}</span>
    </div>
    {session ? <PartnerStatus session={session} onManage={section => { void navigation.push({ ...destination, partner: { localAgentRef, settingsSection: section } }); }} /> : null}
    {reference.isError || actionError || chat.failed ? <InlineAlert tone="warning">{actionError || t(chat.failed ? `${P}.actionFailed` : `${P}.managerUnavailable`)}</InlineAlert> : null}
  </div>;
  const publicProfile = !source.isError && !profile.isError ? profile.data?.source : null;
  return <div className="space-y-5" data-testid="partner-details">
    {!settings && publicProfile ? <CharacterSourceDetailPage source={publicProfile}
      onOpenWorld={() => { void navigation.push({ id: 'world-detail', worldId: publicProfile.worldId }); }}
      onPrimaryAction={() => { void chat.openChat(partner); }}
      partner={{ displayName: partner.displayName, avatarUrl: reference.data?.reference?.avatarUrl,
        actions, status: statusContent,
        sourceNotice: <div className="border-t border-[var(--nimi-border-subtle)] pt-5">
          <h2 className="text-lg font-semibold">{t(`${P}.characterProfile`)}</h2>
          {source.data?.updated ? <p role="status" className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{t(`${P}.sourceUpdated`)}</p> : null}
        </div>,
      }} /> : <header className="rounded-[20px] bg-[var(--nimi-surface-card)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4"><Avatar alt={partner.displayName} size="lg" src={reference.data?.reference?.avatarUrl || undefined} fallback={partner.displayName.slice(0, 1)} />
          <div><h2 className="break-words text-2xl font-semibold">{partner.displayName || t(`${P}.unnamed`)}</h2>
            <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{partner.createdAt ? t(`${P}.created`, { time: new Date(partner.createdAt).toLocaleString() }) : t(`${P}.creationUnknown`)}</p></div></div>
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
    </header>}
    {!settings && !publicProfile ? <div className="space-y-4 px-6">{statusContent}
      {source.isError || profile.isError ? <InlineAlert tone="warning" action={<Button size="sm" onClick={() => { void source.refetch(); void profile.refetch(); }}>{t('Common.retry')}</Button>}>{t(`${P}.sourceUnavailable`)}</InlineAlert> : partner.sourceRef ? <LoadingSkeleton lines={4} /> : null}
    </div> : null}
    {settings && session ? <>{settings === 'ai-config' ? <p className="text-sm text-[var(--nimi-text-secondary)]">{t(`${P}.sharedAI`)}</p> : null}
      <AgentCenter session={session} activeSection={settings} chrome="standalone" identity={{ displayName: partner.displayName, avatarUrl: reference.data?.reference?.avatarUrl }} i18n={copy}
        onSectionChange={settingsSection => { void navigation.replace({ ...destination, partner: { localAgentRef, settingsSection } }); }}
        placementActions={{ close: () => { void navigation.replace({ ...destination, partner: { localAgentRef } }); },
          openRuntimeSettings: () => bindings.app.commands.runtimeConfigNavigation.openPage('aiSettings'),
          openMachineLoadout: capability => openSetup(capability), openReferenceVoiceSetup: scope => openSetup(scope === 'creation' ? 'voice.create' : 'audio.synthesize', scope === 'creation') }} />
      </> : settings && active && reference.isPending ? <LoadingSkeleton lines={3} /> : null}
  </div>;
}
