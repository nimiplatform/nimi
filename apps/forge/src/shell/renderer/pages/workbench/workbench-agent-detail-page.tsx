import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { RuntimeChatPanel } from '@nimiplatform/nimi-kit/features/chat/ui';
import { useRuntimeChatSession } from '@nimiplatform/nimi-kit/features/chat/runtime';
import { ForgePage, ForgeEmptyState } from '@renderer/components/page-layout.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { LabeledTextField, LabeledTextareaField } from '@renderer/components/form-fields.js';
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
        <ForgeEmptyState
          message="Agent draft not found."
          action="Back to Workbench"
          onAction={() => navigate(`/workbench/${workspaceId}?panel=AGENTS`)}
        />
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
    <ForgePage maxWidth="max-w-5xl">
      <div className="flex items-center gap-3">
        <Button
          tone="ghost"
          size="sm"
          onClick={() => navigate(`/workbench/${workspaceId}?panel=AGENTS`)}
        >
          &larr; Back to Workbench
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-[var(--nimi-text-primary)]">{agentDraft.displayName}</h1>
          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">@{agentDraft.handle}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        {/* Agent Truth */}
        <Surface tone="card" padding="md">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-secondary)]">Agent Truth</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <LabeledTextField
              label="Display Name"
              value={agentDraft.displayName}
              onChange={(value) => updateAgentDraft(workspaceId, agentId, { displayName: value })}
            />
            <LabeledTextField
              label="Handle"
              value={agentDraft.handle}
              onChange={(value) => updateAgentDraft(workspaceId, agentId, { handle: value })}
            />
          </div>
          <LabeledTextareaField
            label="Concept"
            value={agentDraft.concept}
            onChange={(value) => updateAgentDraft(workspaceId, agentId, { concept: value })}
            rows={4}
            className="mt-4"
          />

          <div className="mt-6 space-y-3">
            {(bundle?.rules || []).map((rule, index) => (
              <Surface key={rule.ruleKey} tone="card" padding="sm">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-xs text-[var(--nimi-text-muted)]">{rule.ruleKey}</code>
                  <ForgeStatusBadge domain="generic" status={rule.layer} tone="neutral" />
                </div>
                <LabeledTextField
                  label=""
                  value={rule.title}
                  onChange={(value) => updateReviewAgentRule(workspaceId, agentId, index, {
                    title: value,
                  })}
                  className="mt-3"
                />
                <LabeledTextareaField
                  label=""
                  value={rule.statement}
                  onChange={(value) => updateReviewAgentRule(workspaceId, agentId, index, {
                    statement: value,
                  })}
                  rows={3}
                  className="mt-3"
                />
              </Surface>
            ))}
          </div>
        </Surface>

        {/* Personality Preview */}
        <Surface tone="card" padding="md">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-secondary)]">Personality Preview</h2>
              <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">
                Preview uses the local draft concept and agent rules without requiring a persisted backend agent.
              </p>
            </div>
            <Button tone="secondary" size="sm" onClick={() => resetMessages([])}>
              {t('agentDetail.resetChat', 'Reset')}
            </Button>
          </div>

          <Surface tone="card" padding="sm" className="mt-5">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">System Prompt</p>
            <pre className="mt-3 whitespace-pre-wrap text-xs leading-6 text-[var(--nimi-text-secondary)]">{systemPrompt}</pre>
          </Surface>

          <RuntimeChatPanel
            session={session}
            className="mt-5 rounded-[var(--nimi-radius-card)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] shadow-none"
            messagesClassName="h-80"
            userMessageBubbleClassName="max-w-[85%] rounded-2xl bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]"
            assistantMessageBubbleClassName="max-w-[85%] rounded-2xl bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-primary)]"
            composerClassName="border-[var(--nimi-border-subtle)]"
            placeholder={t('agentDetail.chatPlaceholder', 'Type a message...')}
            sendLabel={t('agentDetail.send', 'Send')}
            streamingLabel={t('agentDetail.streaming', 'Streaming...')}
            cancelLabel={t('agentDetail.cancel', 'Cancel')}
            resetLabel={t('agentDetail.resetChat', 'Reset')}
            onReset={() => resetMessages([])}
            emptyState={(
              <p className="py-8 text-center text-sm text-[var(--nimi-text-muted)]">
                No preview messages yet.
              </p>
            )}
          />
        </Surface>
      </div>
    </ForgePage>
  );
}
