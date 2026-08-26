import type { JsonValue } from '../../types';
import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';
import {
  asRecord,
  assertExactKeys,
  assertExactProjectionKeys,
  localAppError,
  localAppProjectionError,
  projectTimestamp,
} from './local-app-runtime-platform-validation.js';

export type NimiRealtimeAudioFormat = {
  readonly codec: 'pcm-s16le';
  readonly sampleRateHz: number;
  readonly channelCount: 1 | 2;
  readonly frameDurationMs: number;
  readonly maximumFrameBytes: number;
};

export type NimiRealtimeControlStatus = {
  readonly realtimeSessionId: string;
  readonly channelId: string;
  readonly subscriptionId: string;
  readonly adapterKind: 'realm' | 'local-agent' | 'ai';
  readonly lifecycle: 'opening' | 'ready' | 'degraded' | 'reconnecting' | 'closed' | 'failed';
  readonly generation: string;
  readonly sequence: string;
  readonly correlationId: string;
  readonly backpressure: 'normal' | 'pressured' | 'blocked';
  readonly bufferedItems: number;
  readonly bufferCapacity: number;
  readonly terminalReason: '' | 'cancelled' | 'unauthenticated' | 'permission-denied' | 'not-found' | 'unavailable' | 'protocol-failure' | 'resource-exhausted' | 'slow-consumer' | 'runtime-shutdown' | 'stale-generation' | 'owner-failed';
  readonly actionHint: string;
  readonly occurredAt: { readonly seconds: string; readonly nanos: number } | null;
};

export type NimiRealtimeOperationResult = {
  readonly ack: { readonly ok: boolean; readonly reasonCode: string; readonly actionHint: string };
  readonly control: NimiRealtimeControlStatus;
};

export type NimiAiRealtimeInput =
  | { readonly type: 'text'; readonly requestId: string; readonly text: string }
  | { readonly type: 'audio-frame'; readonly inputTrackId: string; readonly utteranceId: string; readonly frameSequence: string; readonly frame: Uint8Array }
  | { readonly type: 'owner-context'; readonly requestId: string; readonly kind: 'instruction' | 'context' | 'sanitized-result'; readonly text: string };

export type NimiAgentRealtimeInput =
  | Exclude<NimiAiRealtimeInput, { readonly type: 'owner-context' }>
  | { readonly type: 'capture-stopped'; readonly inputTrackId: string; readonly utteranceId: string };

type NimiRealtimeEventCommon =
  | { readonly type: 'input-accepted'; readonly inputTrackId: string; readonly utteranceId: string; readonly frameSequence: string; readonly requestId: string }
  | { readonly type: 'speech-status'; readonly inputTrackId: string; readonly utteranceId: string; readonly state: 'started' | 'stopped' }
  | { readonly type: 'transcript'; readonly inputTrackId: string; readonly utteranceId: string; readonly text: string; readonly final: boolean }
  | { readonly type: 'text-output'; readonly requestId: string; readonly outputTrackId: string; readonly text: string; readonly final: boolean }
  | { readonly type: 'audio-frame'; readonly requestId: string; readonly outputTrackId: string; readonly frameSequence: string; readonly frame: Uint8Array; readonly format: NimiRealtimeAudioFormat }
  | { readonly type: 'output-track'; readonly requestId: string; readonly outputTrackId: string; readonly lifecycle: 'active' | 'interrupted' | 'completed' | 'failed'; readonly reasonCode: string };

export type NimiAiRealtimeEvent = NimiRealtimeEventCommon
  | { readonly type: 'opened'; readonly inputAudio: NimiRealtimeAudioFormat; readonly outputAudio: NimiRealtimeAudioFormat | null; readonly turnDetection: 'server-vad' | 'manual' }
  | { readonly type: 'request-terminal'; readonly requestId: string; readonly finishReason: 'stop' | 'length' | 'tool-call' | 'content-filter' | 'error' | 'unspecified'; readonly usage: NimiRealtimeUsage | null; readonly reasonCode: string }
  | { readonly type: 'session-terminal'; readonly reasonCode: string }
  | { readonly type: 'failure'; readonly requestId: string; readonly outputTrackId: string; readonly reasonCode: string };

export type NimiAgentRealtimeEvent = NimiRealtimeEventCommon | { readonly type: 'terminal'; readonly reasonCode: string };

export type NimiRealtimeUsage = {
  readonly inputTokens: string;
  readonly outputTokens: string;
  readonly computeMs: string;
  readonly cachedInputTokens: string;
  readonly reasoningOutputTokens: string;
};

export type NimiRealtimeEventEnvelope<T> = { readonly control: NimiRealtimeControlStatus; readonly event: T };
export type NimiRealtimeSubscription<T> = AsyncIterable<NimiRealtimeEventEnvelope<T>> & { readonly cancel: () => Promise<void> };

export type NimiAiRealtimeClient = {
  readonly open: (input: { readonly inputAudio: NimiRealtimeAudioFormat; readonly audioOutputEnabled: boolean; readonly turnDetection: 'server-vad' | 'manual'; readonly initialInstruction: string }) => Promise<NimiRealtimeOpenResult>;
  readonly appendInput: (input: NimiRealtimeScope & { readonly input: NimiAiRealtimeInput }) => Promise<NimiRealtimeOperationResult>;
  readonly submitOwnerControl: (input: NimiRealtimeScope & { readonly requestId: string; readonly control: 'commit-input' | 'start-response' | 'continue-response' | 'pause-response' | 'cancel-response' }) => Promise<NimiRealtimeOperationResult>;
  readonly subscribe: (input: NimiRealtimeScope) => Promise<NimiRealtimeSubscription<NimiAiRealtimeEvent>>;
  readonly interruptOutput: (input: NimiRealtimeScope & { readonly outputTrackId: string }) => Promise<NimiRealtimeOperationResult>;
  readonly close: (input: NimiRealtimeScope) => Promise<NimiRealtimeOperationResult>;
};

export type NimiAgentRealtimeClient = {
  readonly open: (input: { readonly agentHandle: NimiLocalAppAgentHandle; readonly conversationAnchorId?: string; readonly inputAudio: NimiRealtimeAudioFormat; readonly turnDetection: 'server-vad' | 'manual' }) => Promise<NimiAgentRealtimeOpenResult>;
  readonly appendInput: (input: NimiAgentRealtimeScope & { readonly input: NimiAgentRealtimeInput }) => Promise<NimiRealtimeOperationResult>;
  readonly subscribe: (input: NimiAgentRealtimeScope) => Promise<NimiRealtimeSubscription<NimiAgentRealtimeEvent>>;
  readonly status: (input: NimiAgentRealtimeScope) => Promise<NimiRealtimeControlStatus>;
  readonly interruptOutput: (input: NimiAgentRealtimeScope & { readonly outputTrackId: string; readonly interruptAgentTurn: boolean }) => Promise<NimiRealtimeOperationResult>;
  readonly close: (input: NimiAgentRealtimeScope) => Promise<NimiRealtimeOperationResult>;
};

type NimiRealtimeScope = { readonly realtimeSessionId: string; readonly generation: string };
type NimiAgentRealtimeScope = NimiRealtimeScope & { readonly agentHandle: NimiLocalAppAgentHandle };
type NimiRealtimeOpenResult = NimiRealtimeScope & { readonly channelId: string; readonly negotiatedInputAudio: NimiRealtimeAudioFormat; readonly negotiatedOutputAudio: NimiRealtimeAudioFormat | null; readonly control: NimiRealtimeControlStatus };
type NimiAgentRealtimeOpenResult = NimiRealtimeOpenResult & { readonly conversationAnchorId: string };

export type NimiRealtimeShellSubscription = { readonly events: AsyncIterable<unknown>; readonly cancel: () => Promise<void> };
type NimiRealtimeShellRecord = { readonly [key: string]: JsonValue };
export type NimiAiRealtimeShell = {
  readonly open: (input: NimiRealtimeShellRecord) => Promise<unknown>;
  readonly appendInput: (input: NimiRealtimeShellRecord) => Promise<unknown>;
  readonly submitOwnerControl: (input: NimiRealtimeShellRecord) => Promise<unknown>;
  readonly subscribe: (input: NimiRealtimeShellRecord) => Promise<NimiRealtimeShellSubscription>;
  readonly interruptOutput: (input: NimiRealtimeShellRecord) => Promise<unknown>;
  readonly close: (input: NimiRealtimeShellRecord) => Promise<unknown>;
};
export type NimiAgentRealtimeShell = Omit<NimiAiRealtimeShell, 'submitOwnerControl'> & { readonly status: (input: NimiRealtimeShellRecord) => Promise<unknown> };

export function createNimiAiRealtimeClient(shell: NimiAiRealtimeShell): NimiAiRealtimeClient {
  return Object.freeze({
    open: async (input) => {
      assertExactKeys(input, ['inputAudio', 'audioOutputEnabled', 'turnDetection', 'initialInstruction'], 'AI Realtime open');
      return projectOpen(await shell.open({
        inputAudio: validateAudioFormat(input.inputAudio),
        audioOutputEnabled: input.audioOutputEnabled,
        turnDetection: turnDetection(input.turnDetection),
        initialInstruction: inputText(input.initialInstruction, 16 * 1024, true),
      }), false) as NimiRealtimeOpenResult;
    },
    appendInput: async (input) => {
      assertExactKeys(input, ['realtimeSessionId', 'generation', 'input'], 'AI Realtime append');
      return projectOperation(await shell.appendInput({ ...scope(input), input: serializeInput(input.input, true) }));
    },
    submitOwnerControl: async (input) => {
      assertExactKeys(input, ['realtimeSessionId', 'generation', 'requestId', 'control'], 'AI Realtime owner control');
      if (!['commit-input', 'start-response', 'continue-response', 'pause-response', 'cancel-response'].includes(input.control)) invalidInput('AI Realtime owner control');
      return projectOperation(await shell.submitOwnerControl({ ...scope(input), requestId: selector(input.requestId), control: input.control }));
    },
    subscribe: async (input) => projectSubscription(await shell.subscribe(scopeExact(input, false)), projectAiEvent),
    interruptOutput: async (input) => {
      assertExactKeys(input, ['realtimeSessionId', 'generation', 'outputTrackId'], 'AI Realtime interrupt');
      return projectOperation(await shell.interruptOutput({ ...scope(input), outputTrackId: selector(input.outputTrackId) }));
    },
    close: async (input) => projectOperation(await shell.close(scopeExact(input, false))),
  });
}

export function createNimiAgentRealtimeClient(shell: NimiAgentRealtimeShell): NimiAgentRealtimeClient {
  return Object.freeze({
    open: async (input) => {
      const keys = input.conversationAnchorId === undefined ? ['agentHandle', 'inputAudio', 'turnDetection'] : ['agentHandle', 'conversationAnchorId', 'inputAudio', 'turnDetection'];
      assertExactKeys(input, keys, 'Agent Realtime open');
      return projectOpen(await shell.open({
        agentHandle: selector(input.agentHandle),
        ...(input.conversationAnchorId === undefined ? {} : { conversationAnchorId: selector(input.conversationAnchorId) }),
        inputAudio: validateAudioFormat(input.inputAudio), turnDetection: turnDetection(input.turnDetection),
      }), true) as NimiAgentRealtimeOpenResult;
    },
    appendInput: async (input) => {
      assertExactKeys(input, ['agentHandle', 'realtimeSessionId', 'generation', 'input'], 'Agent Realtime append');
      return projectOperation(await shell.appendInput({ ...agentScope(input), input: serializeInput(input.input, false) }));
    },
    subscribe: async (input) => projectSubscription(await shell.subscribe(scopeExact(input, true)), projectAgentEvent),
    status: async (input) => {
      const record = asRecord(await shell.status(scopeExact(input, true)));
      assertExactProjectionKeys(record, ['control'], 'Agent Realtime status');
      return projectControl(record.control);
    },
    interruptOutput: async (input) => {
      assertExactKeys(input, ['agentHandle', 'realtimeSessionId', 'generation', 'outputTrackId', 'interruptAgentTurn'], 'Agent Realtime interrupt');
      if (typeof input.interruptAgentTurn !== 'boolean') invalidInput('Agent Realtime interrupt');
      return projectOperation(await shell.interruptOutput({ ...agentScope(input), outputTrackId: selector(input.outputTrackId), interruptAgentTurn: input.interruptAgentTurn }));
    },
    close: async (input) => projectOperation(await shell.close(scopeExact(input, true))),
  });
}

function projectSubscription<T>(subscription: NimiRealtimeShellSubscription, projector: (value: unknown) => T): NimiRealtimeSubscription<T> {
  const projected: NimiRealtimeSubscription<T> = {
    async *[Symbol.asyncIterator]() {
      for await (const value of subscription.events) {
        const record = asRecord(value);
        assertExactProjectionKeys(record, ['control', 'event'], 'Realtime event envelope');
        yield Object.freeze({ control: projectControl(record.control), event: projector(record.event) });
      }
    },
    cancel: () => subscription.cancel(),
  };
  return Object.freeze(projected);
}

function projectOpen(value: unknown, agent: boolean): NimiRealtimeOpenResult | NimiAgentRealtimeOpenResult {
  const record = asRecord(value);
  assertExactProjectionKeys(record, agent
    ? ['conversationAnchorId', 'realtimeSessionId', 'channelId', 'generation', 'negotiatedInputAudio', 'negotiatedOutputAudio', 'control']
    : ['realtimeSessionId', 'channelId', 'generation', 'negotiatedInputAudio', 'negotiatedOutputAudio', 'control'], 'Realtime open');
  const base = {
    realtimeSessionId: selectorProjection(record.realtimeSessionId), channelId: selectorProjection(record.channelId), generation: decimal(record.generation),
    negotiatedInputAudio: projectAudioFormat(record.negotiatedInputAudio), negotiatedOutputAudio: projectOptionalAudioFormat(record.negotiatedOutputAudio), control: projectControl(record.control),
  };
  return Object.freeze(agent ? { conversationAnchorId: selectorProjection(record.conversationAnchorId), ...base } : base);
}

function projectOperation(value: unknown): NimiRealtimeOperationResult {
  const record = asRecord(value); assertExactProjectionKeys(record, ['ack', 'control'], 'Realtime operation');
  const ack = asRecord(record.ack); assertExactProjectionKeys(ack, ['ok', 'reasonCode', 'actionHint'], 'Realtime ack');
  if (typeof ack.ok !== 'boolean') localAppProjectionError('Realtime ack');
  return Object.freeze({ ack: Object.freeze({ ok: ack.ok, reasonCode: projectionText(ack.reasonCode, 128, true), actionHint: projectionText(ack.actionHint, 256, true) }), control: projectControl(record.control) });
}

function projectControl(value: unknown): NimiRealtimeControlStatus {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['realtimeSessionId','channelId','subscriptionId','adapterKind','lifecycle','generation','sequence','correlationId','backpressure','bufferedItems','bufferCapacity','terminalReason','actionHint','occurredAt'], 'Realtime control');
  const adapterKind = oneOf(record.adapterKind, ['realm','local-agent','ai']);
  const lifecycle = oneOf(record.lifecycle, ['opening','ready','degraded','reconnecting','closed','failed']);
  const backpressure = oneOf(record.backpressure, ['normal','pressured','blocked']);
  const terminalReason = oneOf(record.terminalReason, ['','cancelled','unauthenticated','permission-denied','not-found','unavailable','protocol-failure','resource-exhausted','slow-consumer','runtime-shutdown','stale-generation','owner-failed']);
  const occurredAt = record.occurredAt === null ? null : projectTimestamp(record.occurredAt, 'Realtime occurredAt') ?? null;
  return Object.freeze({
    realtimeSessionId: projectionText(record.realtimeSessionId, 256, true), channelId: projectionText(record.channelId, 256, true), subscriptionId: projectionText(record.subscriptionId, 256, true),
    adapterKind, lifecycle, generation: decimal(record.generation, true), sequence: decimal(record.sequence, true), correlationId: projectionText(record.correlationId, 256, true), backpressure,
    bufferedItems: safeInteger(record.bufferedItems), bufferCapacity: safeInteger(record.bufferCapacity), terminalReason, actionHint: projectionText(record.actionHint, 256, true), occurredAt,
  });
}

function projectAiEvent(value: unknown): NimiAiRealtimeEvent {
  const record = asRecord(value); const type = record?.type;
  if (type === 'opened') { assertExactProjectionKeys(record, ['type','inputAudio','outputAudio','turnDetection'], 'AI Realtime opened'); return Object.freeze({type,inputAudio:projectAudioFormat(record.inputAudio),outputAudio:projectOptionalAudioFormat(record.outputAudio),turnDetection:oneOf(record.turnDetection,['server-vad','manual'])}); }
  if (type === 'request-terminal') { assertExactProjectionKeys(record, ['type','requestId','finishReason','usage','reasonCode'], 'AI Realtime request terminal'); return Object.freeze({type,requestId:selectorProjection(record.requestId),finishReason:oneOf(record.finishReason,['stop','length','tool-call','content-filter','error','unspecified']),usage:record.usage===null?null:projectUsage(record.usage),reasonCode:projectionText(record.reasonCode,128,true)}); }
  if (type === 'session-terminal') { assertExactProjectionKeys(record,['type','reasonCode'],'AI Realtime session terminal'); return Object.freeze({type,reasonCode:projectionText(record.reasonCode,128,true)}); }
  if (type === 'failure') { assertExactProjectionKeys(record,['type','requestId','outputTrackId','reasonCode'],'AI Realtime failure'); return Object.freeze({type,requestId:projectionText(record.requestId,256,true),outputTrackId:projectionText(record.outputTrackId,256,true),reasonCode:projectionText(record.reasonCode,128,true)}); }
  return projectCommonEvent(record) as NimiAiRealtimeEvent;
}

function projectAgentEvent(value: unknown): NimiAgentRealtimeEvent {
  const record = asRecord(value);
  if (record?.type === 'terminal') { assertExactProjectionKeys(record,['type','reasonCode'],'Agent Realtime terminal'); return Object.freeze({type:'terminal',reasonCode:projectionText(record.reasonCode,128,true)}); }
  return projectCommonEvent(record) as NimiAgentRealtimeEvent;
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r105
function projectCommonEvent(record: Record<string, unknown> | undefined): NimiRealtimeEventCommon {
  const type = record?.type;
  if (type === 'input-accepted') {
    assertExactProjectionKeys(record,['type','inputTrackId','utteranceId','frameSequence','requestId'],type);
    const inputTrackId=projectionText(record.inputTrackId,256,true); const utteranceId=projectionText(record.utteranceId,256,true);
    const frameSequence=decimal(record.frameSequence,true); const requestId=projectionText(record.requestId,256,true);
    const textAccepted=requestId!==''&&inputTrackId===''&&utteranceId===''&&frameSequence==='0';
    const audioAccepted=requestId===''&&inputTrackId!==''&&utteranceId!==''&&frameSequence!=='0';
    if(!textAccepted&&!audioAccepted)localAppProjectionError(type);
    return Object.freeze({type,inputTrackId,utteranceId,frameSequence,requestId});
  }
  if (type === 'speech-status') { assertExactProjectionKeys(record,['type','inputTrackId','utteranceId','state'],type); return Object.freeze({type,inputTrackId:selectorProjection(record.inputTrackId),utteranceId:selectorProjection(record.utteranceId),state:oneOf(record.state,['started','stopped'])}); }
  if (type === 'transcript') { assertExactProjectionKeys(record,['type','inputTrackId','utteranceId','text','final'],type); if(typeof record.final!=='boolean')localAppProjectionError(type); return Object.freeze({type,inputTrackId:selectorProjection(record.inputTrackId),utteranceId:selectorProjection(record.utteranceId),text:projectionContent(record.text,64*1024),final:record.final}); }
  if (type === 'text-output') { assertExactProjectionKeys(record,['type','requestId','outputTrackId','text','final'],type); if(typeof record.final!=='boolean')localAppProjectionError(type); return Object.freeze({type,requestId:selectorProjection(record.requestId),outputTrackId:selectorProjection(record.outputTrackId),text:projectionContent(record.text,256*1024),final:record.final}); }
  if (type === 'audio-frame') { assertExactProjectionKeys(record,['type','requestId','outputTrackId','frameSequence','frame','format'],type); return Object.freeze({type,requestId:selectorProjection(record.requestId),outputTrackId:selectorProjection(record.outputTrackId),frameSequence:decimal(record.frameSequence),frame:projectBytes(record.frame),format:projectAudioFormat(record.format)}); }
  if (type === 'output-track') { assertExactProjectionKeys(record,['type','requestId','outputTrackId','lifecycle','reasonCode'],type); return Object.freeze({type,requestId:selectorProjection(record.requestId),outputTrackId:selectorProjection(record.outputTrackId),lifecycle:oneOf(record.lifecycle,['active','interrupted','completed','failed']),reasonCode:projectionText(record.reasonCode,128,true)}); }
  return localAppProjectionError('Realtime event');
}

function serializeInput(input: NimiAiRealtimeInput | NimiAgentRealtimeInput, ownerContext: boolean): NimiRealtimeShellRecord {
  if (input.type === 'text') { assertExactKeys(input,['type','requestId','text'],'Realtime text input'); return {type:'text',requestId:selector(input.requestId),text:inputText(input.text,64*1024,false)}; }
  if (input.type === 'audio-frame') { assertExactKeys(input,['type','inputTrackId','utteranceId','frameSequence','frame'],'Realtime audio input'); if(!(input.frame instanceof Uint8Array)||input.frame.byteLength===0||input.frame.byteLength>64*1024)invalidInput('Realtime audio input'); return {type:'audio-frame',inputTrackId:selector(input.inputTrackId),utteranceId:selector(input.utteranceId),frameSequence:decimalInput(input.frameSequence),frame:Object.freeze(Array.from(input.frame))}; }
  if (input.type === 'capture-stopped') { if(ownerContext)invalidInput('AI Realtime input'); assertExactKeys(input,['type','inputTrackId','utteranceId'],'Agent Realtime capture observation'); return {type:'capture-stopped',inputTrackId:selector(input.inputTrackId),utteranceId:selector(input.utteranceId)}; }
  if (!ownerContext) invalidInput('Agent Realtime input');
  assertExactKeys(input,['type','requestId','kind','text'],'Realtime owner context');
  return {type:'owner-context',requestId:selector(input.requestId),kind:oneOfInput(input.kind,['instruction','context','sanitized-result']),text:inputText(input.text,64*1024,false)};
}

function validateAudioFormat(value: NimiRealtimeAudioFormat): NimiRealtimeShellRecord { assertExactKeys(value,['codec','sampleRateHz','channelCount','frameDurationMs','maximumFrameBytes'],'Realtime audio format'); if(value.codec!=='pcm-s16le'||!Number.isSafeInteger(value.sampleRateHz)||value.sampleRateHz<8000||value.sampleRateHz>192000||!Number.isSafeInteger(value.channelCount)||value.channelCount<1||value.channelCount>2||!Number.isSafeInteger(value.frameDurationMs)||value.frameDurationMs<1||value.frameDurationMs>100||!Number.isSafeInteger(value.maximumFrameBytes)||value.maximumFrameBytes<1||value.maximumFrameBytes>64*1024)invalidInput('Realtime audio format'); return {...value}; }
function projectAudioFormat(value: unknown): NimiRealtimeAudioFormat { const r=asRecord(value); assertExactProjectionKeys(r,['codec','sampleRateHz','channelCount','frameDurationMs','maximumFrameBytes'],'Realtime audio format'); const v=validateAudioFormat(r as NimiRealtimeAudioFormat); return Object.freeze(v) as NimiRealtimeAudioFormat; }
function projectOptionalAudioFormat(value: unknown): NimiRealtimeAudioFormat | null { return value === null ? null : projectAudioFormat(value); }
function scope(input:NimiRealtimeScope){return {realtimeSessionId:selector(input.realtimeSessionId),generation:decimalInput(input.generation)};}
function agentScope(input:NimiAgentRealtimeScope){return {agentHandle:selector(input.agentHandle),...scope(input)};}
function scopeExact(input:NimiRealtimeScope|NimiAgentRealtimeScope,agent:boolean){assertExactKeys(input,agent?['agentHandle','realtimeSessionId','generation']:['realtimeSessionId','generation'],'Realtime scope');return agent?agentScope(input as NimiAgentRealtimeScope):scope(input);}
function selector(value:unknown):string{if(typeof value!=='string'||!value||value.trim()!==value||value.length>256||/[\u0000-\u001f\u007f]/u.test(value))invalidInput('Realtime selector');return value;}
function selectorProjection(value:unknown):string{if(typeof value!=='string'||!value||value.trim()!==value||value.length>256||/[\u0000-\u001f\u007f]/u.test(value))localAppProjectionError('Realtime selector');return value;}
function decimalInput(value:unknown):string{if(typeof value!=='string'||! /^[1-9][0-9]*$/u.test(value))invalidInput('Realtime sequence');return value;}
function decimal(value:unknown,zero=false):string{if(typeof value!=='string'||!(zero?/^(0|[1-9][0-9]*)$/u:/^[1-9][0-9]*$/u).test(value))localAppProjectionError('Realtime sequence');return value;}
function inputText(value:unknown,max:number,empty:boolean):string{if(typeof value!=='string'||(!empty&&!value)||value.trim()!==value||new TextEncoder().encode(value).byteLength>max||/[\u0000\u007f]/u.test(value))invalidInput('Realtime text');return value;}
function projectionText(value:unknown,max:number,empty:boolean):string{if(typeof value!=='string'||(!empty&&!value)||value.trim()!==value||new TextEncoder().encode(value).byteLength>max||/[\u0000\u007f]/u.test(value))localAppProjectionError('Realtime text');return value;}
function projectionContent(value:unknown,max:number):string{if(typeof value!=='string'||new TextEncoder().encode(value).byteLength>max||/[\u0000\u007f]/u.test(value))localAppProjectionError('Realtime content');return value;}
function turnDetection(value:unknown){return oneOfInput(value,['server-vad','manual']);}
function oneOf<T extends string>(value:unknown,values:readonly T[]):T{if(typeof value!=='string'||!values.includes(value as T))localAppProjectionError('Realtime enum');return value as T;}
function oneOfInput<T extends string>(value:unknown,values:readonly T[]):T{if(typeof value!=='string'||!values.includes(value as T))invalidInput('Realtime enum');return value as T;}
function safeInteger(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)localAppProjectionError('Realtime integer');return value;}
function projectBytes(value:unknown):Uint8Array{if(!Array.isArray(value)||value.length===0||value.length>64*1024||value.some(v=>!Number.isInteger(v)||v<0||v>255))localAppProjectionError('Realtime audio frame');return Uint8Array.from(value);}
function projectUsage(value:unknown):NimiRealtimeUsage{const r=asRecord(value);assertExactProjectionKeys(r,['inputTokens','outputTokens','computeMs','cachedInputTokens','reasoningOutputTokens'],'Realtime usage');return Object.freeze({inputTokens:decimal(r.inputTokens,true),outputTokens:decimal(r.outputTokens,true),computeMs:decimal(r.computeMs,true),cachedInputTokens:decimal(r.cachedInputTokens,true),reasoningOutputTokens:decimal(r.reasoningOutputTokens,true)});}
function invalidInput(field:string):never{return localAppError(`${field} is invalid.`,'SDK_LOCAL_APP_INPUT_INVALID','provide_valid_realtime_input');}
