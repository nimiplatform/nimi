import { FinishReason } from '../../core-generated/runtime-protobuf/runtime/v1/ai.js';
import type { Ack, UsageStats } from '../../core-generated/runtime-protobuf/runtime/v1/common.js';
import {
  AiRealtimeAudioCodec,
  AiRealtimeOutputTrackLifecycle,
  AiRealtimeOwnerContextKind,
  AiRealtimeOwnerControlKind,
  AiRealtimeSpeechState,
  AiRealtimeTurnDetectionMode,
  type AiRealtimeAudioFormat,
  type AiRealtimeEvent,
  type AppendRealtimeInputRequest,
  type AppendRealtimeInputResponse,
  type CloseRealtimeSessionRequest,
  type CloseRealtimeSessionResponse,
  type InterruptRealtimeOutputRequest,
  type InterruptRealtimeOutputResponse,
  type OpenRealtimeSessionRequest,
  type OpenRealtimeSessionResponse,
  type ReadRealtimeEventsRequest,
  type SubmitRealtimeOwnerControlRequest,
  type SubmitRealtimeOwnerControlResponse,
} from '../../core-generated/runtime-protobuf/runtime/v1/ai_realtime.js';
import type { RealtimeControlStatus } from '../../core-generated/runtime-protobuf/runtime/v1/realtime_control.js';
import {
  createNimiAiRealtimeClient,
  type NimiAiRealtimeClient,
  type NimiAiRealtimeShell,
} from './local-app-runtime-platform-realtime.js';
import { asRecord } from './local-app-runtime-platform-validation.js';
import {
  invalidRuntimeRealtimeProjection as invalid,
  projectRuntimeAck,
  projectRuntimeEnum,
  projectRuntimeReasonCode,
  projectRuntimeRealtimeControl,
} from './local-app-runtime-platform-direct-realtime-shared.js';

export type NimiAiRealtimeRuntime = {
  readonly openRealtimeSession: (request: OpenRealtimeSessionRequest) => Promise<OpenRealtimeSessionResponse>;
  readonly appendRealtimeInput: (request: AppendRealtimeInputRequest) => Promise<AppendRealtimeInputResponse>;
  readonly submitRealtimeOwnerControl: (request: SubmitRealtimeOwnerControlRequest) => Promise<SubmitRealtimeOwnerControlResponse>;
  readonly readRealtimeEvents: (request: ReadRealtimeEventsRequest, options?: { readonly signal?: AbortSignal }) => AsyncIterable<AiRealtimeEvent>;
  readonly interruptRealtimeOutput: (request: InterruptRealtimeOutputRequest) => Promise<InterruptRealtimeOutputResponse>;
  readonly closeRealtimeSession: (request: CloseRealtimeSessionRequest) => Promise<CloseRealtimeSessionResponse>;
};

// @nimi-authority: rule.nimi.sdks.feature-clients.r105
export function createNimiAiRealtimeRuntimeClient(
  runtime: NimiAiRealtimeRuntime,
): NimiAiRealtimeClient {
  const shell: NimiAiRealtimeShell = {
    open: async (input) => {
      const source = record(input, 'AI Realtime open input');
      const response = await runtime.openRealtimeSession({
        inputAudio: inputAudioFormat(source.inputAudio),
        audioOutputEnabled: boolean(source.audioOutputEnabled),
        turnDetection: turnDetection(source.turnDetection),
        initialInstruction: text(source.initialInstruction, true),
      });
      return {
        realtimeSessionId: response.realtimeSessionId,
        channelId: response.channelId,
        generation: response.generation,
        negotiatedInputAudio: outputAudioFormat(response.negotiatedInputAudio),
        negotiatedOutputAudio: response.negotiatedOutputAudio
          ? outputAudioFormat(response.negotiatedOutputAudio)
          : null,
        control: projectRuntimeRealtimeControl(response.control),
      };
    },
    appendInput: async (input) => {
      const source = record(input, 'AI Realtime append input');
      const response = await runtime.appendRealtimeInput({
        ...scope(source),
        input: runtimeInput(source.input),
      });
      return outputOperation(response.ack, response.control);
    },
    submitOwnerControl: async (input) => {
      const source = record(input, 'AI Realtime owner control input');
      const response = await runtime.submitRealtimeOwnerControl({
        ...scope(source),
        requestId: text(source.requestId),
        control: ownerControl(source.control),
      });
      return outputOperation(response.ack, response.control);
    },
    subscribe: async (input) => {
      const source = record(input, 'AI Realtime subscription input');
      const controller = new AbortController();
      const events = runtime.readRealtimeEvents(scope(source), { signal: controller.signal });
      return {
        events: (async function* () {
          for await (const event of events) yield outputEvent(event);
        })(),
        cancel: async () => controller.abort(),
      };
    },
    interruptOutput: async (input) => {
      const source = record(input, 'AI Realtime interrupt input');
      const response = await runtime.interruptRealtimeOutput({
        ...scope(source),
        outputTrackId: text(source.outputTrackId),
      });
      return outputOperation(response.ack, response.control);
    },
    close: async (input) => {
      const response = await runtime.closeRealtimeSession(scope(record(input, 'AI Realtime close input')));
      return outputOperation(response.ack, response.control);
    },
  };
  return createNimiAiRealtimeClient(shell);
}

function runtimeInput(value: unknown): AppendRealtimeInputRequest['input'] {
  const source = record(value, 'AI Realtime input');
  if (source.type === 'text') {
    return { oneofKind: 'text', text: { requestId: text(source.requestId), text: text(source.text) } };
  }
  if (source.type === 'audio-frame') {
    return {
      oneofKind: 'audioFrame',
      audioFrame: {
        inputTrackId: text(source.inputTrackId),
        utteranceId: text(source.utteranceId),
        frameSequence: decimal(source.frameSequence),
        frame: bytes(source.frame),
      },
    };
  }
  if (source.type === 'owner-context') {
    return {
      oneofKind: 'ownerContext',
      ownerContext: {
        requestId: text(source.requestId),
        kind: ownerContextKind(source.kind),
        text: text(source.text),
      },
    };
  }
  return invalid('AI Realtime input kind');
}

function outputOperation(ack: Ack | undefined, control: RealtimeControlStatus | undefined) {
  return { ack: projectRuntimeAck(ack), control: projectRuntimeRealtimeControl(control) };
}

function outputEvent(value: AiRealtimeEvent) {
  const control = projectRuntimeRealtimeControl(value.control);
  switch (value.event.oneofKind) {
    case 'opened':
      return { control, event: {
        type: 'opened',
        inputAudio: outputAudioFormat(value.event.opened.inputAudio),
        outputAudio: value.event.opened.outputAudio ? outputAudioFormat(value.event.opened.outputAudio) : null,
        turnDetection: turnDetectionName(value.event.opened.turnDetection),
      } };
    case 'inputAccepted':
      return { control, event: { type: 'input-accepted', ...value.event.inputAccepted } };
    case 'speechStatus':
      return { control, event: {
        type: 'speech-status',
        inputTrackId: value.event.speechStatus.inputTrackId,
        utteranceId: value.event.speechStatus.utteranceId,
        state: projectRuntimeEnum(value.event.speechStatus.state, {
          [AiRealtimeSpeechState.STARTED]: 'started',
          [AiRealtimeSpeechState.STOPPED]: 'stopped',
        }, 'AI Realtime speech state'),
      } };
    case 'transcript':
      return { control, event: { type: 'transcript', ...value.event.transcript } };
    case 'textOutput':
      return { control, event: { type: 'text-output', ...value.event.textOutput } };
    case 'audioFrame':
      return { control, event: {
        type: 'audio-frame',
        requestId: value.event.audioFrame.requestId,
        outputTrackId: value.event.audioFrame.outputTrackId,
        frameSequence: value.event.audioFrame.frameSequence,
        frame: Array.from(value.event.audioFrame.frame),
        format: outputAudioFormat(value.event.audioFrame.format),
      } };
    case 'outputTrack':
      return { control, event: {
        type: 'output-track',
        requestId: value.event.outputTrack.requestId,
        outputTrackId: value.event.outputTrack.outputTrackId,
        lifecycle: projectRuntimeEnum(value.event.outputTrack.lifecycle, {
          [AiRealtimeOutputTrackLifecycle.ACTIVE]: 'active',
          [AiRealtimeOutputTrackLifecycle.INTERRUPTED]: 'interrupted',
          [AiRealtimeOutputTrackLifecycle.COMPLETED]: 'completed',
          [AiRealtimeOutputTrackLifecycle.FAILED]: 'failed',
        }, 'AI Realtime output lifecycle'),
        reasonCode: projectRuntimeReasonCode(value.event.outputTrack.reasonCode),
      } };
    case 'requestTerminal':
      return { control, event: {
        type: 'request-terminal',
        requestId: value.event.requestTerminal.requestId,
        finishReason: finishReason(value.event.requestTerminal.finishReason),
        usage: usage(value.event.requestTerminal.usage),
        reasonCode: projectRuntimeReasonCode(value.event.requestTerminal.reasonCode),
      } };
    case 'sessionTerminal':
      return { control, event: {
        type: 'session-terminal',
        reasonCode: projectRuntimeReasonCode(value.event.sessionTerminal.reasonCode),
      } };
    case 'failure':
      return { control, event: {
        type: 'failure',
        requestId: value.event.failure.requestId,
        outputTrackId: value.event.failure.outputTrackId,
        reasonCode: projectRuntimeReasonCode(value.event.failure.reasonCode),
      } };
    default:
      return invalid('AI Realtime event kind');
  }
}

function scope(source: Record<string, unknown>): ReadRealtimeEventsRequest {
  return { realtimeSessionId: text(source.realtimeSessionId), generation: decimal(source.generation) };
}

function inputAudioFormat(value: unknown): AiRealtimeAudioFormat {
  const source = record(value, 'AI Realtime audio format');
  if (source.codec !== 'pcm-s16le') return invalid('AI Realtime audio codec');
  return {
    codec: AiRealtimeAudioCodec.PCM_S16LE,
    sampleRateHz: integer(source.sampleRateHz),
    channelCount: integer(source.channelCount),
    frameDurationMs: integer(source.frameDurationMs),
    maximumFrameBytes: integer(source.maximumFrameBytes),
  };
}

function outputAudioFormat(value: AiRealtimeAudioFormat | undefined) {
  if (!value || value.codec !== AiRealtimeAudioCodec.PCM_S16LE) return invalid('AI Realtime audio format');
  return {
    codec: 'pcm-s16le',
    sampleRateHz: value.sampleRateHz,
    channelCount: value.channelCount,
    frameDurationMs: value.frameDurationMs,
    maximumFrameBytes: value.maximumFrameBytes,
  };
}

function turnDetection(value: unknown): AiRealtimeTurnDetectionMode {
  if (value === 'server-vad') return AiRealtimeTurnDetectionMode.SERVER_VAD;
  if (value === 'manual') return AiRealtimeTurnDetectionMode.MANUAL;
  return invalid('AI Realtime turn detection');
}

function turnDetectionName(value: AiRealtimeTurnDetectionMode): 'server-vad' | 'manual' {
  if (value === AiRealtimeTurnDetectionMode.SERVER_VAD) return 'server-vad';
  if (value === AiRealtimeTurnDetectionMode.MANUAL) return 'manual';
  return invalid('AI Realtime turn detection');
}

function ownerContextKind(value: unknown): AiRealtimeOwnerContextKind {
  if (value === 'instruction') return AiRealtimeOwnerContextKind.INSTRUCTION;
  if (value === 'context') return AiRealtimeOwnerContextKind.CONTEXT;
  if (value === 'sanitized-result') return AiRealtimeOwnerContextKind.SANITIZED_RESULT;
  return invalid('AI Realtime owner context kind');
}

function ownerControl(value: unknown): AiRealtimeOwnerControlKind {
  if (value === 'commit-input') return AiRealtimeOwnerControlKind.COMMIT_INPUT;
  if (value === 'start-response') return AiRealtimeOwnerControlKind.START_RESPONSE;
  if (value === 'continue-response') return AiRealtimeOwnerControlKind.CONTINUE_RESPONSE;
  if (value === 'pause-response') return AiRealtimeOwnerControlKind.PAUSE_RESPONSE;
  if (value === 'cancel-response') return AiRealtimeOwnerControlKind.CANCEL_RESPONSE;
  return invalid('AI Realtime owner control');
}

function finishReason(value: FinishReason) {
  return projectRuntimeEnum(value, {
    [FinishReason.UNSPECIFIED]: 'unspecified',
    [FinishReason.STOP]: 'stop',
    [FinishReason.LENGTH]: 'length',
    [FinishReason.TOOL_CALL]: 'tool-call',
    [FinishReason.CONTENT_FILTER]: 'content-filter',
    [FinishReason.ERROR]: 'error',
  }, 'AI Realtime finish reason');
}

function usage(value: UsageStats | undefined) {
  return value ? {
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    computeMs: value.computeMs,
    cachedInputTokens: value.cachedInputTokens,
    reasoningOutputTokens: value.reasoningOutputTokens,
  } : null;
}

function record(value: unknown, label: string): Record<string, unknown> {
  return asRecord(value) ?? invalid(label);
}

function text(value: unknown, empty = false): string {
  return typeof value === 'string' && (empty || value.length > 0)
    ? value
    : invalid('AI Realtime text');
}

function decimal(value: unknown): string {
  return typeof value === 'string' && /^[1-9][0-9]*$/u.test(value)
    ? value
    : invalid('AI Realtime decimal');
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : invalid('AI Realtime integer');
}

function boolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid('AI Realtime boolean');
}

function bytes(value: unknown): Uint8Array {
  return Array.isArray(value) && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)
    ? Uint8Array.from(value)
    : invalid('AI Realtime bytes');
}
