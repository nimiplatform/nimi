import type { NimiElectronAppBusinessServices } from '@nimiplatform/kit/shell/electron/main';
import { HarnessSubmissionError, type openHarness } from './harness.js';

type Sessions = Awaited<ReturnType<typeof openHarness>>;

const nonNegativeInt = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const key = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const configRefPattern = { type: 'string', pattern: '^(main|[0-9a-f]{32})$' };
const identity = { sessionId: { type: 'string', minLength: 1, maxLength: 36 }, requestId: key };

const listInputSchema = {
  type: 'object',
  properties: { offset: nonNegativeInt },
  additionalProperties: false,
};
const sessionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'string', enum: ['idle', 'running', 'waiting', 'error'] },
    hasPendingDecision: { type: 'boolean' },
    workspaceLabel: { type: 'string' },
    updatedAt: nonNegativeInt,
  },
  required: ['id', 'title'],
  additionalProperties: false,
};
const pageSchema = {
  type: 'object',
  properties: {
    sessions: { type: 'array', maxItems: 32, items: sessionSchema },
    nextOffset: { type: ['integer', 'null'] },
  },
  required: ['sessions', 'nextOffset'],
  additionalProperties: false,
};

const historyInputSchema = {
  type: 'object',
  properties: {
    sessionId: identity.sessionId,
    cursor: nonNegativeInt,
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
  required: ['sessionId'],
  additionalProperties: false,
};
const historyEntrySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    role: { type: 'string', enum: ['user', 'assistant', 'tool'] },
    text: { type: 'string' },
    toolName: { type: 'string' },
    toolFailure: { type: 'string', enum: ['invalid-arguments', 'blocked', 'interrupted', 'other'] },
    truncated: { type: 'boolean' },
    timestamp: nonNegativeInt,
  },
  required: ['id', 'role', 'text'],
  additionalProperties: false,
};
const historyOutputSchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string' },
    entries: { type: 'array', maxItems: 50, items: historyEntrySchema },
    nextCursor: { type: ['integer', 'null'] },
  },
  required: ['sessionId', 'entries', 'nextCursor'],
  additionalProperties: false,
};

const createInputSchema = {
  type: 'object',
  properties: { requestId: key, configRef: configRefPattern },
  required: ['requestId'],
  additionalProperties: false,
};
const createOutputSchema = {
  type: 'object',
  properties: { id: { type: 'string' }, title: { type: 'string' } },
  required: ['id', 'title'],
  additionalProperties: false,
};

const lookupSchema = { type: 'object', properties: identity, required: ['sessionId', 'requestId'], additionalProperties: false };
const submitSchema = {
  ...lookupSchema,
  properties: { ...identity, text: { type: 'string', minLength: 1, maxLength: 65536 } },
  required: ['sessionId', 'requestId', 'text'],
};
const receiptSchema = { type: 'object', properties: { requestId: key }, required: ['requestId'], additionalProperties: false };
const statusSchema = {
  ...receiptSchema,
  properties: { requestId: key, status: { type: 'string', enum: ['not-found', 'queued', 'placed', 'done', 'unanswered'] } },
  required: ['requestId', 'status'],
};
const answerSchema = {
  ...statusSchema,
  properties: { ...statusSchema.properties, text: { type: 'string', maxLength: 16384 }, truncated: { type: 'boolean' } },
};
const stopSchema = {
  ...receiptSchema,
  properties: {
    requestId: key,
    outcome: { type: 'string', enum: ['not-found', 'settled', 'requested', 'check-again'] },
  },
  required: ['requestId', 'outcome'],
};

const sessionOnly = { type: 'object', properties: { sessionId: identity.sessionId }, required: ['sessionId'], additionalProperties: false };
const fileReceipt = {
  type: 'object',
  properties: { fileId: key, name: { type: 'string' } },
  required: ['fileId'],
  additionalProperties: false,
};
const fileLookup = {
  type: 'object',
  properties: {
    sessionId: identity.sessionId,
    fileId: key,
    ref: { type: 'string', minLength: 1, maxLength: 1024 },
  },
  required: ['sessionId'],
  additionalProperties: false,
};

const listFilesInputSchema = {
  type: 'object',
  properties: {
    sessionId: identity.sessionId,
    folder: { type: 'string', maxLength: 1024 },
    offset: nonNegativeInt,
  },
  required: ['sessionId'],
  additionalProperties: false,
};
const listFilesOutputSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          ref: { type: 'string' },
          directory: { type: 'boolean' },
          size: nonNegativeInt,
        },
        required: ['name', 'ref', 'directory'],
        additionalProperties: false,
      },
    },
    nextOffset: { type: ['integer', 'null'] },
  },
  required: ['items', 'nextOffset'],
  additionalProperties: false,
};

const taskId = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const revision = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const diffPreviewSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['write', 'edit', 'command'] },
    path: { type: 'string' },
    content: { type: 'string' },
    command: { type: 'string' },
    truncated: { type: 'boolean' },
    replacements: {
      type: 'array',
      items: {
        type: 'object',
        properties: { oldText: { type: 'string' }, newText: { type: 'string' } },
        required: ['oldText', 'newText'],
        additionalProperties: false,
      },
    },
  },
  required: ['kind'],
  additionalProperties: false,
};
const decisionView = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['none', 'open-on-pc', 'review'] },
    taskId,
    callId: { type: 'string' },
    revision,
    tool: { type: 'string' },
    reason: { type: 'string' },
    title: { type: 'string' },
    summary: { type: 'string' },
    argumentsJson: { type: 'string', maxLength: 32768 },
    allowSessionPermitted: { type: 'boolean' },
    isControlPlane: { type: 'boolean' },
    isFreeShell: { type: 'boolean' },
    remoteApprovalAllowed: { type: 'boolean' },
    expiresAt: nonNegativeInt,
    recentAiEditedWarning: { type: 'array', items: { type: 'string' } },
    diffPreview: diffPreviewSchema,
  },
  required: ['state'],
  additionalProperties: false,
};
const decisionInput = {
  type: 'object',
  properties: {
    sessionId: identity.sessionId,
    taskId,
    revision,
    allow: { type: 'boolean' },
    feedback: { type: 'string', maxLength: 4000 },
  },
  required: ['sessionId', 'taskId', 'revision', 'allow'],
  additionalProperties: false,
};
const decisionResult = {
  type: 'object',
  properties: { outcome: { type: 'string', enum: ['recorded', 'stale'] } },
  required: ['outcome'],
  additionalProperties: false,
};
const progressOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stage: { type: 'string', enum: ['idle', 'queued', 'placed', 'generating', 'waiting', 'tools', 'done', 'unanswered'] },
    turn: { type: 'integer', minimum: 0 },
    text: { type: 'string', maxLength: 8192 },
    truncated: { type: 'boolean' },
    activeTool: { type: 'string' },
    hasPendingDecision: { type: 'boolean' },
  },
  required: ['stage', 'turn', 'text', 'truncated'],
};

export const HARNESS_SESSION_INTEGRATION_ID = 'ai.nimi.harness.sessions.v1';
const POLL_RETRY_BACKOFF_MS = 1_500;
const TERMINAL_PROVIDER_REASONS = new Set([
  'session-invalid',
  'revoked',
  'runtime-unauthenticated',
  'INTEGRATION_SCOPE_ENDED',
  'INTEGRATION_PROVIDER_CONTRACT_CHANGED',
  'INTEGRATION_PROVIDER_ALREADY_ACTIVE',
]);

function isTerminalProviderError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { reasonCode?: unknown; code?: unknown; message?: unknown };
  const reason = typeof candidate.reasonCode === 'string' ? candidate.reasonCode : '';
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  if (TERMINAL_PROVIDER_REASONS.has(reason) || TERMINAL_PROVIDER_REASONS.has(code)) return true;
  for (const token of TERMINAL_PROVIDER_REASONS) {
    if (message.includes(token)) return true;
  }
  return false;
}

function waitRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const onAbort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    timer.unref?.();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Runtime grants catalog reads, task submission, history, files, and receipt lookup separately (nimi.harness.session.v1). */
export async function serveSessions(
  integration: NimiElectronAppBusinessServices['integration'],
  getSessions: () => Promise<Sessions>,
  signal: AbortSignal,
  options?: { retryBackoffMs?: number },
) {
  const retryBackoffMs = options?.retryBackoffMs ?? POLL_RETRY_BACKOFF_MS;
  let target: Awaited<ReturnType<typeof integration.registerProvider>> | undefined;
  while (!signal.aborted && !target) {
    try {
      target = await integration.registerProvider({
        integrationId: HARNESS_SESSION_INTEGRATION_ID,
        displayName: 'Nimi Harness sessions',
        skill: 'List PC sessions, read recent history and workspace files, and use a new requestId for each input. Check, read or stop only that receipt. Review the current tool proposal before sending a decision for its exact taskId and revision.',
        operations: [
          {
            name: 'session.list', displayName: 'List sessions', description: 'Read one page of sessions with status metadata without opening or resuming any task.',
            inputSchemaJson: JSON.stringify(listInputSchema), outputSchemaJson: JSON.stringify(pageSchema), effect: 'read', supportsCancel: false, retryPolicy: 'none',
          },
          {
            name: 'session.getHistory', displayName: 'Read session history', description: 'Read paginated recent conversation entries from a PC session without starting a model or scheduler.',
            inputSchemaJson: JSON.stringify(historyInputSchema), outputSchemaJson: JSON.stringify(historyOutputSchema), effect: 'read', supportsCancel: false, retryPolicy: 'none',
          },
          {
            name: 'session.create', displayName: 'Create a PC session',
            description: 'Create an empty session using the PC app default or optional configRef. Retrying the same request from the same source reopens it.',
            inputSchemaJson: JSON.stringify(createInputSchema), outputSchemaJson: JSON.stringify(createOutputSchema), effect: 'write', supportsCancel: false, retryPolicy: 'none',
          },
          {
            name: 'session.submit', displayName: 'Submit a task', description: 'Start a model task in an existing PC session. The usual tool approvals apply.',
            inputSchemaJson: JSON.stringify(submitSchema), outputSchemaJson: JSON.stringify(receiptSchema), effect: 'write', supportsCancel: false, retryPolicy: 'none',
          },
          {
            name: 'session.inputStatus', displayName: 'Read input status', description: 'Look up one submitted input by session and request ID without returning its text or resuming it.',
            inputSchemaJson: JSON.stringify(lookupSchema), outputSchemaJson: JSON.stringify(statusSchema), effect: 'read', supportsCancel: false, retryPolicy: 'none',
          },
          {
            name: 'session.readAnswer', displayName: 'Read a task reply',
            description: 'Read the final assistant text for one input receipt. Long replies are shown as a preview.',
            inputSchemaJson: JSON.stringify(lookupSchema), outputSchemaJson: JSON.stringify(answerSchema), effect: 'read', supportsCancel: false, retryPolicy: 'none',
          },
          {
            name: 'session.stopInput', displayName: 'Stop a submitted task',
            description: 'Withdraw this input or stop the active generation handling its receipt. Later tasks in the same session are unaffected.',
            inputSchemaJson: JSON.stringify(lookupSchema), outputSchemaJson: JSON.stringify(stopSchema), effect: 'write', supportsCancel: false, retryPolicy: 'none',
          },
          {
            name: 'session.observeProgress', displayName: 'Observe session progress', description: 'Watch the current task stage and a bounded preview of its public reply. Reconnecting reads current state. Tool arguments and private reasoning stay on the PC.',
            effect: 'read', supportsCancel: false, retryPolicy: 'none', snapshotRead: true,
            inputSchemaJson: JSON.stringify(sessionOnly), outputSchemaJson: JSON.stringify(progressOutputSchema),
          },
          {
            name: 'session.reviewDecision', displayName: 'Read a pending tool decision',
            description: 'Read one pending action in the selected session, including its tool, summary, diff preview, and full arguments.',
            inputSchemaJson: JSON.stringify(sessionOnly), outputSchemaJson: JSON.stringify(decisionView), effect: 'read', supportsCancel: false, retryPolicy: 'none',
          },
          {
            name: 'session.resolveDecision', displayName: 'Allow or decline a reviewed action',
            description: 'Record a decision (and optional change feedback when declining) for the exact tool proposal shown. Allowing it can run the tool with your desktop privileges.',
            inputSchemaJson: JSON.stringify(decisionInput), outputSchemaJson: JSON.stringify(decisionResult), effect: 'write', supportsCancel: false, retryPolicy: 'none',
          },
          {
            name: 'session.listFiles', displayName: 'List session workspace files',
            description: 'Browse files and folders inside the selected PC session workspace.',
            inputSchemaJson: JSON.stringify(listFilesInputSchema), outputSchemaJson: JSON.stringify(listFilesOutputSchema), effect: 'read', supportsCancel: false, retryPolicy: 'none',
          },
          {
            name: 'session.importAttachment', displayName: 'Send a file to a PC session', description: 'Copy one file into the selected session. The file becomes available to its tools after transfer.',
            inputSchemaJson: JSON.stringify(sessionOnly), outputSchemaJson: JSON.stringify(fileReceipt), effect: 'write', supportsCancel: false, retryPolicy: 'none', assetTransfer: 'to-provider',
          },
          {
            name: 'session.downloadResult', displayName: 'Download a session file or shared result', description: 'Copy one explicitly shared result (by fileId) or workspace file (by ref) into the requesting source’s files.',
            inputSchemaJson: JSON.stringify(fileLookup), outputSchemaJson: JSON.stringify(fileReceipt), effect: 'write', supportsCancel: false, retryPolicy: 'none', assetTransfer: 'to-consumer',
          },
        ],
      });
    } catch (error) {
      if (signal.aborted || isTerminalProviderError(error)) {
        if (!signal.aborted) {
          process.stderr.write(`[nimi-harness-integration] registerProvider stopped: ${error instanceof Error ? error.message : String(error)}\n`);
        }
        return;
      }
      process.stderr.write(`[nimi-harness-integration] registerProvider failed, retrying: ${error instanceof Error ? error.message : String(error)}\n`);
      await waitRetry(retryBackoffMs, signal);
    }
  }
  if (!target || signal.aborted) return;

  type Completion = Parameters<typeof integration.completeProvider>[0];
  async function complete(result: Completion) {
    if (signal.aborted) return;
    try { await integration.completeProvider(result); }
    catch (error) {
      if (!signal.aborted) process.stderr.write(`[nimi-harness-integration] completion ${result.callId}: ${error instanceof Error ? error.name : 'Error'}\n`);
    }
  }

  // Runtime copies bytes during completion. Serialize those copies separately so
  // the next poll can deliver a stop while an earlier file is still transferring.
  let transfers = Promise.resolve();
  let scopeInvalidated = false;
  const observationScope = new AbortController();
  const observing = AbortSignal.any([signal, observationScope.signal]);
  const observations = new Set<Promise<void>>();
  try {
    while (!signal.aborted) {
      let pending: Awaited<ReturnType<typeof integration.pollProvider>>;
      try {
        pending = await integration.pollProvider({ waitMs: 20000 });
      } catch (error) {
        if (signal.aborted) break;
        if (isTerminalProviderError(error)) {
          scopeInvalidated = true;
          break;
        }
        process.stderr.write(`[nimi-harness-integration] pollProvider transient failure, retrying: ${error instanceof Error ? error.message : String(error)}\n`);
        await waitRetry(retryBackoffMs, signal);
        continue;
      }
      for (const call of pending.calls) {
        if (signal.aborted) return;
        if (pending.canceledCallIds.includes(call.callId)) continue;
        if (call.operation === 'session.observeProgress' && call.targetRef === target.targetRef && call.afterSnapshot !== undefined) {
          const cursor = call.afterSnapshot;
          // A long-lived read must never hold up a stop or a task input.
          const observe = async () => {
            try {
              if (observations.size >= 64) throw new Error('Observation capacity reached.');
              const sessions = await getSessions();
              const json = await sessions.readProgress(JSON.parse(call.inputJson).sessionId, cursor, observing);
              if (!observing.aborted) await complete({ callId: call.callId, resultJson: json, errorCode: '' });
            } catch {
              if (!observing.aborted) await complete({ callId: call.callId, resultJson: '', errorCode: 'HARNESS_PROGRESS_UNAVAILABLE' });
            }
          };
          const work = observe();
          observations.add(work);
          void work.finally(() => observations.delete(work));
          continue;
        }
        let errorCode = '', resultJson = '';
        let asset: Parameters<typeof integration.completeProvider>[0]['asset'];
        if (call.targetRef !== target.targetRef) errorCode = 'HARNESS_OPERATION_UNAVAILABLE';
        else {
          try {
            // Runtime validated input against the schema for this exact operation.
            const input = JSON.parse(call.inputJson);
            const sessions = await getSessions();
            switch (call.operation) {
              case 'session.importAttachment': {
                if (!call.offeredAsset) throw new Error('Missing attached file.');
                const file = sessions.incomingFile(input.sessionId);
                asset = { relativePath: file.relativePath };
                resultJson = JSON.stringify({ fileId: file.fileId });
                break;
              }
              case 'session.downloadResult': {
                if (typeof input.fileId === 'string' && input.fileId) {
                  asset = await sessions.outgoingFile(input.sessionId, input.fileId);
                  resultJson = JSON.stringify({ fileId: input.fileId });
                } else if (typeof input.ref === 'string' && input.ref) {
                  const published = await sessions.outgoingWorkspaceFile(input.sessionId, input.ref);
                  asset = { relativePath: published.relativePath, source: published.source };
                  resultJson = JSON.stringify({ fileId: published.fileId, name: published.name });
                } else {
                  errorCode = 'HARNESS_INPUT_INVALID';
                }
                break;
              }
              case 'session.list':
                resultJson = JSON.stringify(
                  typeof sessions.listDetailed === 'function'
                    ? sessions.listDetailed(input.offset ?? 0)
                    : sessions.list(input.offset ?? 0),
                );
                break;
              case 'session.getHistory':
                resultJson = JSON.stringify(await sessions.getHistory(input.sessionId, input.cursor ?? 0, input.limit ?? 30));
                break;
              case 'session.listFiles': {
                const listed = await sessions.listFiles(input.sessionId, input.folder ?? '', input.offset ?? 0);
                resultJson = JSON.stringify({ items: listed.items, nextOffset: listed.next });
                break;
              }
              case 'session.submit':
                if (!input.text.trim() || Buffer.byteLength(input.text) > 65536) {
                  errorCode = 'HARNESS_INPUT_INVALID';
                  break;
                }
                await sessions.submit(input.sessionId, input.text, input.requestId);
                resultJson = JSON.stringify({ requestId: input.requestId });
                break;
              case 'session.inputStatus':
                resultJson = JSON.stringify({ requestId: input.requestId, status: await sessions.inputStatus(input.sessionId, input.requestId) });
                break;
              case 'session.create':
                resultJson = JSON.stringify(await sessions.createRemote(call.consumerRef, input.requestId, input.configRef));
                break;
              case 'session.readAnswer':
                resultJson = JSON.stringify({ requestId: input.requestId, ...await sessions.readAnswer(input.sessionId, input.requestId) });
                break;
              case 'session.stopInput':
                resultJson = JSON.stringify({ requestId: input.requestId, outcome: await sessions.stopInput(input.sessionId, input.requestId) });
                break;
              case 'session.reviewDecision':
                resultJson = JSON.stringify(await sessions.pendingDecision(input.sessionId));
                break;
              case 'session.resolveDecision': {
                const feedback = !input.allow && typeof input.feedback === 'string' && input.feedback.trim()
                  ? input.feedback.trim()
                  : undefined;
                resultJson = JSON.stringify({
                  outcome: await sessions.resolveDecision(input.sessionId, input.taskId, input.revision, input.allow, feedback),
                });
                break;
              }
              default:
                errorCode = 'HARNESS_OPERATION_UNAVAILABLE';
            }
          } catch (error) {
            errorCode = error instanceof HarnessSubmissionError ? error.code : 'HARNESS_SESSIONS_UNAVAILABLE';
          }
        }
        if (signal.aborted) return;
        const result = { callId: call.callId, resultJson, errorCode };
        if (asset && !errorCode) {
          const transfer = { ...result, asset };
          transfers = transfers.then(() => complete(transfer));
        } else await complete(result);
      }
    }
  } finally {
    // Runtime revokes this registration with its exact source session. Never
    // submit an unregister under a newly bound scope after invalidation.
    observationScope.abort();
    await Promise.all(observations);
    try { if (!signal.aborted && !scopeInvalidated) await integration.unregisterProvider({ targetRef: target.targetRef }); }
    finally { await transfers; }
  }
}
