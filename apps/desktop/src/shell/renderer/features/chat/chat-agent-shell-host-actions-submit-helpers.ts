import type {
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
} from '../../bridge/runtime-bridge/types';
import {
  createEmptyAgentThreadBundle,
} from './chat-agent-shell-bundle';
import type {
  UseAgentConversationHostActionsInput,
} from './chat-agent-shell-host-actions-types';

export function toFallbackThreadRecord(
  thread: AgentLocalThreadSummary | AgentLocalThreadRecord,
  nowMs: number,
): AgentLocalThreadRecord {
  if ('createdAtMs' in thread && typeof thread.createdAtMs === 'number') {
    return {
      ...thread,
      createdAtMs: thread.createdAtMs,
    };
  }
  return {
    ...thread,
    createdAtMs: nowMs,
  };
}

export async function rollbackOptimisticUserProjection(input: {
  hostInput: UseAgentConversationHostActionsInput;
  optimisticThreadId: string | null;
  optimisticBaseThread: AgentLocalThreadRecord | null;
  optimisticUserMessageIds: readonly string[];
  submittedTextForRecovery: string;
  restoreComposerText: boolean;
}): Promise<void> {
  // Projection rollback also applies to image-only input. Whether the old
  // composer may restore text is a separate decision below.
  if (
    !input.optimisticThreadId
    || !input.optimisticBaseThread
  ) {
    return;
  }
  const rollbackThreadId = input.optimisticThreadId;
  const rollbackThread = input.optimisticBaseThread;
  if (input.restoreComposerText) input.hostInput.currentComposerTextRef.current = input.submittedTextForRecovery;
  input.hostInput.setBundleCache(rollbackThreadId, (current) => {
    const base = current || createEmptyAgentThreadBundle(rollbackThread);
    return {
      ...base,
      thread: rollbackThread,
      messages: base.messages.filter((message) => !input.optimisticUserMessageIds.includes(message.id)),
    };
  });
}
