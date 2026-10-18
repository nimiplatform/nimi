import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { createNimiClientId } from '@nimiplatform/sdk';
import {
  ensureThreadAnchorBindingForTarget,
  uploadPendingAttachment,
} from './chat-agent-shell-host-actions-helpers';
import { toChatAgentRuntimeError } from './chat-agent-runtime';
import type {
  AgentConversationSubmitPayload,
  LockTokenRef,
  UseAgentConversationHostActionsInput,
} from './chat-agent-shell-host-actions-types';

// @nimi-authority: rule.nimi.desktop.agent-projection.r029
// The permanent canonical subscription owns every reply and media update.
// Send confirms admission only; it never fabricates a completed model turn.
export async function submitAgentConversationTurn(input: {
  hostInput: UseAgentConversationHostActionsInput;
  payload: AgentConversationSubmitPayload;
  submittingLockTokenRef: LockTokenRef;
}): Promise<void> {
  const host = input.hostInput;
  const target = host.activeTarget;
  if (!target) throw new Error(host.t('Chat.agentSubmitMissingThread'));
  const text = input.payload.text.trim();
  if (!input.payload.retryOfTurnId && !text && input.payload.attachments.length === 0) return;
  const token = ++input.submittingLockTokenRef.current;
  host.setSubmittingThreadId(host.activeThreadId || target.agentHandle || 'pending');
  const conversation = host.sdk.conversation();
  let preparedRequestId: string | undefined;
  try {
    const context = await ensureThreadAnchorBindingForTarget({
      input: host,
      target,
      thread: host.activeThreadId && host.selectedThreadRecord ? host.selectedThreadRecord : null,
    });
    const conversationAnchorId = context.anchorBinding.conversationAnchorId;
    host.setSubmittingThreadId(context.thread.id);
    const attachments = await Promise.all(
      input.payload.attachments.map((attachment) =>
        uploadPendingAttachment(host, attachment, target, conversationAnchorId),
      ),
    );
    const requestId = createNimiClientId('runtime-agent-turn-request');
    if (!host.submissionPersistence)
      throw new Error(host.t('Chat.agentDraftUnavailableForSubmission'));
    await host.submissionPersistence.prepare({
      requestId,
      conversationAnchorId,
      text,
      artifactIds: attachments.map((item) => item.artifactId),
      ...(input.payload.retryOfTurnId ? { retryOfTurnId: input.payload.retryOfTurnId } : {}),
    });
    preparedRequestId = requestId;
    if (input.payload.canUpdateDraft?.() !== false) host.currentComposerTextRef.current = '';
    const scope = {
      agentHandle: target.agentHandle as Parameters<typeof conversation.send>[0]['agentHandle'],
      conversationAnchorId,
      requestId,
    };
    await conversation.send(
      input.payload.retryOfTurnId
        ? { ...scope, retryOfTurnId: input.payload.retryOfTurnId }
        : {
            ...scope,
            parts: [
              ...(text ? [{ kind: 'text' as const, text }] : []),
              ...attachments.map((attachment) => ({
                kind: 'artifact-ref' as const,
                artifactId: attachment.artifactId,
              })),
            ],
          },
    );
    void host.submissionPersistence.acknowledge(requestId);
    host.setFooterHostState(context.thread.id, null);
  } catch (error) {
    // Runtime's AGENT_BUSY is an explicit pre-admission rejection. Transport
    // failures retain their copy because receipt loss cannot prove rejection.
    if (preparedRequestId && extractNimiErrorFields(error).reasonCode === 'AGENT_BUSY') {
      await host.submissionPersistence?.acknowledge(preparedRequestId);
    }
    const described = toChatAgentRuntimeError(error, host.t);
    host.reportHostError(error);
    throw new Error(described.message, { cause: error });
  } finally {
    if (input.submittingLockTokenRef.current === token) host.setSubmittingThreadId(null);
  }
}
