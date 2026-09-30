import type {
  NimiLocalAppFunctionTool,
  NimiLocalAppScenarioExecuteResult,
  NimiLocalAppTextMessage,
  NimiLocalAppTextOutputItem,
  NimiLocalAppTextTurnInput,
  NimiLocalAppTextTurnItem,
} from '@nimiplatform/sdk/app';
import { isJsonObject } from '@nimiplatform/sdk/types';
import {
  LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  defineStudioParameters,
} from '../../ai-studio-core/parameters.js';
import {
  studioAbortError,
  studioNonSuccessDiagnostics,
  type StudioCapabilityRuntimeContext,
} from '../../ai-studio-core/runtime.js';
import type {
  StudioCapabilityRunResult,
  StudioJsonValue,
  StudioTextExchangeItem,
  StudioTextExchangeStep,
} from '../../ai-studio-core/runtime-types.js';
import { t } from '../../shell/i18n/index.js';

export type LabTextExchangeScenario = 'tool-call' | 'structured-output';
// Synchronous steps use scenario.execute; streaming steps use the text-turn
// stream, which delivers text as it is generated and each tool call once
// it is complete.
export type LabTextExchangeDelivery = 'sync' | 'stream';

export type LabTextExchangeParameters = {
  scenario?: LabTextExchangeScenario;
  delivery?: LabTextExchangeDelivery;
};

export const labTextExchangeParameters = defineStudioParameters<LabTextExchangeParameters>({
  initial: () => ({ scenario: 'tool-call', delivery: 'sync' }),
  routeMatrix: { scenario: LOCAL_AND_CLOUD_STUDIO_PARAMETER, delivery: LOCAL_AND_CLOUD_STUDIO_PARAMETER },
});

// One fixed, side-effect-free test tool. The App validates its arguments and
// computes the answer itself; nothing else can be registered or executed.
export const LAB_TEST_TOOL_NAME = 'lab_convert_centimeters';
export const LAB_TEST_TOOL: NimiLocalAppFunctionTool = Object.freeze({
  type: 'function',
  name: LAB_TEST_TOOL_NAME,
  description: 'Converts a length in centimeters to inches. A pure calculation with no side effects.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({ centimeters: Object.freeze({ type: 'number' }) }),
    required: Object.freeze(['centimeters']),
    additionalProperties: false,
  }),
});

// One fixed JSON Schema. The App parses the returned text and checks it; the
// SDK does not validate business JSON on the App's behalf.
export const LAB_TEST_SCHEMA_NAME = 'lab_release_note';
export const LAB_TEST_SCHEMA: NimiLocalAppResponseSchema = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    title: Object.freeze({ type: 'string' }),
    priority: Object.freeze({ type: 'string', enum: Object.freeze(['low', 'medium', 'high']) }),
    tags: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) }),
  }),
  required: Object.freeze(['title', 'priority', 'tags']),
  additionalProperties: false,
});

type NimiLocalAppResponseSchema = NonNullable<NonNullable<NimiLocalAppTextTurnInput['responseFormat']>['schema']>;

const MAX_MODEL_STEPS = 3;

export class LabTextExchangeCheckError extends Error {
  constructor(message: string, readonly steps: readonly StudioTextExchangeStep[]) {
    super(message);
    this.name = 'LabTextExchangeCheckError';
  }
}

export function runLabTestTool(argumentsValue: unknown): { readonly result: StudioJsonValue } {
  if (!isJsonObject(argumentsValue)) throw new Error(t('CapabilityTests.textTools.argumentsNotObject'));
  const keys = Object.keys(argumentsValue);
  const centimeters = argumentsValue.centimeters;
  if (keys.length !== 1 || keys[0] !== 'centimeters' || typeof centimeters !== 'number' || !Number.isFinite(centimeters)) {
    throw new Error(t('CapabilityTests.textTools.argumentsShape'));
  }
  return { result: { centimeters, inches: Math.round((centimeters / 2.54) * 10_000) / 10_000 } };
}

export function checkLabTestSchemaResult(text: string): { readonly title: string; readonly priority: 'low' | 'medium' | 'high'; readonly tags: readonly string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(t('CapabilityTests.textTools.notJson'));
  }
  if (!isJsonObject(parsed)) throw new Error(t('CapabilityTests.textTools.notObject'));
  const extra = Object.keys(parsed).filter((key) => !['title', 'priority', 'tags'].includes(key));
  if (extra.length > 0) throw new Error(t('CapabilityTests.textTools.undeclaredFields', { fields: extra.join(', ') }));
  if (typeof parsed.title !== 'string' || !parsed.title.trim()) throw new Error(t('CapabilityTests.textTools.titleInvalid'));
  if (parsed.priority !== 'low' && parsed.priority !== 'medium' && parsed.priority !== 'high') throw new Error(t('CapabilityTests.textTools.priorityInvalid'));
  if (!Array.isArray(parsed.tags) || parsed.tags.some((tag) => typeof tag !== 'string')) throw new Error(t('CapabilityTests.textTools.tagsInvalid'));
  return { title: parsed.title, priority: parsed.priority, tags: parsed.tags as string[] };
}

function exchangeItem(item: NimiLocalAppTextOutputItem): StudioTextExchangeItem {
  if (item.type === 'text') return { type: 'text', text: item.text };
  if (item.type === 'reasoning-continuity') {
    return { type: 'reasoning-continuity', carrierKind: item.carrier.kind, version: item.carrier.version, payloadBytes: item.carrier.payload.length };
  }
  return { type: 'tool-call', toolCallId: item.toolCall.id, toolName: item.toolCall.name, arguments: item.toolCall.arguments as StudioJsonValue };
}

type TextGenerateOutput = Extract<NimiLocalAppScenarioExecuteResult['output'], { type: 'text-generate' }>;
type TextGenerateStep = { readonly output: TextGenerateOutput; readonly traceId: string };
type LabTextStream = Awaited<ReturnType<StudioCapabilityRuntimeContext['host']['client']['ai']['text']['streamTurn']>>;

// The text-turn stream takes no signal, so Stop settles the open at once and a
// stream that still arrives afterwards is released as soon as it does.
async function openLabTextStream(context: StudioCapabilityRuntimeContext, input: NimiLocalAppTextTurnInput): Promise<LabTextStream> {
  const signal = context.input.signal;
  const opening = context.host.client.ai.text.streamTurn(input);
  if (!signal) return opening;
  let onAbort!: () => void;
  const stopRequested = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(studioAbortError());
  });
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([opening, stopRequested]);
  } catch (error) {
    void opening.then((late) => late.cancel()).catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

// Collects one streamed step into the same ordered items a synchronous step
// returns. A failed, unterminated or stopped stream never becomes a result.
async function streamLabTextStep(context: StudioCapabilityRuntimeContext, input: NimiLocalAppTextTurnInput): Promise<TextGenerateStep> {
  const signal = context.input.signal;
  const subscription = await openLabTextStream(context, input);
  let canceled = false;
  const cancel = () => {
    if (canceled) return;
    canceled = true;
    void subscription.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const items: NimiLocalAppTextOutputItem[] = [];
    let traceId = '';
    if (signal?.aborted) throw studioAbortError();
    for await (const event of subscription) {
      if (signal?.aborted) throw studioAbortError();
      traceId = event.traceId || traceId;
      if (event.type === 'failed') {
        throw Object.assign(new Error(event.actionHint || event.reasonCode), { reasonCode: event.reasonCode, actionHint: event.actionHint });
      }
      if (event.type === 'completed') {
        return { output: { type: 'text-generate', items, finishReason: event.finishReason }, traceId };
      }
      const current = items[event.itemIndex];
      if (event.type === 'delta') {
        if (event.itemIndex === items.length) items.push({ type: 'text', text: event.text });
        else if (current?.type === 'text' && event.itemIndex === items.length - 1) items[event.itemIndex] = { type: 'text', text: current.text + event.text };
        else throw new Error(t('CapabilityTests.textTools.streamOrder'));
        continue;
      }
      if (event.itemIndex !== items.length) throw new Error(t('CapabilityTests.textTools.streamOrder'));
      items.push(event.type === 'tool-call' ? { type: 'tool-call', toolCall: event.toolCall } : { type: 'reasoning-continuity', carrier: event.carrier });
    }
    throw new Error(t('CapabilityTests.textTools.streamIncomplete'));
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
  }
}

function stopped(context: StudioCapabilityRuntimeContext, error?: unknown): StudioCapabilityRunResult {
  return context.host.nonSuccess(
    context.capability,
    'operation-aborted',
    context.host.translate('CapabilityTests.textTools.stopped'),
    error === undefined ? undefined : studioNonSuccessDiagnostics(error),
  );
}

// Stop ends the run at the next await: a pending model step settles as stopped
// through the SDK signal or the stream release, and a result that still
// arrives afterwards never runs the App tool, starts another step or succeeds.
export async function runLabTextExchange(context: StudioCapabilityRuntimeContext): Promise<StudioCapabilityRunResult> {
  const { host, capability } = context;
  const signal = context.input.signal;
  const parameters = context.input.parameters as LabTextExchangeParameters | undefined;
  const scenario: LabTextExchangeScenario = parameters?.scenario === 'structured-output' ? 'structured-output' : 'tool-call';
  const delivery: LabTextExchangeDelivery = parameters?.delivery === 'stream' ? 'stream' : 'sync';
  const prompt = context.input.prompt.trim();
  if (!prompt) return host.nonSuccess(capability, 'input-invalid', host.translate('CapabilityTests.textTools.inputRequired'));
  const steps: StudioTextExchangeStep[] = [];
  const messages: NimiLocalAppTextMessage[] = [{ role: 'user', text: prompt }];
  const seenToolCallIds = new Set<string>();
  function fail(message: string): never {
    throw new LabTextExchangeCheckError(message, steps);
  }
  let lastTraceId = '';
  try {
    for (let step = 0; step < MAX_MODEL_STEPS; step += 1) {
      if (signal?.aborted) return stopped(context);
      const request: NimiLocalAppTextTurnInput = scenario === 'tool-call'
        ? { messages: [...messages], tools: [LAB_TEST_TOOL], toolChoice: 'auto' }
        : { messages: [...messages], responseFormat: { type: 'json-schema', name: LAB_TEST_SCHEMA_NAME, schema: LAB_TEST_SCHEMA, strict: true } };
      const response = delivery === 'stream'
        ? await streamLabTextStep(context, request)
        : await host.client.ai.scenario.execute({ type: 'text-generate', ...request }, signal ? { signal } : undefined);
      if (signal?.aborted) return stopped(context);
      if (response.output.type !== 'text-generate') fail(host.translate('CapabilityTests.textTools.nonTextOutput'));
      const output: TextGenerateOutput = response.output;
      lastTraceId = response.traceId || lastTraceId;
      steps.push({
        origin: 'model',
        finishReason: output.finishReason,
        ...(response.traceId ? { traceId: response.traceId } : {}),
        items: output.items.map(exchangeItem),
      });
      const toolCalls = output.items.flatMap((item) => item.type === 'tool-call' ? [item.toolCall] : []);
      if (toolCalls.length === 0) {
        if (scenario === 'tool-call' && step === 0) fail(host.translate('CapabilityTests.textTools.toolNotCalled', { tool: LAB_TEST_TOOL_NAME }));
        const text = output.items.flatMap((item) => item.type === 'text' ? [item.text] : []).join('');
        if (scenario === 'structured-output') {
          let structured: ReturnType<typeof checkLabTestSchemaResult>;
          try {
            structured = checkLabTestSchemaResult(text);
          } catch (error) {
            fail(host.translate('CapabilityTests.textTools.structuredCheckFailed', { detail: error instanceof Error ? error.message : String(error) }));
          }
          return success(context, scenario, steps, text, lastTraceId, { title: structured.title, priority: structured.priority, tags: [...structured.tags] });
        }
        if (!text.trim()) fail(host.translate('CapabilityTests.textTools.noFinalText'));
        return success(context, scenario, steps, text, lastTraceId);
      }
      if (scenario === 'structured-output') fail(host.translate('CapabilityTests.textTools.unexpectedToolCall'));
      const results: NimiLocalAppTextTurnItem[] = [];
      const resultItems: StudioTextExchangeItem[] = [];
      for (const call of toolCalls) {
        if (signal?.aborted) return stopped(context);
        if (call.name !== LAB_TEST_TOOL_NAME) fail(host.translate('CapabilityTests.textTools.undeclaredTool', { tool: call.name }));
        if (!call.id || seenToolCallIds.has(call.id)) fail(host.translate('CapabilityTests.textTools.toolCallIdInvalid', { id: call.id || '—' }));
        seenToolCallIds.add(call.id);
        let executed: ReturnType<typeof runLabTestTool>;
        try {
          executed = runLabTestTool(call.arguments);
        } catch (error) {
          fail(host.translate('CapabilityTests.textTools.argumentsInvalid', { id: call.id, detail: error instanceof Error ? error.message : String(error) }));
        }
        results.push({ type: 'tool-result', toolResult: { toolCallId: call.id, toolName: call.name, result: executed.result, isError: false } });
        resultItems.push({ type: 'tool-result', toolCallId: call.id, toolName: call.name, result: executed.result, isError: false });
      }
      steps.push({ origin: 'app', items: resultItems });
      // Every returned item goes back in its original order, reasoning
      // continuity included, followed by the results for the same call IDs.
      messages.push({
        role: 'assistant',
        text: '',
        turnItems: [...output.items.map((item): NimiLocalAppTextTurnItem => ({ type: 'output', output: item })), ...results],
      });
    }
    return fail(host.translate('CapabilityTests.textTools.tooManySteps', { steps: MAX_MODEL_STEPS }));
  } catch (error) {
    if (signal?.aborted) return stopped(context, error);
    if (!(error instanceof LabTextExchangeCheckError)) throw error;
    return host.nonSuccess(capability, 'runtime-call-failed', host.translate('CapabilityTests.textTools.checkFailed', {
      detail: error.message,
      steps: JSON.stringify(error.steps).slice(0, 4000),
    }));
  }
}

function success(
  context: StudioCapabilityRuntimeContext,
  scenario: LabTextExchangeScenario,
  steps: readonly StudioTextExchangeStep[],
  text: string,
  traceId: string,
  structured?: StudioJsonValue,
): StudioCapabilityRunResult {
  return {
    ok: true,
    capabilityId: context.capability.id,
    capabilityLabel: context.capability.label,
    message: context.host.translate(scenario === 'tool-call' ? 'CapabilityTests.textTools.toolPassed' : 'CapabilityTests.textTools.schemaPassed'),
    output: {
      kind: 'text-exchange',
      scenario,
      steps: [...steps],
      text,
      ...(structured !== undefined ? { structured } : {}),
    },
    ...(traceId ? { trace: { traceId } } : {}),
  };
}
