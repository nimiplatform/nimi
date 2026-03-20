import type {
  ExecuteScenarioRequest,
  ExecuteScenarioResponse,
  StreamScenarioEvent,
  StreamScenarioRequest,
} from './generated/runtime/v1/ai.js';
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
type _GuardFallbackRawResult = Assert<IsEqual<
  Awaited<typeof fallbackRawResult>,
  unknown
>>;

// @ts-expect-error known method ids must reject incompatible request payloads
raw.call(RuntimeMethodIds.ai.executeScenario, { invalid: true });

// @ts-expect-error known stream method ids must reject incompatible request payloads
raw.call(RuntimeMethodIds.ai.streamScenario, { invalid: true });
