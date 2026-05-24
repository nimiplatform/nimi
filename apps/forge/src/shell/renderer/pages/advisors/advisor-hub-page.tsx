/**
 * AI Advisor Hub Page (FG-ADV-002..004)
 *
 * Advisor selection and chat interface for World, Agent, and Revenue advisors.
 * Requires runtime text.stream — shows selection UI + notice.
 * Sessions persist in localStorage per advisor type.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/kit/ui';
import { RuntimeChatPanel } from '@nimiplatform/kit/features/chat/ui';
import {
  useRuntimeChatSession,
  type RuntimeChatSessionMessage,
} from '@nimiplatform/kit/features/chat/runtime';
import { ForgePage, ForgePageHeader } from '@renderer/components/page-layout.js';
import { ForgeActionCard } from '@renderer/components/card-list.js';
import { useWorldResourceQueries } from '@renderer/hooks/use-world-queries.js';
import {
  useAgentDetailQuery,
  useAgentListQuery,
  useAgentSoulPrimeQuery,
} from '@renderer/hooks/use-agent-queries.js';
import {
  useAgentOriginQuery,
  useBalancesQuery,
  useGemHistoryQuery,
  useRevenuePreviewQuery,
  useRevenueShareConfigQuery,
  useSparkHistoryQuery,
} from '@renderer/hooks/use-revenue-queries.js';

type AdvisorType = 'world' | 'agent' | 'revenue';

const ADVISORS: Array<{
  type: AdvisorType;
  titleKey: string;
  descKey: string;
}> = [
  {
    type: 'world',
    titleKey: 'advisors.worldAdvisor',
    descKey: 'advisors.worldAdvisorDesc',
  },
  {
    type: 'agent',
    titleKey: 'advisors.agentCoach',
    descKey: 'advisors.agentCoachDesc',
  },
  {
    type: 'revenue',
    titleKey: 'advisors.revenueOptimizer',
    descKey: 'advisors.revenueOptimizerDesc',
  },
];

type Message = { role: 'user' | 'assistant'; content: string; timestamp: string };
type AdvisorContext =
  | { ready: true; summary: string; contextData: Record<string, unknown> }
  | { ready: false; summary: string; contextData?: undefined };

const STORAGE_KEY_PREFIX = 'nimi:forge:advisor:session:';
const REVENUE_PREVIEW_AMOUNT = '100';

function loadSession(advisorType: AdvisorType): Message[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${advisorType}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSession(advisorType: AdvisorType, messages: Message[]): void {
  try {
    if (messages.length === 0) {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${advisorType}`);
    } else {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${advisorType}`, JSON.stringify(messages));
    }
  } catch {
    // localStorage may be unavailable
  }
}

function hasPersistedSession(advisorType: AdvisorType): boolean {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${advisorType}`);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

function toSessionMessages(messages: Message[]): RuntimeChatSessionMessage[] {
  return messages.map((message, index) => ({
    id: `${message.timestamp}-${index}`,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    status: 'complete',
  }));
}

function toStoredMessages(messages: readonly RuntimeChatSessionMessage[]): Message[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
  }));
}

function formatContextData(contextData: Record<string, unknown>): string {
  return JSON.stringify(contextData, null, 2);
}

function createAdvisorSystemPrompt(
  advisorType: AdvisorType,
  contextData: Record<string, unknown>,
): string {
  const contextBlock = formatContextData(contextData);
  const prompts: Record<AdvisorType, string> = {
    world: `You are a World Advisor for nimi creators. Analyze only the loaded world events, lorebooks, and worldview data in the context block. If a claim is unsupported by the context, say what is missing instead of inventing it.\n\nLoaded world context:\n${contextBlock}`,
    agent: `You are an Agent Coach for nimi creators. Analyze only the loaded agent DNA, soul-prime profile, rules, and conversation seed data in the context block. If a claim is unsupported by the context, say what is missing instead of inventing it.\n\nLoaded agent context:\n${contextBlock}`,
    revenue: `You are a Revenue Optimizer for nimi creators. Analyze only the loaded balances, revenue history, revenue-share configuration, agent revenue origin, and projection preview in the context block. If a claim is unsupported by the context, say what is missing instead of inventing it.\n\nLoaded revenue context:\n${contextBlock}`,
  };
  return prompts[advisorType];
}

function createReportPrompt(advisorType: AdvisorType): string {
  const prompts: Record<AdvisorType, string> = {
    world: 'Generate a comprehensive world analysis report covering timeline consistency, plot holes, character contradictions, lore gaps, and improvement recommendations using only the loaded world context.',
    agent: 'Generate a comprehensive agent coaching report covering trait balance, personality coherence, engagement patterns, and optimization recommendations using only the loaded agent context.',
    revenue: 'Generate a comprehensive revenue optimization report covering pricing strategy, content monetization, timing recommendations, and growth opportunities using only the loaded revenue context.',
  };
  return prompts[advisorType];
}

export default function AdvisorHubPage() {
  const { t } = useTranslation();
  const [selectedAdvisor, setSelectedAdvisor] = useState<AdvisorType | null>(null);
  const [selectedWorldId, setSelectedWorldId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedRevenueAgentId, setSelectedRevenueAgentId] = useState('');

  const worldQueries = useWorldResourceQueries({
    enabled: selectedAdvisor === 'world',
    worldId: selectedWorldId,
    enableCollections: true,
    enableBindings: false,
    enableGovernance: false,
    enableDetailSnapshot: false,
  });
  const agentListQuery = useAgentListQuery(selectedAdvisor === 'agent' || selectedAdvisor === 'revenue');
  const agentDetailQuery = useAgentDetailQuery(selectedAdvisor === 'agent' ? selectedAgentId : '');
  const agentSoulPrimeQuery = useAgentSoulPrimeQuery(
    agentDetailQuery.data?.worldId || '',
    selectedAdvisor === 'agent' ? selectedAgentId : '',
  );
  const balancesQuery = useBalancesQuery(selectedAdvisor === 'revenue');
  const sparkHistoryQuery = useSparkHistoryQuery(selectedAdvisor === 'revenue');
  const gemHistoryQuery = useGemHistoryQuery(selectedAdvisor === 'revenue');
  const revenueConfigQuery = useRevenueShareConfigQuery(selectedAdvisor === 'revenue');
  const revenueAgentOriginQuery = useAgentOriginQuery(
    selectedRevenueAgentId,
    selectedAdvisor === 'revenue',
  );
  const revenuePreviewQuery = useRevenuePreviewQuery(
    REVENUE_PREVIEW_AMOUNT,
    selectedRevenueAgentId,
    selectedAdvisor === 'revenue',
  );

  const advisorContext = useMemo<AdvisorContext>(() => {
    if (selectedAdvisor === 'world') {
      if (!selectedWorldId) {
        return { ready: false, summary: 'Select a world before advisor chat or report generation.' };
      }
      if (worldQueries.stateQuery.isError || worldQueries.historyQuery.isError || worldQueries.lorebooksQuery.isError) {
        return { ready: false, summary: 'World context failed to load; advisor streaming remains blocked.' };
      }
      if (!worldQueries.stateQuery.isSuccess || !worldQueries.historyQuery.isSuccess || !worldQueries.lorebooksQuery.isSuccess) {
        return { ready: false, summary: 'Loading world history, lorebooks, and worldview state.' };
      }
      const selectedWorld = worldQueries.worldsQuery.data?.find((world) => world.id === selectedWorldId);
      return {
        ready: true,
        summary: `World context loaded for ${selectedWorld?.name || selectedWorldId}.`,
        contextData: {
          worldId: selectedWorldId,
          world: selectedWorld,
          eventGraph: worldQueries.historyQuery.data,
          lorebooks: worldQueries.lorebooksQuery.data,
          worldview: worldQueries.stateQuery.data,
        },
      };
    }

    if (selectedAdvisor === 'agent') {
      if (!selectedAgentId) {
        return { ready: false, summary: 'Select an agent before advisor chat or report generation.' };
      }
      if (agentDetailQuery.isError || agentSoulPrimeQuery.isError) {
        return { ready: false, summary: 'Agent context failed to load; advisor streaming remains blocked.' };
      }
      if (!agentDetailQuery.isSuccess || !agentSoulPrimeQuery.isSuccess) {
        return { ready: false, summary: 'Loading agent DNA, soul-prime profile, rules, and conversation seed data.' };
      }
      if (!agentDetailQuery.data.dna) {
        return { ready: false, summary: 'Selected agent has no DNA payload; advisor streaming remains blocked.' };
      }
      return {
        ready: true,
        summary: `Agent context loaded for ${agentDetailQuery.data.displayName || selectedAgentId}.`,
        contextData: {
          agentId: selectedAgentId,
          agent: agentDetailQuery.data,
          dnaTraits: agentDetailQuery.data.dna,
          soulPrime: agentSoulPrimeQuery.data,
          conversationSamples: {
            greeting: agentDetailQuery.data.greeting,
            scenario: agentDetailQuery.data.scenario,
            rules: agentDetailQuery.data.rules,
          },
        },
      };
    }

    if (selectedAdvisor === 'revenue') {
      if (!selectedRevenueAgentId) {
        return { ready: false, summary: 'Select an agent for revenue-origin projection before advisor chat or report generation.' };
      }
      const revenueQueries = [
        balancesQuery,
        sparkHistoryQuery,
        gemHistoryQuery,
        revenueConfigQuery,
        revenueAgentOriginQuery,
        revenuePreviewQuery,
      ];
      if (revenueQueries.some((query) => query.isError)) {
        return { ready: false, summary: 'Revenue context failed to load; advisor streaming remains blocked.' };
      }
      if (revenueQueries.some((query) => !query.isSuccess)) {
        return { ready: false, summary: 'Loading balances, revenue history, share configuration, agent origin, and projection preview.' };
      }
      return {
        ready: true,
        summary: `Revenue context loaded for agent ${selectedRevenueAgentId}.`,
        contextData: {
          selectedAgentId: selectedRevenueAgentId,
          balances: balancesQuery.data,
          sparkHistory: sparkHistoryQuery.data,
          gemHistory: gemHistoryQuery.data,
          revenueShareConfig: revenueConfigQuery.data,
          agentRevenueOrigin: revenueAgentOriginQuery.data,
          projectionPreview: {
            amount: REVENUE_PREVIEW_AMOUNT,
            result: revenuePreviewQuery.data,
          },
        },
      };
    }

    return { ready: false, summary: 'Select an advisor.' };
  }, [
    agentDetailQuery.data,
    agentDetailQuery.isError,
    agentDetailQuery.isSuccess,
    agentSoulPrimeQuery.data,
    agentSoulPrimeQuery.isError,
    agentSoulPrimeQuery.isSuccess,
    balancesQuery,
    gemHistoryQuery,
    revenueAgentOriginQuery,
    revenueConfigQuery,
    revenuePreviewQuery,
    selectedAdvisor,
    selectedAgentId,
    selectedRevenueAgentId,
    selectedWorldId,
    sparkHistoryQuery,
    worldQueries.historyQuery.data,
    worldQueries.historyQuery.isError,
    worldQueries.historyQuery.isSuccess,
    worldQueries.lorebooksQuery.data,
    worldQueries.lorebooksQuery.isError,
    worldQueries.lorebooksQuery.isSuccess,
    worldQueries.stateQuery.data,
    worldQueries.stateQuery.isError,
    worldQueries.stateQuery.isSuccess,
    worldQueries.worldsQuery.data,
  ]);

  const session = useRuntimeChatSession({
    resolveRequest: ({ messages }) => {
      if (!selectedAdvisor || !advisorContext.ready) {
        throw new Error('Advisor context is not loaded; streaming is blocked.');
      }

      return {
        model: 'auto',
        input: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        system: createAdvisorSystemPrompt(selectedAdvisor, advisorContext.contextData),
        temperature: 0.7,
        maxTokens: 2048,
      };
    },
    onMessagesChange: (messages) => {
      if (selectedAdvisor) {
        saveSession(selectedAdvisor, toStoredMessages(messages));
      }
    },
  });
  const streaming = session.isStreaming;
  const sendPrompt = session.sendPrompt;
  const resetMessages = session.resetMessages;

  // Load persisted session when advisor is selected
  useEffect(() => {
    if (selectedAdvisor) {
      resetMessages(toSessionMessages(loadSession(selectedAdvisor)));
    }
  }, [resetMessages, selectedAdvisor]);

  const handleNewSession = useCallback(() => {
    if (selectedAdvisor) {
      saveSession(selectedAdvisor, []);
    }
  }, [selectedAdvisor]);

  const handleBack = useCallback(() => {
    setSelectedAdvisor(null);
    setSelectedWorldId('');
    setSelectedAgentId('');
    setSelectedRevenueAgentId('');
  }, []);

  const handleGenerateReport = useCallback(async () => {
    if (streaming || !selectedAdvisor || !advisorContext.ready) return;
    const reportPrompt = createReportPrompt(selectedAdvisor);
    await sendPrompt({
      prompt: reportPrompt,
      displayPrompt: `[Report Request] ${reportPrompt}`,
      resolveRequest: ({ prompt }) => ({
        model: 'auto',
        input: prompt,
        system: createAdvisorSystemPrompt(selectedAdvisor, advisorContext.contextData),
        temperature: 0.5,
        maxTokens: 4096,
      }),
    });
  }, [advisorContext, selectedAdvisor, sendPrompt, streaming]);

  function renderContextControl() {
    if (selectedAdvisor === 'world') {
      const worlds = worldQueries.worldsQuery.data ?? [];
      return (
        <label className="flex min-w-[18rem] flex-col gap-1 text-xs font-medium text-[var(--nimi-text-muted)]">
          {t('advisors.worldContext', 'World context')}
          <select
            value={selectedWorldId}
            onChange={(event) => setSelectedWorldId(event.target.value)}
            className="rounded-[var(--nimi-radius-input)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2 text-sm text-[var(--nimi-text-primary)]"
          >
            <option value="">{t('advisors.selectWorld', 'Select world')}</option>
            {worlds.map((world) => (
              <option key={world.id} value={world.id}>{world.name || world.id}</option>
            ))}
          </select>
        </label>
      );
    }

    if (selectedAdvisor === 'agent') {
      const agents = agentListQuery.data ?? [];
      return (
        <label className="flex min-w-[18rem] flex-col gap-1 text-xs font-medium text-[var(--nimi-text-muted)]">
          {t('advisors.agentContext', 'Agent context')}
          <select
            value={selectedAgentId}
            onChange={(event) => setSelectedAgentId(event.target.value)}
            className="rounded-[var(--nimi-radius-input)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2 text-sm text-[var(--nimi-text-primary)]"
          >
            <option value="">{t('advisors.selectAgent', 'Select agent')}</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.displayName || agent.handle || agent.id}</option>
            ))}
          </select>
        </label>
      );
    }

    const agents = agentListQuery.data ?? [];
    return (
      <label className="flex min-w-[18rem] flex-col gap-1 text-xs font-medium text-[var(--nimi-text-muted)]">
        {t('advisors.revenueContext', 'Revenue context')}
        <select
          value={selectedRevenueAgentId}
          onChange={(event) => setSelectedRevenueAgentId(event.target.value)}
          className="rounded-[var(--nimi-radius-input)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2 text-sm text-[var(--nimi-text-primary)]"
        >
          <option value="">{t('advisors.selectRevenueAgent', 'Select revenue agent')}</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.displayName || agent.handle || agent.id}</option>
          ))}
        </select>
      </label>
    );
  }

  if (!selectedAdvisor) {
    return (
      <ForgePage>
        <ForgePageHeader
          title={t('pages.advisorHub')}
          subtitle={t('advisors.subtitle', 'AI-powered analysis and recommendations for your content')}
        />

        <div className="grid grid-cols-3 gap-4">
          {ADVISORS.map((advisor) => {
            const sessionLabel = hasPersistedSession(advisor.type)
              ? t('advisors.resumeSession', 'Resume')
              : t('advisors.startSession', 'Start session');
            return (
              <ForgeActionCard
                key={advisor.type}
                title={t(advisor.titleKey, advisor.type)}
                description={`${t(advisor.descKey, `${advisor.type} advisor description`)} ${sessionLabel}.`}
                onClick={() => setSelectedAdvisor(advisor.type)}
              />
            );
          })}
        </div>
      </ForgePage>
    );
  }

  const currentAdvisor = ADVISORS.find((a) => a.type === selectedAdvisor)!;

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col min-h-0">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button tone="ghost" size="sm" onClick={handleBack}>
              &larr; {t('advisors.backToHub', 'Advisors')}
            </Button>
            <h2 className="text-lg font-bold text-[var(--nimi-text-primary)]">
              {t(currentAdvisor.titleKey, currentAdvisor.type)}
            </h2>
          </div>
          <Button
            tone="primary"
            size="sm"
            disabled={streaming || !advisorContext.ready}
            onClick={() => void handleGenerateReport()}
          >
            {streaming ? t('advisors.generating', 'Generating...') : t('advisors.generateReport', 'Generate Report')}
          </Button>
        </div>

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-[var(--nimi-radius-card)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
          {renderContextControl()}
          <p className={`text-sm ${advisorContext.ready ? 'text-[var(--nimi-status-success-text)]' : 'text-[var(--nimi-text-muted)]'}`}>
            {advisorContext.summary}
          </p>
        </div>

        {advisorContext.ready ? (
          <RuntimeChatPanel
            session={session}
            className="flex-1 min-h-0 rounded-[var(--nimi-radius-card)] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_45%,transparent)] shadow-none"
            messagesClassName="h-full min-h-0"
            userMessageBubbleClassName="rounded-[var(--nimi-radius-card)] border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_35%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_82%,white)] text-[var(--nimi-action-primary-text)]"
            assistantMessageBubbleClassName="rounded-[var(--nimi-radius-card)] nimi-material-glass-thin text-[var(--nimi-text-primary)]"
            composerClassName="border-[var(--nimi-border-subtle)]"
            placeholder={t('advisors.inputPlaceholder', 'Ask the advisor...')}
            sendLabel={t('advisors.send', 'Send')}
            streamingLabel={t('advisors.streaming', 'Streaming...')}
            cancelLabel={t('agentDetail.cancel', 'Cancel')}
            resetLabel={t('advisors.newSession', 'New Session')}
            onReset={handleNewSession}
            emptyState={(
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <p className="text-sm text-[var(--nimi-text-muted)]">
                    {t('advisors.emptyChat', 'Start by asking a question or generating a report.')}
                  </p>
                </div>
              </div>
            )}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-[var(--nimi-radius-card)] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_45%,transparent)] p-6">
            <p className="max-w-lg text-center text-sm text-[var(--nimi-text-muted)]">
              {t('advisors.contextRequired', 'Load the required context before starting advisor chat or generating a report.')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
