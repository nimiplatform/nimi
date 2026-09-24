import type { BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import type { StudioParameterValue } from './parameters.js';
import type { NimiLocalAppAudioInstrumentPartKind, NimiLocalAppVisionLocateResult, NimiLocalAppMusicGeneration, NimiLocalAppMusicTranscription, NimiLocalAppTextAnnotationResult, NimiLocalAppVideoFaceSwapSummary, NimiLocalAppVoiceConversion } from '@nimiplatform/sdk/app';
import type { NimiRuntimeScenarioJob } from '@nimiplatform/sdk/runtime';

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

export type StudioMusicGeneration = Pick<NimiLocalAppMusicGeneration, 'termination' | 'actualSeed' | 'audioInfo'> & {
  readonly mixRelativePath: string;
  readonly generatedScore?: {
    readonly relativePath: string;
    readonly format: 'abc' | 'midi';
    readonly origin: 'generated-plan' | 'transcribed-estimate';
    readonly truncated: boolean;
  };
};

export type StudioMusicTranscription = Pick<NimiLocalAppMusicTranscription, 'sourceInfo' | 'inputRange' | 'completeness' | 'origin'> & {
  readonly sourceAudio: StudioManagedArtifact;
  readonly scores: readonly { readonly relativePath: string; readonly format: 'abc' | 'midi'; readonly part: string }[];
  readonly timelineRelativePath?: string;
};

export type StudioVoiceConversion = Pick<NimiLocalAppVoiceConversion, 'sourceInfo' | 'inputRange' | 'vocalInfo' | 'lengthRelation' | 'durationDeltaMs'> & {
  readonly sourceVocal: StudioManagedArtifact;
  readonly targetVoice?: StudioManagedArtifact;
  readonly vocal: StudioManagedArtifact;
};

export type StudioAudioSeparationInstrumentPart = {
  readonly kind: NimiLocalAppAudioInstrumentPartKind;
  readonly artifact: StudioManagedArtifact;
};

export type StudioAudioSeparation = {
  readonly sourceAudio: StudioManagedArtifact;
  readonly vocals: StudioManagedArtifact;
  readonly background: StudioManagedArtifact;
  readonly instrumentParts?: readonly StudioAudioSeparationInstrumentPart[];
};

// Input facts recorded per role. The bytes themselves are never retained, so a
// rerun requires choosing the media again.
export type StudioFaceSwapInputRole = 'reference-image' | 'target-image' | 'target-video';

export type StudioFaceSwapInput = {
  readonly role: StudioFaceSwapInputRole;
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
};

export type StudioFaceSwap = {
  readonly inputs: readonly StudioFaceSwapInput[];
  readonly noFacePolicy?: 'fail' | 'preserve-frame';
  readonly video?: NimiLocalAppVideoFaceSwapSummary;
};

export type StudioJsonValue = null | boolean | number | string | readonly StudioJsonValue[] | { readonly [key: string]: StudioJsonValue };

// One ordered text model step, or the tool results the App returned for it.
export type StudioTextExchangeItem =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning-continuity'; readonly carrierKind: string; readonly version: number; readonly payloadBytes: number }
  | { readonly type: 'tool-call'; readonly toolCallId: string; readonly toolName: string; readonly arguments: StudioJsonValue }
  | { readonly type: 'tool-result'; readonly toolCallId: string; readonly toolName: string; readonly result: StudioJsonValue; readonly isError: boolean };

export type StudioTextExchangeStep = {
  readonly origin: 'model' | 'app';
  readonly finishReason?: string;
  readonly traceId?: string;
  readonly items: readonly StudioTextExchangeItem[];
};

// One answer per submitted question, in submitted order. A choice keeps the
// selected candidate and the probability of every submitted candidate in
// submitted order; a yes/no question keeps only the probability that its true
// criterion holds.
export type StudioTextDecisionProbability = {
  readonly candidateId: string;
  readonly probability: number;
};

export type StudioTextDecisionAnswer =
  | { readonly questionId: string; readonly kind: 'choice'; readonly selectedCandidateId: string; readonly probabilities: readonly StudioTextDecisionProbability[] }
  | { readonly questionId: string; readonly kind: 'boolean'; readonly trueProbability: number };

export type StudioSessionSummary = {
  readonly capabilityContract: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly ending: 'closed' | 'terminated';
  readonly terminalReason: string;
  readonly observed: Readonly<Record<string, number>>;
};

export type StudioTypedOutput =
  | { readonly kind: 'vision-locate'; readonly jobId: string; readonly result: NimiLocalAppVisionLocateResult; readonly imagePreviewUrl?: string }
  | { readonly kind: 'text'; readonly text: string; readonly finishReason: string; readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number; readonly streamed: boolean }
  // spaceId is absent only on records saved before the result retained it.
  | { readonly kind: 'embedding'; readonly vectorCount: number; readonly dimensions: number; readonly spaceId?: string; readonly sample: number[]; readonly totalTokens?: number }
  | { readonly kind: 'artifacts'; readonly musicGeneration?: StudioMusicGeneration; readonly musicTranscription?: StudioMusicTranscription; readonly voiceConversion?: StudioVoiceConversion; readonly audioSeparation?: StudioAudioSeparation; readonly faceSwap?: StudioFaceSwap; readonly jobId: string; readonly jobState: string; readonly artifactCount: number; readonly artifacts: StudioManagedArtifact[]; readonly firstArtifact?: StudioManagedArtifact }
  // The complete annotation lives in the saved document; it is attached only
  // after the current run or a verified read of that document.
  | { readonly kind: 'text-annotation'; readonly jobId: string; readonly jobState: string; readonly language: string; readonly documentCount: number; readonly tokenCount: number; readonly sentenceCount: number; readonly document: StudioManagedArtifact; readonly annotation?: NimiLocalAppTextAnnotationResult }
  | { readonly kind: 'text-exchange'; readonly scenario: 'tool-call' | 'structured-output'; readonly steps: readonly StudioTextExchangeStep[]; readonly text: string; readonly structured?: StudioJsonValue }
  | { readonly kind: 'text-decision'; readonly answers: readonly StudioTextDecisionAnswer[] }
  | ({ readonly kind: 'session' } & StudioSessionSummary)
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
  // Present only when the owner had already issued the Job before it ended.
  readonly jobId?: string;
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
  readonly onJobUpdate?: (job: NimiRuntimeScenarioJob) => void;
  readonly attachments?: BrowserDataUrlAttachment[];
  readonly directive?: string;
  readonly parameters?: StudioParameterValue;
};
