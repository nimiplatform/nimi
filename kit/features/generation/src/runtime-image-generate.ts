import type {
  NimiError,
  NimiRuntimeScenarioJobClient,
  ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';
import { runtimeExecutionUnavailable } from './runtime-diagnostics.js';

export type RuntimeImageGenerateUnavailableReason =
  | 'input-invalid'
  | 'runtime-call-failed'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable';

export type RuntimeImageGenerateArtifactPreviewSource =
  | 'hosted-uri'
  | 'inline-bytes'
  | 'runtime-artifact-read'
  | 'metadata-only';

export type RuntimeImageGenerateArtifactSummary = {
  readonly artifactId?: string;
  readonly mimeType: string;
  readonly uri?: string;
  readonly previewUrl?: string;
  readonly previewSource: RuntimeImageGenerateArtifactPreviewSource;
  readonly sizeBytes?: number;
  readonly width?: number;
  readonly height?: number;
};

export type RuntimeImageGenerateTrace = {
  readonly traceId?: string;
  readonly modelResolved?: string;
  readonly routeDecision?: string;
};

export type RuntimeImageGenerateOutput = {
  readonly kind: 'image-artifacts';
  readonly jobId: string;
  readonly jobStatus: string;
  readonly artifactCount: number;
  readonly firstArtifact?: RuntimeImageGenerateArtifactSummary;
  readonly artifacts: readonly RuntimeImageGenerateArtifactSummary[];
};

export type RuntimeImageGenerateSuccess = {
  readonly ok: true;
  readonly capabilityId: 'image.generate';
  readonly message: string;
  readonly output: RuntimeImageGenerateOutput;
  readonly trace?: RuntimeImageGenerateTrace;
};

export type RuntimeImageGenerateUnavailable = {
  readonly ok: false;
  readonly capabilityId: 'image.generate';
  readonly reason: RuntimeImageGenerateUnavailableReason;
  readonly message: string;
  readonly error: NimiError;
};

export type RuntimeImageGenerateResult = RuntimeImageGenerateSuccess | RuntimeImageGenerateUnavailable;

export type RuntimeImageGenerateRuntime = {
  readonly ai: NimiRuntimeScenarioJobClient;
};

export type RuntimeImageGenerateInput = {
  readonly runtime: RuntimeImageGenerateRuntime;
  readonly appId: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly count?: number;
  readonly size?: string;
  readonly aspectRatio?: string;
  readonly quality?: string;
  readonly style?: string;
  readonly seed?: string | number | bigint;
  readonly referenceImages?: readonly string[];
  readonly mask?: string;
  readonly responseFormat?: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly metadata?: Readonly<Record<string, string | undefined>>;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
};

/** Fail closed until Runtime admits owner-driven image jobs without a target-bearing head. */
export async function runRuntimeImageGenerate(
  _input: RuntimeImageGenerateInput,
): Promise<RuntimeImageGenerateResult> {
  return {
    ok: false,
    capabilityId: 'image.generate',
    ...runtimeExecutionUnavailable('image.generate'),
  };
}
