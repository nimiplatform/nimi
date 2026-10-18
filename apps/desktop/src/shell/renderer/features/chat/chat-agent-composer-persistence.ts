import { useEffect, useRef, useState } from 'react';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';

type DraftRef = { current: string; readonly revision: number };
type Storage = Pick<NimiLocalAppClient['storage'], 'readJson' | 'writeJson'>;
export type AgentPendingSubmission = {
  requestId: string;
  conversationAnchorId: string;
  text: string;
  artifactIds: string[];
  retryOfTurnId?: string;
};

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
    (row.retryOfTurnId !== undefined && typeof row.retryOfTurnId !== 'string')
  )
    throw new Error('The saved submission could not be read.');
  return row;
}

export type AgentDraftSaveStatus = 'loading' | 'saving' | 'saved' | 'unsaved';

// @nimi-authority: rule.nimi.desktop.agent-projection.composer-draft
export function createAgentComposerPersistence(input: {
  agentBinding: string;
  draft: DraftRef;
  storage: Storage;
  isCurrent: () => boolean;
  subscribe: (onChange: () => void) => () => void;
  onState: (status: AgentDraftSaveStatus) => void;
  onRestored: () => void;
  onSubmission?: (submission: AgentPendingSubmission | null) => void;
}) {
  if (!/^agent_binding_[A-Za-z0-9_-]{43}$/u.test(input.agentBinding))
    throw new Error('A current partner binding is required.');
  const path = `agent-chat/drafts/${input.agentBinding}.json`;
  let closed = false;
  let loaded = false;
  let savedText = '';
  let submission: AgentPendingSubmission | null = null;
  let savedSubmission: AgentPendingSubmission | null = null;
  let submissionRevision = 0;
  let writing: Promise<boolean> | null = null;
  let reading: Promise<boolean> | null = null;
  const current = () => !closed && input.isCurrent();
  const notify = (status: AgentDraftSaveStatus) => {
    if (current()) input.onState(status);
  };

  const flush = (): Promise<boolean> => {
    if (!current() || !loaded) return Promise.resolve(false);
    if (writing) return writing;
    const write = async (): Promise<boolean> => {
      try {
        while (current() && (input.draft.current !== savedText || submission !== savedSubmission)) {
          const text = input.draft.current;
          notify('saving');
          const nextSubmission = submission;
          await input.storage.writeJson(path, {
            version: 1,
            draft: text,
            submission: nextSubmission,
          });
          if (!current()) return false;
          savedText = text;
          savedSubmission = nextSubmission;
        }
        if (!current()) return false;
        notify('saved');
        return true;
      } catch {
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
    const hadLocalText = input.draft.current !== '';
    notify('loading');
    reading = (async () => {
      try {
        let text = '';
        let restoredSubmission: AgentPendingSubmission | null = null;
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
        } catch (error) {
          if (extractNimiErrorFields(error).reasonCode !== 'APP_STORAGE_ENTRY_NOT_FOUND')
            throw error;
        }
        if (!current()) return false;
        savedText = text;
        savedSubmission = restoredSubmission;
        if (submissionRevision === 0) {
          submission = restoredSubmission;
          input.onSubmission?.(submission);
        }
        if (!hadLocalText && input.draft.revision === revision && input.draft.current !== text) {
          input.draft.current = text;
          input.onRestored();
        }
        loaded = true;
        return await flush();
      } catch {
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
  return {
    ready: load(),
    flush,
    retry: () => (loaded ? flush() : load()),
    async prepare(next: AgentPendingSubmission) {
      // Runtime already owns the original question. A regeneration keeps its
      // stable request in memory even when this optional Home copy is unavailable.
      if (!next.retryOfTurnId && !loaded && !(await load()))
        throw new Error('The submission copy could not be saved. Your draft is kept.');
      if (!current()) throw new Error('The selected partner changed.');
      if (submission && JSON.stringify(submission) !== JSON.stringify(next))
        throw new Error('Check the previous submission before sending another message.');
      const previous = submission;
      submission = readSubmission(next);
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
        throw new Error('The submission copy could not be saved. Your draft is kept.');
      }
    },
    async acknowledge(requestId: string) {
      if (!current() || submission?.requestId !== requestId) return;
      submission = null;
      submissionRevision++;
      input.onSubmission?.(null);
      await flush();
    },
    close() {
      closed = true;
      unsubscribe();
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
}) {
  const latest = useRef(input);
  latest.current = input;
  const controller = useRef<ReturnType<typeof createAgentComposerPersistence> | null>(null);
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
        onSubmission: (value) => {
          if (current()) setPending({ key: captured.scopeKey, value });
        },
      });
      await controller.current.ready;
    })().catch(() => onState('unsaved'));
    return () => {
      retired = true;
      controller.current?.close();
      controller.current = null;
    };
  }, [input.scopeKey, input.agentBinding, input.client, input.draft, attempt]);
  return {
    submission: pending.key === input.scopeKey ? pending.value : null,
    prepare: async (next: AgentPendingSubmission) => {
      if (latest.current.scopeKey !== input.scopeKey || !input.isCurrent())
        throw new Error('The selected partner changed.');
      if (!controller.current)
        throw new Error('The saved draft is not ready. Please retry when it is available.');
      await controller.current.prepare(next);
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
