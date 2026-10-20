import type { NimiLocalAppAgentHandle, NimiLocalAppConversationClient } from '@nimiplatform/kit/core/sdk-contract';
import type { AgentPendingSubmission } from './local-app-conversation-draft.js';

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-061
export async function reconcileAgentSubmission(input: {
  conversation: NimiLocalAppConversationClient;
  agentHandle: NimiLocalAppAgentHandle;
  submission: AgentPendingSubmission;
  sendIfMissing: boolean;
  isCurrent: () => boolean;
}): Promise<boolean> {
  const { submission, conversation, agentHandle } = input;
  const scope = { agentHandle, conversationAnchorId: submission.conversationAnchorId };
  if (!input.isCurrent()) return false;
  if (!input.sendIfMissing) {
    const snapshot = await conversation.snapshot({agentHandle,conversationAnchorId:submission.conversationAnchorId});
    // Snapshot history may be bounded. Absence never proves non-admission.
    return input.isCurrent() && snapshot.turns.some((turn) => turn.requestId === submission.requestId);
  }
  // The same request ID lets Runtime return its admitted turn or accept this
  // original request once. A separate snapshot is not a prerequisite.
  await conversation.send(
    submission.retryOfTurnId
      ? { ...scope, requestId: submission.requestId, retryOfTurnId: submission.retryOfTurnId }
      : {
          ...scope,
          requestId: submission.requestId,
          parts: [
            ...(submission.text ? [{ kind: 'text' as const, text: submission.text }] : []),
            ...submission.artifactIds.map((artifactId) => ({
              kind: 'artifact-ref' as const,
              artifactId,
            })),
          ],
        },
  );
  return input.isCurrent();
}
