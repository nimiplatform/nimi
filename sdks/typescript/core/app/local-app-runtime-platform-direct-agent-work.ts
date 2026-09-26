import type { RuntimeTypedClient } from '../../core-generated/runtime-typed-client.js';
import { LocalAppAgentWorkState, type LocalAppAgentWorkExecution, type LocalAppAgentWorkEvent } from '../../core-generated/runtime-protobuf/runtime/v1/agent_work.js';
import { ReasonCode } from '../../core-generated/runtime-protobuf/runtime/v1/common.js';
import { createNimiLocalAppAgentWorkClient, type NimiLocalAppAgentWorkClient } from './local-app-runtime-platform-agent-work.js';

export type NimiLocalAppAgentWorkRuntime = Pick<RuntimeTypedClient,
  'listLocalAppAgentWorkReferences' | 'startLocalAppAgentWork' | 'getLocalAppAgentWork' | 'getLocalAppAgentWorkStatus'
  | 'listLocalAppAgentWorkToolCalls' | 'submitLocalAppAgentWorkToolResult' | 'cancelLocalAppAgentWork' | 'subscribeLocalAppAgentWorkEvents'>;

export function createNimiLocalAppAgentWorkRuntimeClient(runtime: NimiLocalAppAgentWorkRuntime): NimiLocalAppAgentWorkClient {
  return createNimiLocalAppAgentWorkClient({
    listReferences: async () => (await runtime.listLocalAppAgentWorkReferences({})).references.map(value => ({ ...value, avatarUrl: value.avatarUrl ?? null })),
    start: input => runtime.startLocalAppAgentWork({ ...input, work: { ...input.work, sources: [...input.work.sources], tools: [...input.work.tools] } }),
    get: async input => ({ execution: execution((await runtime.getLocalAppAgentWork(input)).execution) }),
    status: async input => { const value = await runtime.getLocalAppAgentWorkStatus(input); return { busy: value.busy, ownExecutionId: value.ownExecutionId ?? null }; },
    listToolCalls: input => runtime.listLocalAppAgentWorkToolCalls(input),
    submitToolResult: input => runtime.submitLocalAppAgentWorkToolResult(input),
    cancel: async input => ({ execution: execution((await runtime.cancelLocalAppAgentWork(input)).execution) }),
    subscribe: async input => {
      const controller = new AbortController();
      const source = runtime.subscribeLocalAppAgentWorkEvents({ ...input, afterSequence: input.afterSequence ?? '0' }, { signal: controller.signal });
      return { events: (async function* () { for await (const value of source) yield event(value); })(), cancel: async () => controller.abort() };
    },
  });
}

function execution(value: LocalAppAgentWorkExecution | undefined) {
  if (!value) throw new Error('Runtime Agent work execution is missing');
  if (ReasonCode[value.reasonCode] === undefined) throw new Error('Runtime Agent work reason is unsupported');
  const states: Record<number, string> = { [LocalAppAgentWorkState.RUNNING]: 'running', [LocalAppAgentWorkState.WAITING_TOOL]: 'waiting_tool', [LocalAppAgentWorkState.SUCCEEDED]: 'succeeded', [LocalAppAgentWorkState.FAILED]: 'failed', [LocalAppAgentWorkState.CANCELLED]: 'cancelled' };
  return { ...value, state: states[value.state] ?? '', reasonCode: value.reasonCode === ReasonCode.REASON_CODE_UNSPECIFIED ? '' : ReasonCode[value.reasonCode] ?? '', sequence: String(value.sequence) };
}
function event(value: LocalAppAgentWorkEvent) {
  const base = { executionId: value.executionId, sequence: String(value.sequence) };
  switch (value.event.oneofKind) {
    case 'snapshot': return { ...base, type: 'snapshot', execution: execution(value.event.snapshot) };
    case 'textDelta': return { ...base, type: 'text-delta', delta: value.event.textDelta };
    case 'toolCall': return { ...base, type: 'tool-call', call: value.event.toolCall };
    default: throw new Error('Runtime Agent work event is unsupported');
  }
}
