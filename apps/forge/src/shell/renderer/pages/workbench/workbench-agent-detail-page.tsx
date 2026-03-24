import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { RuntimeChatPanel } from '@nimiplatform/nimi-kit/features/chat/ui';
import { useRuntimeChatSession } from '@nimiplatform/nimi-kit/features/chat/runtime';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';

function buildDraftSystemPrompt(input: {
  displayName: string;
  concept: string;
  rules: Array<{ title: string; statement: string; layer: string }>;
}) {
  return [
    `You are roleplaying as ${input.displayName}.`,
    input.concept ? `Concept: ${input.concept}` : '',
    ...input.rules.slice(0, 12).map((rule) => `[${rule.layer}] ${rule.title}: ${rule.statement}`),
  ].filter(Boolean).join('\n');
}

export default function WorkbenchAgentDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspaceId = '', agentId = '' } = useParams<{ workspaceId: string; agentId: string }>();
  const snapshot = useForgeWorkspaceStore((state) => state.workspaces[workspaceId]);
  const agentDraft = useForgeWorkspaceStore((state) => state.workspaces[workspaceId]?.agentDrafts[agentId]);
  const updateAgentDraft = useForgeWorkspaceStore((state) => state.updateAgentDraft);
  const updateReviewAgentRule = useForgeWorkspaceStore((state) => state.updateReviewAgentRule);

  const bundle = useMemo(
    () => snapshot?.reviewState.agentBundles.find((item) => item.draftAgentId === agentId) ?? null,
    [agentId, snapshot?.reviewState.agentBundles],
  );

  if (!snapshot || !agentDraft) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-neutral-400">Agent draft not found.</p>
          <button
            onClick={() => navigate(`/workbench/${workspaceId}?panel=AGENTS`)}
            className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
          >
            Back to Workbench
          </button>
        </div>
      </div>
    );
  }

  const systemPrompt = buildDraftSystemPrompt({
    displayName: agentDraft.displayName,
    concept: agentDraft.concept,
    rules: (bundle?.rules || []).map((rule) => ({
      title: rule.title,
      statement: rule.statement,
      layer: rule.layer,
    })),
  });
  const session = useRuntimeChatSession({
    resolveRequest: ({ messages }) => ({
      model: 'auto',
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      system: systemPrompt,
      temperature: 0.8,
      maxTokens: 1024,
    }),
  });
  const resetMessages = session.resetMessages;

  return (
    <div className="h-full overflow-auto p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/workbench/${workspaceId}?panel=AGENTS`)}
            className="text-sm text-neutral-400 transition-colors hover:text-white"
          >
            &larr; Back to Workbench
          </button>
          <div>
            <h1 className="text-2xl font-semibold text-white">{agentDraft.displayName}</h1>
            <p className="mt-1 text-xs text-neutral-500">@{agentDraft.handle}</p>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <section className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-neutral-300">Agent Truth</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.14em] text-neutral-500">Display Name</span>
                <input
                  value={agentDraft.displayName}
                  onChange={(event) => updateAgentDraft(workspaceId, agentId, { displayName: event.target.value })}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.14em] text-neutral-500">Handle</span>
                <input
                  value={agentDraft.handle}
                  onChange={(event) => updateAgentDraft(workspaceId, agentId, { handle: event.target.value })}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white"
                />
              </label>
            </div>
            <label className="mt-4 block space-y-2">
              <span className="text-xs uppercase tracking-[0.14em] text-neutral-500">Concept</span>
              <textarea
                rows={4}
                value={agentDraft.concept}
                onChange={(event) => updateAgentDraft(workspaceId, agentId, { concept: event.target.value })}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white"
              />
            </label>

            <div className="mt-6 space-y-3">
              {(bundle?.rules || []).map((rule, index) => (
                <div key={rule.ruleKey} className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-xs text-neutral-500">{rule.ruleKey}</code>
                    <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-300">
                      {rule.layer}
                    </span>
                  </div>
                  <input
                    value={rule.title}
                    onChange={(event) => updateReviewAgentRule(workspaceId, agentId, index, {
                      title: event.target.value,
                    })}
                    className="mt-3 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
                  />
                  <textarea
                    rows={3}
                    value={rule.statement}
                    onChange={(event) => updateReviewAgentRule(workspaceId, agentId, index, {
                      statement: event.target.value,
                    })}
                    className="mt-3 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-neutral-300">Personality Preview</h2>
                <p className="mt-2 text-sm text-neutral-500">
                  Preview uses the local draft concept and agent rules without requiring a persisted backend agent.
                </p>
              </div>
              <button
                onClick={() => resetMessages([])}
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300"
              >
                {t('agentDetail.resetChat', 'Reset')}
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">System Prompt</p>
              <pre className="mt-3 whitespace-pre-wrap text-xs leading-6 text-neutral-400">{systemPrompt}</pre>
            </div>

            <RuntimeChatPanel
              session={session}
              className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-950/80 shadow-none"
              messagesClassName="h-80"
              userMessageBubbleClassName="max-w-[85%] rounded-2xl bg-white text-black"
              assistantMessageBubbleClassName="max-w-[85%] rounded-2xl bg-neutral-800 text-white"
              composerClassName="border-neutral-800"
              placeholder={t('agentDetail.chatPlaceholder', 'Type a message...')}
              sendLabel={t('agentDetail.send', 'Send')}
              streamingLabel={t('agentDetail.streaming', 'Streaming...')}
              cancelLabel={t('agentDetail.cancel', 'Cancel')}
              resetLabel={t('agentDetail.resetChat', 'Reset')}
              onReset={() => resetMessages([])}
              emptyState={(
                <p className="py-8 text-center text-sm text-neutral-500">
                  No preview messages yet.
                </p>
              )}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
