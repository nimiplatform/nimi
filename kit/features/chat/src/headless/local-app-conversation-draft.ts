import { useEffect, useRef, useState } from 'react';
import type { NimiLocalAppClient, NimiLocalAppConversationQuoteInput } from '@nimiplatform/kit/core/sdk-contract';
import { extractNimiErrorFields, validateNimiLocalAppConversationQuoteInput } from '@nimiplatform/kit/core/sdk-contract';
import type { AgentQuoteDraft, AgentQuoteDraftRef } from '../runtime/local-app-conversation-quote.js';

type DraftRef = { current: string; readonly revision: number };
type Storage = Pick<NimiLocalAppClient['storage'], 'readJson' | 'writeJson'>;
export type AgentPendingSubmission = {
  timezone?: string;
  requestId: string;
  conversationAnchorId: string;
  text: string;
  artifactIds: readonly string[];
  retryOfTurnId?: string;
  quote?: NimiLocalAppConversationQuoteInput;
};
export type AgentComposerPrepareOptions = { quoteRevision?: number; textRevision?: number };
function sameQuote(left: NimiLocalAppConversationQuoteInput | undefined, right: NimiLocalAppConversationQuoteInput | undefined): boolean {
  return Boolean(left && right && left.sourceMessageId === right.sourceMessageId && left.format === right.format && left.startByte === right.startByte && left.endByte === right.endByte);
}

// The request has not reached Send. Keep the original storage error for
// diagnostics while the composer explains this specific failure to the user.
export class AgentSubmissionSaveError extends Error {
  readonly reasonCode?: string;
  readonly actionHint?: string;
  readonly traceId?: string;
  constructor(cause?: unknown) {
    super('The message has not been sent because it could not be saved. Your text is kept.', { cause });
    this.name = 'AgentSubmissionSaveError';
    const fields = extractNimiErrorFields(cause);
    this.reasonCode = fields.reasonCode;
    this.actionHint = fields.actionHint;
    this.traceId = fields.traceId;
  }
}

function readSubmission(value: unknown): AgentPendingSubmission | null {
  if (value == null) return null;
  const row = value as AgentPendingSubmission;
  if (
    typeof row !== 'object' ||
    Array.isArray(row) ||
    typeof row.requestId !== 'string' ||
    !row.requestId ||
    typeof row.conversationAnchorId !== 'string' ||
    !row.conversationAnchorId ||
    typeof row.text !== 'string' ||
    !Array.isArray(row.artifactIds) ||
    row.artifactIds.some((id) => typeof id !== 'string' || !id) ||
    (row.retryOfTurnId !== undefined && typeof row.retryOfTurnId !== 'string') ||
    (row.timezone !== undefined && (typeof row.timezone !== 'string' || !row.timezone || row.timezone.length > 128))
  )
    throw new Error('The saved submission could not be read.');
  if (row.quote !== undefined && row.retryOfTurnId) throw new Error('A regeneration cannot replace the original quotation.');
  return Object.freeze({ ...row, artifactIds: Object.freeze([...row.artifactIds]), ...(row.quote === undefined ? {} : { quote: Object.freeze({ ...validateNimiLocalAppConversationQuoteInput(row.quote) }) }) });
}

function readQuoteDraft(value: unknown): AgentQuoteDraft | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('The saved quotation could not be read.');
  const row = value as AgentQuoteDraft;
  if (typeof row.conversationAnchorId !== 'string' || !row.conversationAnchorId || !row.preview || typeof row.preview.text !== 'string'
    || !['user', 'assistant', 'app'].includes(row.preview.sourceRole) || typeof row.preview.sourcePartial !== 'boolean') throw new Error('The saved quotation could not be read.');
  return { conversationAnchorId: row.conversationAnchorId, input: validateNimiLocalAppConversationQuoteInput(row.input), preview: { ...row.preview } };
}

export type AgentDraftSaveStatus = 'loading' | 'saving' | 'saved' | 'unsaved';

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-061
// @nimi-authority: rule.nimi.runtime.conversation-message-interaction.quote-input
export function createAgentComposerPersistence(input: {
  agentBinding: string;
  draft: DraftRef;
  storage: Storage;
  isCurrent: () => boolean;
  subscribe: (onChange: () => void) => () => void;
  onState: (status: AgentDraftSaveStatus) => void;
  onRestored: () => void;
  onSubmission?: (submission: AgentPendingSubmission | null) => void;
  quoteDraft?: AgentQuoteDraftRef;
  subscribeQuote?: (onChange: () => void) => () => void;
}) {
  if (!/^agent_binding_[A-Za-z0-9_-]{43}$/u.test(input.agentBinding))
    throw new Error('A current partner binding is required.');
  const path = `agent-chat/drafts/${input.agentBinding}.json`;
  let closed = false;
  let loaded = false;
  let savedText = '';
  let savedQuote: AgentQuoteDraft | null = null;
  let preparedQuoteRevision: number | null = null;
  let preparedDraftRevision: number | null = null;
  let submission: AgentPendingSubmission | null = null;
  let savedSubmission: AgentPendingSubmission | null = null;
  let submissionRevision = 0;
  let writing: Promise<boolean> | null = null;
  let reading: Promise<boolean> | null = null;
  let storageError: unknown;
  const current = () => !closed && input.isCurrent();
  const notify = (status: AgentDraftSaveStatus) => {
    if (current()) input.onState(status);
  };

  const flush = (): Promise<boolean> => {
    if (!current() || !loaded) return Promise.resolve(false);
    if (writing) return writing;
    const write = async (): Promise<boolean> => {
      try {
        while (current() && (input.draft.current !== savedText || (input.quoteDraft?.current || null) !== savedQuote || submission !== savedSubmission)) {
          const text = input.draft.current;
          const quoteDraft = input.quoteDraft?.current || null;
          notify('saving');
          const nextSubmission = submission;
          await input.storage.writeJson(path, {
            version: 1,
            // The pending request already owns this text. Keep only a distinct
            // next draft; recovery reads the original from submission.text.
            draft: nextSubmission && !nextSubmission.retryOfTurnId && input.draft.revision === preparedDraftRevision && text.trim() === nextSubmission.text
              ? '' : text,
            quoteDraft: nextSubmission && !nextSubmission.retryOfTurnId && input.quoteDraft?.revision === preparedQuoteRevision && sameQuote(quoteDraft?.input, nextSubmission.quote) ? null : quoteDraft,
            submission: nextSubmission,
          });
          if (!current()) return false;
          savedText = text;
          savedQuote = quoteDraft;
          savedSubmission = nextSubmission;
        }
        if (!current()) return false;
        storageError = undefined;
        notify('saved');
        return true;
      } catch (error) {
        storageError = error;
        notify('unsaved');
        return false;
      }
    };
    writing = write().finally(() => {
      writing = null;
    });
    return writing;
  };
  const load = (): Promise<boolean> => {
    if (!current()) return Promise.resolve(false);
    if (reading) return reading;
    const revision = input.draft.revision;
    const quoteRevision = input.quoteDraft?.revision;
    const hadLocalText = input.draft.current !== '';
    notify('loading');
    reading = (async () => {
      try {
        let text = '';
        let restoredSubmission: AgentPendingSubmission | null = null;
        let restoredQuote: AgentQuoteDraft | null = null;
        try {
          const { value } = await input.storage.readJson(path);
          const record = value as Record<string, unknown> | null;
          if (
            !record ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            record.version !== 1 ||
            typeof record.draft !== 'string'
          ) {
            throw new Error('The saved draft could not be read.');
          }
          text = record.draft;
          restoredSubmission = readSubmission(record.submission);
          restoredQuote = readQuoteDraft(record.quoteDraft);
        } catch (error) {
          const fields = extractNimiErrorFields(error);
          // Protected App carriers expose the bounded storage miss as not-found;
          // Home's typed carrier retains the exact Runtime reason. Both mean no saved draft.
          if (fields.reasonCode !== 'APP_STORAGE_ENTRY_NOT_FOUND' && fields.code !== 'not-found')
            throw error;
        }
        if (!current()) return false;
        savedText = text;
        savedQuote = restoredQuote;
        savedSubmission = restoredSubmission;
        if (submissionRevision === 0) {
          submission = restoredSubmission;
          input.onSubmission?.(submission);
        }
        if (!hadLocalText && input.draft.revision === revision && input.draft.current !== text) {
          input.draft.current = text;
          input.onRestored();
        }
        if (input.quoteDraft && input.quoteDraft.revision === quoteRevision && !input.quoteDraft.current && restoredQuote) input.quoteDraft.current = restoredQuote;
        loaded = true;
        return await flush();
      } catch (error) {
        storageError = error;
        notify('unsaved');
        return false;
      }
    })().finally(() => {
      reading = null;
    });
    return reading;
  };
  const unsubscribe = input.subscribe(() => {
    if (loaded && current()) void flush();
  });
  const unsubscribeQuote = input.subscribeQuote?.(() => { if (loaded && current()) void flush(); });
  return {
    ready: load(),
    flush,
    retry: () => (loaded ? flush() : load()),
    async prepare(next: AgentPendingSubmission, localOptions?: AgentComposerPrepareOptions) {
      // Runtime already owns the original question. A regeneration keeps its
      // stable request in memory even when this optional Home copy is unavailable.
      if (!next.retryOfTurnId && !loaded && !(await load()))
        throw new AgentSubmissionSaveError(storageError);
      if (!current()) throw new Error('The selected partner changed.');
      if (submission && JSON.stringify(submission) !== JSON.stringify(next))
        throw new Error('Check the previous submission before sending another message.');
      const previous = submission;
      submission = readSubmission(next);
      if (!previous) {
        preparedDraftRevision = localOptions?.textRevision ?? input.draft.revision;
        // A quote's revision must be captured with the send intent, before
        // attachment uploads. Omitting it preserves rather than consumes UI state.
        preparedQuoteRevision = localOptions?.quoteRevision ?? null;
      }
      submissionRevision++;
      input.onSubmission?.(submission);
      if (next.retryOfTurnId) {
        void (loaded ? flush() : load());
        return;
      }
      if (!(await flush())) {
        // Send has not run. Keep the draft, not an ambiguous-admission prompt
        // that could bypass the save prerequisite for brand-new input.
        if (current()) {
          submission = previous;
          submissionRevision++;
          input.onSubmission?.(submission);
        }
        throw new AgentSubmissionSaveError(storageError);
      }
    },
    async acknowledge(requestId: string) {
      if (!current() || submission?.requestId !== requestId) return;
      if (!submission.retryOfTurnId && input.quoteDraft && input.quoteDraft.revision === preparedQuoteRevision
        && sameQuote(input.quoteDraft.current?.input, submission.quote)) input.quoteDraft.current = null;
      submission = null;
      submissionRevision++;
      input.onSubmission?.(null);
      await flush();
    },
    close() {
      closed = true;
      unsubscribe();
      unsubscribeQuote?.();
    },
  };
}

export function useAgentComposerPersistence(input: {
  scopeKey: string;
  agentHandle: string;
  agentBinding?: string;
  client: () => Pick<NimiLocalAppClient, 'agents' | 'storage'>;
  draft: DraftRef;
  isCurrent: () => boolean;
  subscribe: (onChange: () => void) => () => void;
  onRestored: () => void;
  quoteDraft?: AgentQuoteDraftRef;
  subscribeQuote?: (onChange: () => void) => () => void;
}) {
  const latest = useRef(input);
  latest.current = input;
  const controller = useRef<ReturnType<typeof createAgentComposerPersistence> | null>(null);
  const startupError = useRef<unknown>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<{ key: string; value: AgentPendingSubmission | null }>({
    key: '',
    value: null,
  });
  const [state, setState] = useState<{ key: string; status: AgentDraftSaveStatus }>({
    key: '',
    status: 'loading',
  });
  useEffect(() => {
    let retired = false;
    const captured = latest.current;
    const current = () =>
      !retired && latest.current.scopeKey === captured.scopeKey && captured.isCurrent();
    const onState = (status: AgentDraftSaveStatus) => {
      if (current())
        setState((previous) =>
          previous.key === captured.scopeKey && previous.status === status
            ? previous
            : { key: captured.scopeKey, status },
        );
    };
    if (!captured.agentHandle || !captured.isCurrent()) return;
    onState('loading');
    startupError.current = undefined;
    void (async () => {
      const client = captured.client();
      const binding =
        captured.agentBinding ||
        (await client.agents.listReferences()).find(
          (reference) => reference.agentHandle === captured.agentHandle,
        )?.agentBinding;
      if (!current()) return;
      if (!binding) throw new Error('The partner is no longer available.');
      controller.current = createAgentComposerPersistence({
        agentBinding: binding,
        draft: captured.draft,
        storage: client.storage,
        isCurrent: current,
        subscribe: captured.subscribe,
        onState,
        onRestored: captured.onRestored,
        quoteDraft: captured.quoteDraft,
        subscribeQuote: captured.subscribeQuote,
        onSubmission: (value) => {
          if (current()) setPending({ key: captured.scopeKey, value });
        },
      });
      await controller.current.ready;
    })().catch(error => { if (current()) { startupError.current = error; onState('unsaved'); } });
    return () => {
      retired = true;
      controller.current?.close();
      controller.current = null;
    };
  }, [input.scopeKey, input.agentBinding, input.client, input.draft, attempt]);
  return {
    submission: pending.key === input.scopeKey ? pending.value : null,
    prepare: async (next: AgentPendingSubmission, localOptions?: AgentComposerPrepareOptions) => {
      if (latest.current.scopeKey !== input.scopeKey || !input.isCurrent())
        throw new Error('The selected partner changed.');
      if (!controller.current)
        throw new AgentSubmissionSaveError(startupError.current);
      await controller.current.prepare(next, localOptions);
    },
    acknowledge: async (requestId: string) => {
      if (latest.current.scopeKey === input.scopeKey && input.isCurrent())
        await controller.current?.acknowledge(requestId);
    },
    status: state.key === input.scopeKey ? state.status : ('loading' as AgentDraftSaveStatus),
    retry: () => {
      if (controller.current) void controller.current.retry();
      else setAttempt((value) => value + 1);
    },
  };
}
