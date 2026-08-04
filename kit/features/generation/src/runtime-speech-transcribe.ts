import type {
  NimiError,
  NimiRuntimeScenarioJobClient,
  RuntimeTypedCallOptions,
  ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';
import { runtimeExecutionUnavailable } from './runtime-diagnostics.js';

export type RuntimeSpeechTranscribeUnavailableReason =
  | 'input-invalid'
  | 'runtime-call-failed'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable';

export type RuntimeSpeechTranscribeAudioInput =
  | { readonly type: 'bytes'; readonly bytes: Uint8Array; readonly mimeType: string }
  | { readonly type: 'url'; readonly url: string; readonly mimeType?: string }
  | { readonly type: 'chunks'; readonly chunks: readonly Uint8Array[]; readonly mimeType: string };

export type RuntimeSpeechTranscribeOutput = {
  readonly kind: 'transcript';
  readonly text: string;
  readonly jobId: string;
  readonly jobStatus: string;
  readonly artifactCount: number;
};

export type RuntimeSpeechTranscribeSuccess = {
  readonly ok: true;
  readonly capabilityId: 'audio.transcribe';
  readonly message: string;
  readonly output: RuntimeSpeechTranscribeOutput;
  readonly trace?: {
    readonly traceId?: string;
    readonly modelResolved?: string;
    readonly routeDecision?: string;
  };
};

export type RuntimeSpeechTranscribeUnavailable = {
  readonly ok: false;
  readonly capabilityId: 'audio.transcribe';
  readonly reason: RuntimeSpeechTranscribeUnavailableReason;
  readonly message: string;
  readonly error: NimiError;
};

export type RuntimeSpeechTranscribeResult =
  | RuntimeSpeechTranscribeSuccess
  | RuntimeSpeechTranscribeUnavailable;

export type RuntimeSpeechTranscribeRuntime = {
  readonly ai: NimiRuntimeScenarioJobClient;
};

export type RuntimeSpeechTranscribeInput = {
  readonly runtime: RuntimeSpeechTranscribeRuntime;
  readonly appId: string;
  readonly audio?: RuntimeSpeechTranscribeAudioInput;
  readonly audioUrl?: string;
  readonly language?: string;
  readonly timestamps?: boolean;
  readonly diarization?: boolean;
  readonly speakerCount?: number;
  readonly prompt?: string;
  readonly responseFormat?: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
};

/** Fail closed before loading caller media or dispatching a target-bearing Runtime job. */
export async function runRuntimeSpeechTranscribe(
  _input: RuntimeSpeechTranscribeInput,
): Promise<RuntimeSpeechTranscribeResult> {
  return {
    ok: false,
    capabilityId: 'audio.transcribe',
    ...runtimeExecutionUnavailable('audio.transcribe'),
  };
}
