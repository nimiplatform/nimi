import type {
  AgentEvent,
  QueryAgentMemoryRequest,
  QueryAgentMemoryResponse,
  SubscribeAgentEventsRequest,
  WriteAgentMemoryRequest,
  WriteAgentMemoryResponse,
} from './generated/runtime/v1/agent_core.js';
import type {
  ExecuteScenarioRequest,
  ExecuteScenarioResponse,
  StreamScenarioEvent,
  StreamScenarioRequest,
} from './generated/runtime/v1/ai.js';
import type {
  CreateBankRequest,
  CreateBankResponse,
  MemoryEvent,
  SubscribeMemoryEventsRequest,
} from './generated/runtime/v1/memory.js';
import { RuntimeMethodIds } from './method-ids.js';
import { Runtime } from './runtime.js';
import type { RuntimeUnsafeRawModule } from './types.js';

type Assert<T extends true> = T;
type IsEqual<A, B> = (
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
);

declare const raw: RuntimeUnsafeRawModule;
declare const runtime: Runtime;

const rawUnaryResult = raw.call(RuntimeMethodIds.ai.executeScenario, {} as ExecuteScenarioRequest);
const rawStreamResult = raw.call(RuntimeMethodIds.ai.streamScenario, {} as StreamScenarioRequest);
const runtimeUnaryResult = runtime.call(RuntimeMethodIds.ai.executeScenario, {} as ExecuteScenarioRequest);
const rawMemoryUnaryResult = raw.call(RuntimeMethodIds.memory.createBank, {} as CreateBankRequest);
const rawMemoryStreamResult = raw.call(RuntimeMethodIds.memory.subscribeEvents, {} as SubscribeMemoryEventsRequest);
const runtimeMemoryUnaryResult = runtime.call(RuntimeMethodIds.memory.createBank, {} as CreateBankRequest);
const rawAgentCoreUnaryResult = raw.call(RuntimeMethodIds.agentCore.queryMemory, {} as QueryAgentMemoryRequest);
const rawAgentCoreStreamResult = raw.call(RuntimeMethodIds.agentCore.subscribeEvents, {} as SubscribeAgentEventsRequest);
const runtimeAgentCoreUnaryResult = runtime.call(RuntimeMethodIds.agentCore.writeMemory, {} as WriteAgentMemoryRequest);
const fallbackRawResult = raw.call('/nimi.runtime.v1.Custom/Unknown', {});

type _GuardRawUnaryResult = Assert<IsEqual<
  Awaited<typeof rawUnaryResult>,
  ExecuteScenarioResponse
>>;
type _GuardRawStreamResult = Assert<IsEqual<
  Awaited<typeof rawStreamResult>,
  AsyncIterable<StreamScenarioEvent>
>>;
type _GuardRuntimeUnaryResult = Assert<IsEqual<
  Awaited<typeof runtimeUnaryResult>,
  ExecuteScenarioResponse
>>;
type _GuardRawMemoryUnaryResult = Assert<IsEqual<
  Awaited<typeof rawMemoryUnaryResult>,
  CreateBankResponse
>>;
type _GuardRawMemoryStreamResult = Assert<IsEqual<
  Awaited<typeof rawMemoryStreamResult>,
  AsyncIterable<MemoryEvent>
>>;
type _GuardRuntimeMemoryUnaryResult = Assert<IsEqual<
  Awaited<typeof runtimeMemoryUnaryResult>,
  CreateBankResponse
>>;
type _GuardRawAgentCoreUnaryResult = Assert<IsEqual<
  Awaited<typeof rawAgentCoreUnaryResult>,
  QueryAgentMemoryResponse
>>;
type _GuardRawAgentCoreStreamResult = Assert<IsEqual<
  Awaited<typeof rawAgentCoreStreamResult>,
  AsyncIterable<AgentEvent>
>>;
type _GuardRuntimeAgentCoreUnaryResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentCoreUnaryResult>,
  WriteAgentMemoryResponse
>>;
type _GuardFallbackRawResult = Assert<IsEqual<
  Awaited<typeof fallbackRawResult>,
  unknown
>>;

// @ts-expect-error known method ids must reject incompatible request payloads
raw.call(RuntimeMethodIds.ai.executeScenario, { invalid: true });

// @ts-expect-error known stream method ids must reject incompatible request payloads
raw.call(RuntimeMethodIds.ai.streamScenario, { invalid: true });

// @ts-expect-error known memory method ids must reject incompatible request payloads
raw.call(RuntimeMethodIds.memory.createBank, { invalid: true });

// @ts-expect-error known agentCore method ids must reject incompatible request payloads
raw.call(RuntimeMethodIds.agentCore.queryMemory, { invalid: true });
