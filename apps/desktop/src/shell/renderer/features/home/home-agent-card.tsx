import { Avatar, Button, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUp, Compass, MessageCircle } from 'lucide-react';
import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { resolveAgentTargetSnapshotForSourceRef } from '../agents/agent-conversation-source-resolution.js';
import {
  fetchLocalAgentList,
  localAgentListQueryKey,
  type LocalAgentListItem,
} from '../agents/local-agent-list-model.js';
import { launchAgentConversationFromDisplay } from '../chat/agent-conversation-launcher.js';

export type HomeAgentCardState = 'loading' | 'none' | 'unavailable' | 'ready';

export type HomeOtherAgent = { id: string; displayName: string; avatarUrl: string | null };

export type HomeAgentCardViewProps = {
  state: HomeAgentCardState;
  agent: { displayName: string; avatarUrl: string | null } | null;
  /** Other ready agents shown as avatars under the continue action; empty hides the row. */
  otherAgents: readonly HomeOtherAgent[];
  /** Other agents beyond the shown avatars, rendered as a +N chip. */
  hiddenAgentCount: number;
  /** Greeting rendered at the top-left of the hero. */
  heading: ReactNode;
  /** One-line device status rendered under the greeting. */
  status: ReactNode;
  onContinueChat: () => void;
  /** Called with the trimmed composer text; the caller routes to the agent conversation. */
  onSendMessage: (text: string) => void;
  onExplore: () => void;
  /** Opens the conversation with one of the other agents, by id. */
  onOpenAgent: (id: string) => void;
  /** Opens the agent conversation list so the user can pick one of the other agents. */
  onViewAllAgents: () => void;
};

const PROMPT_KEYS = ['introduce', 'thinking', 'story'] as const;
/** Avatar slots for the other agents; with more agents the last slot becomes a +N chip. */
const OTHER_AGENT_SLOTS = 4;

function AgentAvatar({ displayName, avatarUrl }: { displayName: string; avatarUrl: string | null }) {
  const { t } = useTranslation();
  const initial = displayName.trim().slice(0, 1) || '?';
  const readyLabel = t('runtimeConfig.overview.agentCard.ready');
  return (
    <span className="relative shrink-0">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="size-16 rounded-[20px] object-cover" />
      ) : (
        <span className="flex size-16 items-center justify-center rounded-[20px] bg-[var(--nimi-surface-active)] text-2xl font-semibold text-[var(--nimi-action-primary-bg)]">
          {initial}
        </span>
      )}
      {/* The dot is the only ready signal, so it carries the label for hover and assistive tech. */}
      <span
        role="img"
        aria-label={readyLabel}
        title={readyLabel}
        className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-[var(--nimi-surface-card)] bg-[var(--nimi-status-success)]"
        data-testid="home-agent-ready-dot"
      />
    </span>
  );
}

function AgentComposer({ agentName, onSendMessage }: { agentName: string; onSendMessage: (text: string) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setText('');
  };
  return (
    <div className="flex flex-col gap-2.5">
      <form
        onSubmit={submit}
        className="flex h-[54px] items-center gap-2 rounded-[18px] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] pl-5 pr-2"
        data-testid="home-agent-composer"
      >
        <label htmlFor="home-agent-composer-input" className="sr-only">
          {t('runtimeConfig.overview.composerLabel', { name: agentName })}
        </label>
        <input
          id="home-agent-composer-input"
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('runtimeConfig.overview.composerPlaceholder', { name: agentName })}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--nimi-field-text)] outline-none placeholder:text-[var(--nimi-field-placeholder)]"
          autoComplete="off"
        />
        <Button type="submit" tone="primary" size="sm" disabled={!text.trim()} data-testid="home-agent-send">
          {t('runtimeConfig.overview.composerSend')}
          <ArrowUp size={14} strokeWidth={2.4} />
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.overview.tryPrompts')}</span>
        {PROMPT_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setText(t(`runtimeConfig.overview.prompts.${key}`))}
            className="h-[30px] rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 text-xs transition-colors hover:bg-[var(--nimi-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            data-testid={`home-agent-prompt:${key}`}
          >
            {t(`runtimeConfig.overview.prompts.${key}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Presentational hero: greeting + device status + agent composer on the left, agent panel on the right. Mood is deferred until Runtime projects it. */
export function HomeAgentCardView({
  state,
  agent,
  otherAgents,
  hiddenAgentCount,
  heading,
  status,
  onContinueChat,
  onSendMessage,
  onExplore,
  onOpenAgent,
  onViewAllAgents,
}: HomeAgentCardViewProps) {
  const { t } = useTranslation();
  const ready = state === 'ready' && Boolean(agent);
  return (
    <section
      className="relative overflow-hidden rounded-[28px] bg-[var(--nimi-surface-panel)] p-6 shadow-[var(--nimi-elevation-base)] lg:p-7 lg:pl-9"
      data-testid="home-agent-card"
      data-state={state}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(circle 420px at 100% 0%, var(--nimi-accent-soft), transparent 70%)' }}
      />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:gap-7">
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-6 pt-1">
          <div className="flex flex-col gap-2">
            {heading}
            {status}
          </div>
          {ready && agent ? <AgentComposer agentName={agent.displayName} onSendMessage={onSendMessage} /> : null}
        </div>

        <div
          className="flex w-full shrink-0 flex-col justify-between gap-4 rounded-[22px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 lg:w-[268px]"
          data-testid="home-agent-panel"
        >
          {state === 'loading' ? (
            <LoadingSkeleton lines={2} label={t('Common.loading')} />
          ) : state === 'unavailable' ? (
            <p className="text-sm text-[var(--nimi-status-warning)]">{t('runtimeConfig.overview.agentCard.unavailable')}</p>
          ) : state === 'none' || !agent ? (
            <>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t('runtimeConfig.overview.agentCard.none')}</p>
                <p className="mt-0.5 text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.overview.agentCard.noneBody')}</p>
              </div>
              <Button tone="primary" size="sm" onClick={onExplore} data-testid="home-agent-explore">
                <Compass size={15} />
                {t('runtimeConfig.overview.agentCard.explore')}
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3.5">
                <AgentAvatar displayName={agent.displayName} avatarUrl={agent.avatarUrl} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[11px] tracking-wide text-[var(--nimi-text-muted)]">
                    {t('runtimeConfig.overview.agentCard.current')}
                  </span>
                  <span className="truncate text-lg font-semibold leading-tight" data-testid="home-agent-name">
                    {agent.displayName}
                  </span>
                </div>
              </div>
              <Button tone="primary" size="sm" className="w-full" onClick={onContinueChat} data-testid="home-agent-chat">
                <MessageCircle size={15} />
                {t('runtimeConfig.overview.agentCard.continueChat')}
              </Button>
              {otherAgents.length > 0 ? (
                <div
                  className="flex items-center justify-between gap-2 border-t border-[var(--nimi-border-subtle)] pt-3"
                  data-testid="home-agent-more"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    {otherAgents.map((other) => {
                      const label = t('runtimeConfig.overview.agentCard.chatWithAgent', { name: other.displayName });
                      return (
                        <button
                          key={other.id}
                          type="button"
                          onClick={() => onOpenAgent(other.id)}
                          aria-label={label}
                          title={label}
                          className="flex shrink-0 rounded-[9px] transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                          data-testid={`home-agent-other:${other.id}`}
                        >
                          <Avatar
                            src={other.avatarUrl}
                            alt={other.displayName}
                            shape="rounded"
                            className="h-7 w-7 rounded-[9px]"
                            fallbackClassName="bg-[var(--nimi-surface-active)] text-xs font-semibold text-[var(--nimi-action-primary-bg)]"
                          />
                        </button>
                      );
                    })}
                    {hiddenAgentCount > 0 ? (
                      <span className="flex h-7 min-w-7 items-center justify-center rounded-[9px] bg-[var(--nimi-surface-active)] px-1.5 text-[11px] font-medium text-[var(--nimi-text-secondary)]">
                        {`+${hiddenAgentCount}`}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={onViewAllAgents}
                    className="flex shrink-0 items-center gap-1 text-xs text-[var(--nimi-text-secondary)] transition-colors hover:text-[var(--nimi-action-primary-bg)]"
                    data-testid="home-agent-view-all"
                  >
                    {t('runtimeConfig.overview.agentCard.viewAllAgents')}
                    <ArrowRight size={13} />
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** Live wrapper used by Home. Agent truth comes from Runtime; the composer routes into the agent conversation with the text prefilled. */
export function HomeAgentCard({ heading, status }: { heading: ReactNode; status: ReactNode }) {
  const bindings = useDesktopRendererBindings();
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const setPendingAgentComposerPrefill = useAppStore((state) => state.setPendingAgentComposerPrefill);
  const enabled = authStatus === 'authenticated' && Boolean(ownerUserId);

  // Shared key with Explore and Source Detail so the list is fetched once per session.
  const agents = useQuery({
    queryKey: localAgentListQueryKey(ownerUserId),
    queryFn: () => fetchLocalAgentList(ownerUserId, bindings.sdk),
    enabled,
    staleTime: 30_000,
  });
  const agentList = agents.data ?? [];
  const agent: LocalAgentListItem | null = agentList[0] ?? null;
  const others = agentList.slice(1);
  const shownOthers = others.length > OTHER_AGENT_SLOTS ? others.slice(0, OTHER_AGENT_SLOTS - 1) : others;

  // One reference per rendered agent supplies its Runtime display name and avatar.
  const references = useQueries({
    queries: (agent ? [agent, ...shownOthers] : []).map((item) => ({
      queryKey: ['home-agent-reference', item.localAgentRef],
      queryFn: async () => (await bindings.sdk.resolveDesktopAgentReference({
        localAgentRef: item.localAgentRef,
      })).reference ?? null,
      staleTime: 60_000,
    })),
  });
  const withReference = (item: LocalAgentListItem, index: number): HomeOtherAgent => {
    const reference = references[index]?.data;
    return {
      id: item.localAgentRef,
      displayName: reference?.displayName?.trim() || item.displayName,
      avatarUrl: reference?.avatarUrl?.trim() || null,
    };
  };

  const openConversation = useCallback(async (selected: LocalAgentListItem | null | undefined, initialComposerText?: string) => {
    if (!selected) return;
    const target = await resolveAgentTargetSnapshotForSourceRef({
      sourceRef: selected.sourceRef,
      ownerUserId,
      sdk: bindings.sdk,
    }).catch(() => null);
    if (target) {
      await launchAgentConversationFromDisplay({
        target,
        initialComposerText: initialComposerText ?? null,
        setActiveTab,
        setChatMode,
        setSelectedTargetForSource,
        setAgentConversationSelection,
        setAgentConversationTargetSnapshot,
        setPendingAgentComposerPrefill,
      });
      return;
    }
    // Fall back to the agent chat list; it states unavailability explicitly.
    // The typed text is still prefilled by source key so it is not lost.
    if (initialComposerText) {
      setPendingAgentComposerPrefill({ sourceKey: selected.sourceKey, text: initialComposerText });
    }
    setSelectedTargetForSource('agent', null);
    setChatMode('agent');
    setActiveTab('chat');
  }, [
    bindings.sdk,
    ownerUserId,
    setActiveTab,
    setAgentConversationSelection,
    setAgentConversationTargetSnapshot,
    setChatMode,
    setPendingAgentComposerPrefill,
    setSelectedTargetForSource,
  ]);

  const openAgentList = useCallback(() => {
    setSelectedTargetForSource('agent', null);
    setChatMode('agent');
    setActiveTab('chat');
  }, [setActiveTab, setChatMode, setSelectedTargetForSource]);

  const state: HomeAgentCardState = !enabled || agents.isPending
    ? 'loading'
    : agents.isError
      ? 'unavailable'
      : agent
        ? 'ready'
        : 'none';
  return (
    <HomeAgentCardView
      state={state}
      agent={agent ? withReference(agent, 0) : null}
      otherAgents={shownOthers.map((item, index) => withReference(item, index + 1))}
      hiddenAgentCount={others.length - shownOthers.length}
      heading={heading}
      status={status}
      onContinueChat={() => void openConversation(agent)}
      onSendMessage={(text) => void openConversation(agent, text)}
      onExplore={() => setActiveTab('explore')}
      onOpenAgent={(id) => void openConversation(shownOthers.find((item) => item.localAgentRef === id))}
      onViewAllAgents={openAgentList}
    />
  );
}
