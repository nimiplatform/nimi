import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';
import { createNimiLocalAppAgentReferencesClient, type NimiLocalAppAgentReference } from './local-app-runtime-platform-agent-references.js';
import { validateAgentHandle } from './local-app-runtime-platform-conversation.js';
import { validateAgentWork, workText, type NimiLocalAppAgentWorkInput, type NimiLocalAppAgentWorkToolCall } from './local-app-agent-work-input.js';
import { asRecord, assertExactKeys, assertExactProjectionKeys, localAppError, localAppProjectionError } from './local-app-runtime-platform-validation.js';

export type { NimiLocalAppAgentWorkInput, NimiLocalAppAgentWorkToolCall } from './local-app-agent-work-input.js';
export type NimiLocalAppAgentWorkScope = { readonly agentHandle: NimiLocalAppAgentHandle; readonly executionId: string };
export type NimiLocalAppAgentWorkStartInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly requestId: string;
  readonly prompt: string;
  readonly work: NimiLocalAppAgentWorkInput;
};
export type NimiLocalAppAgentWorkToolResultInput = NimiLocalAppAgentWorkScope & {
  readonly callId: string; readonly resultJson: string; readonly isError: boolean;
};
export type NimiLocalAppAgentWorkExecution = {
  readonly executionId: string; readonly workId: string;
  readonly state: 'running' | 'waiting_tool' | 'succeeded' | 'failed' | 'cancelled';
  readonly outputText: string; readonly reasonCode: string; readonly message: string; readonly sequence: string;
};
export type NimiLocalAppAgentWorkStatus = { readonly busy: boolean; readonly ownExecutionId: string | null };
export type NimiLocalAppAgentWorkSubscribeInput = NimiLocalAppAgentWorkScope & { readonly afterSequence?: string };
export type NimiLocalAppAgentWorkEvent = { readonly executionId: string; readonly sequence: string } & (
  | { readonly type: 'snapshot'; readonly execution: NimiLocalAppAgentWorkExecution }
  | { readonly type: 'text-delta'; readonly delta: string }
  | { readonly type: 'tool-call'; readonly call: NimiLocalAppAgentWorkToolCall }
);
export type NimiLocalAppAgentWorkSubscription = AsyncIterable<NimiLocalAppAgentWorkEvent> & { readonly cancel: () => Promise<void> };
export type NimiLocalAppAgentWorkShell = {
  readonly listReferences: () => Promise<unknown>;
  readonly start: (input: NimiLocalAppAgentWorkStartInput) => Promise<unknown>;
  readonly get: (input: NimiLocalAppAgentWorkScope) => Promise<unknown>;
  readonly status: (input: { readonly agentHandle: NimiLocalAppAgentHandle }) => Promise<unknown>;
  readonly listToolCalls: (input: NimiLocalAppAgentWorkScope) => Promise<unknown>;
  readonly submitToolResult: (input: NimiLocalAppAgentWorkToolResultInput) => Promise<unknown>;
  readonly cancel: (input: NimiLocalAppAgentWorkScope) => Promise<unknown>;
  readonly subscribe: (input: NimiLocalAppAgentWorkSubscribeInput) => Promise<{ readonly events: AsyncIterable<unknown>; readonly cancel: () => Promise<void> }>;
};
export type NimiLocalAppAgentWorkClient = {
  readonly listReferences: () => Promise<readonly NimiLocalAppAgentReference[]>;
  readonly start: (input: NimiLocalAppAgentWorkStartInput) => Promise<{ readonly executionId: string }>;
  readonly get: (input: NimiLocalAppAgentWorkScope) => Promise<NimiLocalAppAgentWorkExecution>;
  readonly status: (input: { readonly agentHandle: NimiLocalAppAgentHandle }) => Promise<NimiLocalAppAgentWorkStatus>;
  readonly listToolCalls: (input: NimiLocalAppAgentWorkScope) => Promise<readonly NimiLocalAppAgentWorkToolCall[]>;
  readonly submitToolResult: (input: NimiLocalAppAgentWorkToolResultInput) => Promise<{ readonly callId: string }>;
  readonly cancel: (input: NimiLocalAppAgentWorkScope) => Promise<NimiLocalAppAgentWorkExecution>;
  readonly subscribe: (input: NimiLocalAppAgentWorkSubscribeInput) => Promise<NimiLocalAppAgentWorkSubscription>;
};

export function validateNimiLocalAppAgentWorkStart(input: NimiLocalAppAgentWorkStartInput): NimiLocalAppAgentWorkStartInput {
  assertExactKeys(input, ['agentHandle', 'requestId', 'prompt', 'work'], 'Agent work start');
  return { agentHandle: validateAgentHandle(input.agentHandle) as NimiLocalAppAgentHandle, requestId: workText(input.requestId, 256), prompt: workText(input.prompt, 32768), work: validateAgentWork(input.work) };
}
export function validateNimiLocalAppAgentWorkScope(input: NimiLocalAppAgentWorkScope): NimiLocalAppAgentWorkScope {
  assertExactKeys(input, ['agentHandle', 'executionId'], 'Agent work scope');
  return { agentHandle: validateAgentHandle(input.agentHandle) as NimiLocalAppAgentHandle, executionId: workText(input.executionId, 256) };
}
export function validateNimiLocalAppAgentWorkToolResult(input: NimiLocalAppAgentWorkToolResultInput): NimiLocalAppAgentWorkToolResultInput {
  assertExactKeys(input, ['agentHandle', 'executionId', 'callId', 'resultJson', 'isError'], 'Agent work tool result');
  const scope = validateNimiLocalAppAgentWorkScope({ agentHandle: input.agentHandle, executionId: input.executionId });
  const resultJson = workText(input.resultJson, 32768);
  try { JSON.parse(resultJson); } catch { return localAppError('Tool result must be JSON.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_json_result'); }
  if (typeof input.isError !== 'boolean') return localAppError('Tool result error flag is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_tool_result');
  return { ...scope, callId: workText(input.callId, 256), resultJson, isError: input.isError };
}
export function validateNimiLocalAppAgentWorkSubscribe(input: NimiLocalAppAgentWorkSubscribeInput): NimiLocalAppAgentWorkSubscribeInput {
  assertExactKeys(input, input.afterSequence === undefined ? ['agentHandle', 'executionId'] : ['agentHandle', 'executionId', 'afterSequence'], 'Agent work subscription');
  const scope = validateNimiLocalAppAgentWorkScope({ agentHandle: input.agentHandle, executionId: input.executionId });
  if (input.afterSequence !== undefined && !validSequence(input.afterSequence)) return localAppError('Work sequence is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_work_sequence');
  return { ...scope, ...(input.afterSequence === undefined ? {} : { afterSequence: input.afterSequence }) };
}

// @nimi-authority: rule.nimi.runtime.agent-participation.app-work
export function createNimiLocalAppAgentWorkClient(shell: NimiLocalAppAgentWorkShell): NimiLocalAppAgentWorkClient {
  return Object.freeze({
    listReferences: createNimiLocalAppAgentReferencesClient(shell).listReferences,
    async start(input) {
      const result = asRecord(await shell.start(validateNimiLocalAppAgentWorkStart(input)));
      assertExactProjectionKeys(result, ['executionId'], 'Agent work start');
      return Object.freeze({ executionId: projectText(result.executionId, 256) });
    },
    async get(input) { return executionEnvelope(await shell.get(validateNimiLocalAppAgentWorkScope(input)), input.executionId); },
    async status(input) {
      assertExactKeys(input, ['agentHandle'], 'Agent work status');
      const value = asRecord(await shell.status({ agentHandle: validateAgentHandle(input.agentHandle) as NimiLocalAppAgentHandle }));
      assertExactProjectionKeys(value, ['busy', 'ownExecutionId'], 'Agent work status');
      if (typeof value.busy !== 'boolean' || (value.ownExecutionId !== null && typeof value.ownExecutionId !== 'string')) return localAppProjectionError('Agent work status');
      return Object.freeze({ busy: value.busy, ownExecutionId: value.ownExecutionId === null ? null : projectText(value.ownExecutionId, 256) });
    },
    async listToolCalls(input) {
      const value = asRecord(await shell.listToolCalls(validateNimiLocalAppAgentWorkScope(input)));
      assertExactProjectionKeys(value, ['calls'], 'Agent work tool calls');
      if (!Array.isArray(value.calls) || value.calls.length > 16) return localAppProjectionError('Agent work tool calls');
      const calls = value.calls.map(call => projectToolCall(call, input.executionId));
      if (new Set(calls.map(call => call.callId)).size !== calls.length) return localAppProjectionError('Agent work duplicate calls');
      return Object.freeze(calls);
    },
    async submitToolResult(input) {
      const value = asRecord(await shell.submitToolResult(validateNimiLocalAppAgentWorkToolResult(input)));
      assertExactProjectionKeys(value, ['callId'], 'Agent work tool result');
      if (value.callId !== input.callId) return localAppProjectionError('Agent work tool result correlation');
      return Object.freeze({ callId: input.callId });
    },
    async cancel(input) { return executionEnvelope(await shell.cancel(validateNimiLocalAppAgentWorkScope(input)), input.executionId); },
    async subscribe(input) {
      const valid = validateNimiLocalAppAgentWorkSubscribe(input);
      const source = await shell.subscribe(valid);
      let sequence = BigInt(valid.afterSequence ?? '0');
      let closed = false;
      let cancellation: Promise<void> | undefined;
      const cancel = (): Promise<void> => {
        if (cancellation) return cancellation;
        if (closed) return Promise.resolve();
        closed = true;
        cancellation = source.cancel();
        return cancellation;
      };
      return Object.freeze({
        cancel,
        async *[Symbol.asyncIterator]() {
          if (closed) return;
          let completed = false;
          try {
            for await (const raw of source.events) {
              if (closed) return;
              const event = projectEvent(raw, input.executionId);
              if (BigInt(event.sequence) <= sequence) return localAppProjectionError('Agent work event order');
              sequence = BigInt(event.sequence);
              yield event;
            }
            completed = true;
          } finally {
            if (completed) closed = true;
            else await cancel().catch(() => undefined);
          }
        },
      });
    },
  });
}

function validSequence(value: unknown): value is string { return typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/u.test(value) && BigInt(value) <= 18446744073709551615n; }
function projectText(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.includes('\0') || new TextEncoder().encode(value).byteLength > max) return localAppProjectionError('Agent work text');
  return value;
}
function executionEnvelope(value: unknown, executionId: string) {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['execution'], 'Agent work execution response');
  return projectExecution(record.execution, executionId);
}
function projectExecution(value: unknown, executionId: string): NimiLocalAppAgentWorkExecution {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['executionId', 'workId', 'state', 'outputText', 'reasonCode', 'message', 'sequence'], 'Agent work execution');
  if (record.executionId !== executionId || !validSequence(record.sequence) || !['running', 'waiting_tool', 'succeeded', 'failed', 'cancelled'].includes(String(record.state))) return localAppProjectionError('Agent work execution');
  const outputText = projectText(record.outputText, 1024 * 1024, true);
  if (record.state !== 'succeeded' && outputText !== '') return localAppProjectionError('Agent work incomplete output');
  return Object.freeze({ executionId, workId: projectText(record.workId, 256), state: record.state as NimiLocalAppAgentWorkExecution['state'], outputText, reasonCode: projectText(record.reasonCode, 256, true), message: projectText(record.message, 4096, true), sequence: record.sequence });
}
function projectToolCall(value: unknown, executionId: string): NimiLocalAppAgentWorkToolCall {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['callId', 'executionId', 'name', 'argumentsJson'], 'Agent work tool call');
  if (record.executionId !== executionId) return localAppProjectionError('Agent work tool scope');
  const argumentsJson = projectText(record.argumentsJson, 32768);
  try { if (!asRecord(JSON.parse(argumentsJson))) return localAppProjectionError('Agent work tool arguments'); } catch { return localAppProjectionError('Agent work tool arguments'); }
  return Object.freeze({ executionId, callId: projectText(record.callId, 256), name: projectText(record.name, 64), argumentsJson });
}
function projectEvent(value: unknown, executionId: string): NimiLocalAppAgentWorkEvent {
  const record = asRecord(value);
  if (!record) return localAppProjectionError('Agent work event');
  const payload = record.type === 'snapshot' ? 'execution' : record.type === 'text-delta' ? 'delta' : record.type === 'tool-call' ? 'call' : '';
  if (!payload || record.executionId !== executionId || !validSequence(record.sequence)) return localAppProjectionError('Agent work event');
  assertExactProjectionKeys(record, ['executionId', 'sequence', 'type', payload], 'Agent work event');
  const base = { executionId, sequence: record.sequence };
  if (record.type === 'snapshot') return Object.freeze({ ...base, type: 'snapshot', execution: projectExecution(record.execution, executionId) });
  if (record.type === 'text-delta') return Object.freeze({ ...base, type: 'text-delta', delta: projectText(record.delta, 32768, true) });
  return Object.freeze({ ...base, type: 'tool-call', call: projectToolCall(record.call, executionId) });
}
