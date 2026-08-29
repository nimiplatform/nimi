import {
  isNimiLocalAppAgentSelectorMismatchError,
  type NimiLocalAppAgentHandle,
  type NimiLocalAppAgentReference,
  type NimiLocalAppConversationClient,
} from '@nimiplatform/sdk/app';

export type ZhiyuConversationSelectionRemintResult = Readonly<
  | {
      readonly outcome: 'reminted';
      readonly agentHandle: NimiLocalAppAgentHandle;
      readonly conversationAnchorId: string;
    }
  | {
      readonly outcome: 'selection-required';
      readonly reasonCode: 'zhiyu-conversation-selection-remint-not-found';
      readonly actionHint: 'select_runtime_local_agent';
    }
>;

export type ZhiyuConversationSelectionRemintInput = Readonly<{
  readonly previousConversationAnchorId: string;
  readonly currentReferences: readonly NimiLocalAppAgentReference[];
  readonly conversation: Pick<NimiLocalAppConversationClient, 'snapshot'>;
  readonly isCurrent?: () => boolean;
}>;

export type ZhiyuConversationSelectionRemintErrorCode =
  | 'ZHIYU_CONVERSATION_REMINT_INPUT_INVALID'
  | 'ZHIYU_CONVERSATION_REMINT_PROJECTION_INVALID'
  | 'ZHIYU_CONVERSATION_REMINT_AMBIGUOUS'
  | 'ZHIYU_CONVERSATION_REMINT_STALE';

export class ZhiyuConversationSelectionRemintError extends Error {
  readonly code: ZhiyuConversationSelectionRemintErrorCode;

  constructor(code: ZhiyuConversationSelectionRemintErrorCode, message: string) {
    super(message);
    this.name = 'ZhiyuConversationSelectionRemintError';
    this.code = code;
  }
}

function requireAnchor(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256
    || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ZhiyuConversationSelectionRemintError(
      'ZHIYU_CONVERSATION_REMINT_INPUT_INVALID',
      'Zhiyu conversation remint requires one exact Runtime Conversation anchor.',
    );
  }
  return value;
}

function freezeCurrentHandles(
  references: readonly NimiLocalAppAgentReference[],
): readonly NimiLocalAppAgentHandle[] {
  const handles: NimiLocalAppAgentHandle[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    const handle = reference?.agentHandle;
    if (typeof handle !== 'string' || !handle || seen.has(handle)) {
      throw new ZhiyuConversationSelectionRemintError(
        'ZHIYU_CONVERSATION_REMINT_INPUT_INVALID',
        'Zhiyu conversation remint requires unique current-session Agent references.',
      );
    }
    seen.add(handle);
    handles.push(handle);
  }
  return Object.freeze(handles);
}

// Candidate remains outside the active selection path until the WP6 hard cut.
// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r003
// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r005
export async function remintZhiyuConversationSelectionCandidate(
  input: ZhiyuConversationSelectionRemintInput,
): Promise<ZhiyuConversationSelectionRemintResult> {
  const isCurrent = input.isCurrent ?? (() => true);
  if (typeof input.conversation?.snapshot !== 'function' || !isCurrent()) {
    throw new ZhiyuConversationSelectionRemintError(
      'ZHIYU_CONVERSATION_REMINT_INPUT_INVALID',
      'Zhiyu conversation remint inputs are unavailable.',
    );
  }
  const conversationAnchorId = requireAnchor(input.previousConversationAnchorId);
  const currentHandles = freezeCurrentHandles(input.currentReferences);
  if (currentHandles.length === 0) {
    return Object.freeze({
      outcome: 'selection-required',
      reasonCode: 'zhiyu-conversation-selection-remint-not-found',
      actionHint: 'select_runtime_local_agent',
    });
  }

  const probes = await Promise.allSettled(currentHandles.map(async (agentHandle) => {
    try {
      const snapshot = await input.conversation.snapshot({ agentHandle, conversationAnchorId });
      if (snapshot.conversationAnchorId !== conversationAnchorId) {
        throw new ZhiyuConversationSelectionRemintError(
          'ZHIYU_CONVERSATION_REMINT_PROJECTION_INVALID',
          'Zhiyu conversation remint received a mismatched Runtime anchor.',
        );
      }
      return agentHandle;
    } catch (error) {
      if (isNimiLocalAppAgentSelectorMismatchError(error)) return null;
      throw error;
    }
  }));
  const failed = probes.find((probe): probe is PromiseRejectedResult => probe.status === 'rejected');
  if (failed) throw failed.reason;
  if (!isCurrent()) {
    throw new ZhiyuConversationSelectionRemintError(
      'ZHIYU_CONVERSATION_REMINT_STALE',
      'Zhiyu session changed while reminting the Conversation selection.',
    );
  }
  const matches = probes
    .filter((probe): probe is PromiseFulfilledResult<NimiLocalAppAgentHandle | null> => probe.status === 'fulfilled')
    .map((probe) => probe.value)
    .filter((handle): handle is NimiLocalAppAgentHandle => handle !== null);
  if (matches.length > 1) {
    throw new ZhiyuConversationSelectionRemintError(
      'ZHIYU_CONVERSATION_REMINT_AMBIGUOUS',
      'Runtime Conversation anchor matched more than one current Agent reference.',
    );
  }
  if (matches.length === 0) {
    return Object.freeze({
      outcome: 'selection-required',
      reasonCode: 'zhiyu-conversation-selection-remint-not-found',
      actionHint: 'select_runtime_local_agent',
    });
  }
  return Object.freeze({
    outcome: 'reminted',
    agentHandle: matches[0],
    conversationAnchorId,
  });
}
