import type {
  AppendLocalAppAgentRealtimeInputRequest,
  AppendLocalAppAgentRealtimeInputResponse,
  CloseLocalAppAgentRealtimeRequest,
  CloseLocalAppAgentRealtimeResponse,
  GetLocalAppAgentRealtimeStatusRequest,
  GetLocalAppAgentRealtimeStatusResponse,
  InterruptLocalAppAgentRealtimeOutputRequest,
  InterruptLocalAppAgentRealtimeOutputResponse,
  LocalAppAgentRealtimeEvent,
  OpenLocalAppAgentRealtimeRequest,
  OpenLocalAppAgentRealtimeResponse,
  SubscribeLocalAppAgentRealtimeEventsRequest,
} from '../../core-generated/runtime-protobuf/runtime/v1/agent_service.js';
import {
  AiRealtimeAudioCodec,
  AiRealtimeOutputTrackLifecycle,
  AiRealtimeSpeechState,
  AiRealtimeTurnDetectionMode,
  type AiRealtimeAudioFormat,
} from '../../core-generated/runtime-protobuf/runtime/v1/ai_realtime.js';
import type { Ack } from '../../core-generated/runtime-protobuf/runtime/v1/common.js';
import type { RealtimeControlStatus } from '../../core-generated/runtime-protobuf/runtime/v1/realtime_control.js';
import {
  createNimiAgentRealtimeClient,
  type NimiAgentRealtimeClient,
  type NimiAgentRealtimeShell,
} from './local-app-runtime-platform-realtime.js';
import { asRecord } from './local-app-runtime-platform-validation.js';
import {
  invalidRuntimeRealtimeProjection as invalid,
  projectRuntimeAck,
  projectRuntimeEnum,
  projectRuntimeReasonCode,
  projectRuntimeRealtimeControl,
} from './local-app-runtime-platform-direct-realtime-shared.js';

export type NimiAgentRealtimeRuntime = {
  readonly openLocalAppAgentRealtime: (request: OpenLocalAppAgentRealtimeRequest) => Promise<OpenLocalAppAgentRealtimeResponse>;
  readonly appendLocalAppAgentRealtimeInput: (request: AppendLocalAppAgentRealtimeInputRequest) => Promise<AppendLocalAppAgentRealtimeInputResponse>;
  readonly subscribeLocalAppAgentRealtimeEvents: (request: SubscribeLocalAppAgentRealtimeEventsRequest, options?: { readonly signal?: AbortSignal }) => AsyncIterable<LocalAppAgentRealtimeEvent>;
  readonly getLocalAppAgentRealtimeStatus: (request: GetLocalAppAgentRealtimeStatusRequest) => Promise<GetLocalAppAgentRealtimeStatusResponse>;
  readonly interruptLocalAppAgentRealtimeOutput: (request: InterruptLocalAppAgentRealtimeOutputRequest) => Promise<InterruptLocalAppAgentRealtimeOutputResponse>;
  readonly closeLocalAppAgentRealtime: (request: CloseLocalAppAgentRealtimeRequest) => Promise<CloseLocalAppAgentRealtimeResponse>;
};

// @nimi-authority: rule.nimi.sdks.feature-clients.r105
// @nimi-authority: rule.nimi.runtime.agent-participation.r185
export function createNimiAgentRealtimeRuntimeClient(
  runtime: NimiAgentRealtimeRuntime,
): NimiAgentRealtimeClient {
  const shell: NimiAgentRealtimeShell = {
    open: async (input) => {
      const source = record(input, 'Agent Realtime open input');
      const response = await runtime.openLocalAppAgentRealtime({
        agentHandle: text(source.agentHandle),
        ...(typeof source.conversationAnchorId === 'string'
          ? { conversationAnchorId: text(source.conversationAnchorId) }
          : {}),
        inputAudio: inputAudioFormat(source.inputAudio),
        turnDetection: turnDetection(source.turnDetection),
      });
      return {
        conversationAnchorId: response.conversationAnchorId,
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
      const source = record(input, 'Agent Realtime append input');
      const response = await runtime.appendLocalAppAgentRealtimeInput({
        ...scope(source),
        input: runtimeInput(source.input),
      });
      return outputOperation(response.ack, response.control);
    },
    subscribe: async (input) => {
      const source = record(input, 'Agent Realtime subscription input');
      const controller = new AbortController();
      const events = runtime.subscribeLocalAppAgentRealtimeEvents(scope(source), {
        signal: controller.signal,
      });
      return {
        events: (async function* () {
          for await (const event of events) yield outputEvent(event);
        })(),
        cancel: async () => controller.abort(),
      };
    },
    status: async (input) => {
      const response = await runtime.getLocalAppAgentRealtimeStatus(scope(record(input, 'Agent Realtime status input')));
      return { control: projectRuntimeRealtimeControl(response.control) };
    },
    interruptOutput: async (input) => {
      const source = record(input, 'Agent Realtime interrupt input');
      const response = await runtime.interruptLocalAppAgentRealtimeOutput({
        ...scope(source),
        outputTrackId: text(source.outputTrackId),
        interruptAgentTurn: boolean(source.interruptAgentTurn),
      });
      return outputOperation(response.ack, response.control);
    },
    close: async (input) => {
      const response = await runtime.closeLocalAppAgentRealtime(scope(record(input, 'Agent Realtime close input')));
      return outputOperation(response.ack, response.control);
    },
  };
  return createNimiAgentRealtimeClient(shell);
}

function scope(source: Record<string, unknown>): GetLocalAppAgentRealtimeStatusRequest {
  return {
    realtimeSessionId: text(source.realtimeSessionId),
    generation: decimal(source.generation),
    agentHandle: text(source.agentHandle),
  };
}

function runtimeInput(value: unknown): AppendLocalAppAgentRealtimeInputRequest['input'] {
  const source = record(value, 'Agent Realtime input');
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
  if (source.type === 'capture-stopped') {
    return {
      oneofKind: 'captureStopped',
      captureStopped: {
        inputTrackId: text(source.inputTrackId),
        utteranceId: text(source.utteranceId),
      },
    };
  }
  return invalid('Agent Realtime input kind');
}

function outputOperation(ack: Ack | undefined, control: RealtimeControlStatus | undefined) {
  return { ack: projectRuntimeAck(ack), control: projectRuntimeRealtimeControl(control) };
}

function outputEvent(value: LocalAppAgentRealtimeEvent) {
  const control = projectRuntimeRealtimeControl(value.control);
  switch (value.event.oneofKind) {
    case 'inputAccepted': return { control, event: { type: 'input-accepted', ...value.event.inputAccepted } };
    case 'speechStatus': return { control, event: {
      type: 'speech-status', inputTrackId: value.event.speechStatus.inputTrackId,
      utteranceId: value.event.speechStatus.utteranceId,
      state: projectRuntimeEnum(value.event.speechStatus.state, {
        [AiRealtimeSpeechState.STARTED]: 'started',
        [AiRealtimeSpeechState.STOPPED]: 'stopped',
      }, 'Agent Realtime speech state'),
    } };
    case 'transcript': return { control, event: { type: 'transcript', ...value.event.transcript } };
    case 'textOutput': return { control, event: { type: 'text-output', ...value.event.textOutput } };
    case 'audioFrame': return { control, event: {
      type: 'audio-frame', requestId: value.event.audioFrame.requestId,
      outputTrackId: value.event.audioFrame.outputTrackId,
      frameSequence: value.event.audioFrame.frameSequence,
      frame: Array.from(value.event.audioFrame.frame),
      format: outputAudioFormat(value.event.audioFrame.format),
    } };
    case 'outputTrack': return { control, event: {
      type: 'output-track', requestId: value.event.outputTrack.requestId,
      outputTrackId: value.event.outputTrack.outputTrackId,
      lifecycle: projectRuntimeEnum(value.event.outputTrack.lifecycle, {
        [AiRealtimeOutputTrackLifecycle.ACTIVE]: 'active',
        [AiRealtimeOutputTrackLifecycle.INTERRUPTED]: 'interrupted',
        [AiRealtimeOutputTrackLifecycle.COMPLETED]: 'completed',
        [AiRealtimeOutputTrackLifecycle.FAILED]: 'failed',
      }, 'Agent Realtime output track lifecycle'),
      reasonCode: projectRuntimeReasonCode(value.event.outputTrack.reasonCode),
    } };
    case 'terminal': return { control, event: {
      type: 'terminal', reasonCode: projectRuntimeReasonCode(value.event.terminal.reasonCode),
    } };
    default: return invalid('Agent Realtime event kind');
  }
}

function inputAudioFormat(value: unknown): AiRealtimeAudioFormat {
  const source = record(value, 'Agent Realtime audio format');
  if (source.codec !== 'pcm-s16le') return invalid('Agent Realtime audio codec');
  return {
    codec: AiRealtimeAudioCodec.PCM_S16LE,
    sampleRateHz: integer(source.sampleRateHz),
    channelCount: integer(source.channelCount),
    frameDurationMs: integer(source.frameDurationMs),
    maximumFrameBytes: integer(source.maximumFrameBytes),
  };
}

function outputAudioFormat(value: AiRealtimeAudioFormat | undefined) {
  if (!value || value.codec !== AiRealtimeAudioCodec.PCM_S16LE) return invalid('Agent Realtime audio format');
  return {
    codec: 'pcm-s16le', sampleRateHz: value.sampleRateHz, channelCount: value.channelCount,
    frameDurationMs: value.frameDurationMs, maximumFrameBytes: value.maximumFrameBytes,
  };
}

function turnDetection(value: unknown): AiRealtimeTurnDetectionMode {
  if (value === 'server-vad') return AiRealtimeTurnDetectionMode.SERVER_VAD;
  if (value === 'manual') return AiRealtimeTurnDetectionMode.MANUAL;
  return invalid('Agent Realtime turn detection');
}

function record(value: unknown, label: string): Record<string, unknown> {
  return asRecord(value) ?? invalid(label);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : invalid('Realtime text');
}

function decimal(value: unknown): string {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/u.test(value)
    ? value
    : invalid('Realtime decimal');
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : invalid('Realtime integer');
}

function boolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid('Realtime boolean');
}

function bytes(value: unknown): Uint8Array {
  return Array.isArray(value) && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)
    ? Uint8Array.from(value)
    : invalid('Realtime bytes');
}
