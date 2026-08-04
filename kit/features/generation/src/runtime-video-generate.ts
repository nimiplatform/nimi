import type {
  NimiError,
  NimiRuntimeScenarioJobClient,
  NimiRuntimeVideoContentPart,
  NimiRuntimeVideoGenerationOptions,
  RuntimeTypedCallOptions,
  ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';
import { runtimeExecutionUnavailable } from './runtime-diagnostics.js';

export type RuntimeVideoGenerateUnavailableReason =
  | 'input-invalid'
  | 'runtime-call-failed'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable';

export type RuntimeVideoGenerateArtifactSummary = {
  readonly artifactId?: string;
  readonly mimeType: string;
  readonly uri?: string;
  readonly previewUrl?: string;
  readonly previewSource: 'hosted-uri' | 'inline-bytes' | 'metadata-only';
  readonly sizeBytes?: number;
  readonly width?: number;
  readonly height?: number;
};

export type RuntimeVideoGenerateOutput = {
  readonly kind: 'video-artifacts';
  readonly jobId: string;
  readonly jobStatus: string;
  readonly artifactCount: number;
  readonly firstArtifact?: RuntimeVideoGenerateArtifactSummary;
  readonly artifacts: readonly RuntimeVideoGenerateArtifactSummary[];
};

export type RuntimeVideoGenerateSuccess = {
  readonly ok: true;
  readonly capabilityId: 'video.generate';
  readonly message: string;
  readonly output: RuntimeVideoGenerateOutput;
  readonly trace?: {
    readonly traceId?: string;
    readonly modelResolved?: string;
    readonly routeDecision?: string;
  };
};

export type RuntimeVideoGenerateUnavailable = {
  readonly ok: false;
  readonly capabilityId: 'video.generate';
  readonly reason: RuntimeVideoGenerateUnavailableReason;
  readonly message: string;
  readonly error: NimiError;
};

export type RuntimeVideoGenerateResult = RuntimeVideoGenerateSuccess | RuntimeVideoGenerateUnavailable;

export type RuntimeVideoGenerateRuntime = {
  readonly ai: NimiRuntimeScenarioJobClient;
};

export type RuntimeVideoGenerateInput = {
  readonly runtime: RuntimeVideoGenerateRuntime;
  readonly appId: string;
  readonly mode: 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference';
  readonly prompt?: string;
  readonly negativePrompt?: string;
  readonly content?: readonly NimiRuntimeVideoContentPart[];
  readonly options?: NimiRuntimeVideoGenerationOptions;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
};

/** Fail closed until Runtime admits owner-driven video jobs without a target-bearing head. */
export async function runRuntimeVideoGenerate(
  _input: RuntimeVideoGenerateInput,
): Promise<RuntimeVideoGenerateResult> {
  return {
    ok: false,
    capabilityId: 'video.generate',
    ...runtimeExecutionUnavailable('video.generate'),
  };
}
