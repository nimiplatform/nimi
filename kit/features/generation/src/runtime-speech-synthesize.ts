import type {
  NimiError,
  NimiRuntimeScenarioJobClient,
  NimiRuntimeSpeechVoiceReference,
  RuntimeTypedCallOptions,
  ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';
import { runtimeExecutionUnavailable } from './runtime-diagnostics.js';

export type RuntimeSpeechSynthesizeUnavailableReason =
  | 'input-invalid'
  | 'runtime-call-failed'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable';

export type RuntimeSpeechSynthesizeArtifactSummary = {
  readonly artifactId?: string;
  readonly mimeType: string;
  readonly uri?: string;
  readonly previewUrl?: string;
  readonly previewSource: 'hosted-uri' | 'inline-bytes' | 'metadata-only';
  readonly sizeBytes?: number;
};

export type RuntimeSpeechSynthesizeTrace = {
  readonly traceId?: string;
  readonly modelResolved?: string;
  readonly routeDecision?: string;
};

export type RuntimeSpeechSynthesizeOutput = {
  readonly kind: 'audio-artifacts';
  readonly jobId: string;
  readonly jobStatus: string;
  readonly artifactCount: number;
  readonly firstArtifact?: RuntimeSpeechSynthesizeArtifactSummary;
  readonly artifacts: readonly RuntimeSpeechSynthesizeArtifactSummary[];
};

export type RuntimeSpeechSynthesizeSuccess = {
  readonly ok: true;
  readonly capabilityId: 'audio.synthesize';
  readonly message: string;
  readonly output: RuntimeSpeechSynthesizeOutput;
  readonly trace?: RuntimeSpeechSynthesizeTrace;
};

export type RuntimeSpeechSynthesizeUnavailable = {
  readonly ok: false;
  readonly capabilityId: 'audio.synthesize';
  readonly reason: RuntimeSpeechSynthesizeUnavailableReason;
  readonly message: string;
  readonly error: NimiError;
};

export type RuntimeSpeechSynthesizeResult =
  | RuntimeSpeechSynthesizeSuccess
  | RuntimeSpeechSynthesizeUnavailable;

export type RuntimeSpeechSynthesizeRuntime = {
  readonly ai: NimiRuntimeScenarioJobClient;
};

export type RuntimeSpeechSynthesizeInput = {
  readonly runtime: RuntimeSpeechSynthesizeRuntime;
  readonly appId: string;
  readonly text: string;
  readonly voiceRef?: NimiRuntimeSpeechVoiceReference;
  readonly language?: string;
  readonly audioFormat?: string;
  readonly sampleRateHz?: number;
  readonly speed?: number;
  readonly pitch?: number;
  readonly volume?: number;
  readonly emotion?: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
};

/** Fail closed until Runtime admits owner-driven synthesis jobs without a target-bearing head. */
export async function runRuntimeSpeechSynthesize(
  _input: RuntimeSpeechSynthesizeInput,
): Promise<RuntimeSpeechSynthesizeResult> {
  return {
    ok: false,
    capabilityId: 'audio.synthesize',
    ...runtimeExecutionUnavailable('audio.synthesize'),
  };
}
