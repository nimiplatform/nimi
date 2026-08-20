import type { BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import type { StudioParameterValue } from './parameters.js';

export type StudioRuntimeCapabilityDescriptor = {
  readonly id: string;
  readonly label: string;
  readonly missingSurface?: string;
};

export type StudioTrace = {
  readonly traceId?: string;
};

export type StudioManagedArtifact = {
  readonly relativePath: string;
  readonly mediaType?: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly displayName?: string;
  readonly previewSource: 'managed-asset';
};

export type StudioTypedOutput =
  | { readonly kind: 'text'; readonly text: string; readonly finishReason: string; readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number; readonly streamed: boolean }
  | { readonly kind: 'embedding'; readonly vectorCount: number; readonly dimensions: number; readonly sample: number[]; readonly totalTokens?: number }
  | { readonly kind: 'artifacts'; readonly jobId: string; readonly jobState: string; readonly artifactCount: number; readonly artifacts: StudioManagedArtifact[]; readonly firstArtifact?: StudioManagedArtifact }
  | { readonly kind: 'transcript'; readonly text: string; readonly jobId: string; readonly jobState: string; readonly artifactCount: number }
  | { readonly kind: 'voice-asset'; readonly jobId: string; readonly jobState: string; readonly voiceAssetId: string; readonly creationSource: 'reference-audio' | 'text-description'; readonly assetStatus: string; readonly voiceReference: { readonly kind: 'voice_asset_id'; readonly voiceAssetId: string } }
  | { readonly kind: 'voice-catalog'; readonly voiceCount: number; readonly sample: Array<{ readonly voiceId: string; readonly creationSource: string; readonly status: string }> };

export type StudioTypedSuccess = {
  readonly ok: true;
  readonly capabilityId: string;
  readonly capabilityLabel: string;
  readonly message: string;
  readonly output: StudioTypedOutput;
  readonly trace?: StudioTrace;
};

export type StudioNonSuccessReason =
  | 'runtime-unavailable'
  | 'input-invalid'
  | 'sdk-method-unavailable'
  | 'principal-unauthorized'
  | 'operation-aborted'
  | 'runtime-canceled'
  | 'runtime-timeout'
  | 'stream-interrupted'
  | 'runtime-call-failed';

export type StudioNonSuccessDiagnostics = {
  readonly reasonCode: string;
  readonly actionHint?: string;
  readonly traceId?: string;
  readonly retryable?: boolean;
  readonly source?: string;
};

export type StudioNonSuccess = {
  readonly ok: false;
  readonly capabilityId: string;
  readonly reason: StudioNonSuccessReason;
  readonly message: string;
  readonly actionHint: string;
  readonly missingSurface?: string;
  readonly diagnostics?: StudioNonSuccessDiagnostics;
};

export type StudioCapabilityRunResult = StudioTypedSuccess | StudioNonSuccess;

export type StudioRuntimeInspection = {
  readonly status: 'connected' | 'unavailable';
  readonly mode: string;
  readonly detail: string;
};

export type StudioCapabilityRunInput = {
  readonly capabilityId: string;
  readonly prompt: string;
  readonly scenarioId?: string;
  readonly signal?: AbortSignal;
  readonly onPartial?: (accumulatedText: string) => void;
  readonly attachments?: BrowserDataUrlAttachment[];
  readonly directive?: string;
  readonly parameters?: StudioParameterValue;
};
