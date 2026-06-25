import type { NimiRuntimeSpeechVoiceReference } from '@nimiplatform/kit/core/sdk-contract';
import type { ModelConfigTargetRef } from '@nimiplatform/kit/core/model-config';
import type { RouteModelPickerDataProvider } from '@nimiplatform/kit/features/model-picker';
import type { ReactNode } from 'react';

export type { ModelConfigTargetRef } from '@nimiplatform/kit/core/model-config';

export type ModelConfigCapabilityStatusTone = 'ready' | 'attention' | 'neutral';

export type ModelConfigCapabilityStatus = {
  supported: boolean;
  tone?: ModelConfigCapabilityStatusTone;
  badgeLabel?: string;
  title?: string;
  detail?: string | null;
};

export type ModelConfigCapabilityItem = {
  capabilityId: string;
  routeCapability: string;
  label: string;
  detail?: string;
  /** Optional small uppercase header rendered above the model selector. When set,
   *  the card renders this instead of the per-capability `label` row and hides the
   *  inline status dot/badge — page-level chrome carries the status. */
  activeModelLabel?: string;
  /** Optional hint rendered directly under `activeModelLabel` to expose the selector affordance. */
  activeModelHint?: string;
  activeModelConfiguredLabel?: string;
  activeModelSetupPendingLabel?: string;
  targetRef: ModelConfigTargetRef | null;
  provider?: RouteModelPickerDataProvider | null;
  onTargetRefChange: (targetRef: ModelConfigTargetRef | null) => void;
  status?: ModelConfigCapabilityStatus | null;
  editor?: ReactNode;
  showEditorWhen?: 'always' | 'local';
  showClearButton?: boolean;
  placeholder?: string;
  disabled?: boolean;
  runtimeNotReadyLabel?: string;
  clearSelectionLabel?: string;
};

export type ModelConfigSection = {
  id: string;
  title: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  items?: ModelConfigCapabilityItem[];
  content?: ReactNode;
  hidden?: boolean;
};

export type ModelConfigProfileOption = {
  profileId: string;
  title: string;
  description?: string;
};

export type ModelConfigProfileCopy = {
  sectionTitle: string;
  summaryLabel: string;
  emptySummaryLabel: string;
  applyButtonLabel: string;
  changeButtonLabel: string;
  manageButtonTitle: string;
  modalTitle: string;
  modalHint: string;
  loadingLabel: string;
  emptyLabel: string;
  currentBadgeLabel: string;
  cancelLabel: string;
  confirmLabel: string;
  applyingLabel: string;
  reloadLabel?: string;
  importLabel?: string;
  /** Preview→confirm step (D-AIPC-014 apply preview). */
  previewTitle: string;
  previewHint: string;
  previewingLabel: string;
  previewFirstApplyLabel: string;
  previewNoChangeLabel: string;
  previewBeforeLabel: string;
  previewAfterLabel: string;
  previewWarningsLabel: string;
  previewConfirmLabel: string;
  previewBackLabel: string;
};

export type ModelConfigProfileDiffRow = {
  path: string;
  changeKind: 'added' | 'removed' | 'changed';
  beforeText: string;
  afterText: string;
};

/**
 * Displayable preview state surfaced by the controller between `onApply`
 * (which previews) and `onConfirmApply` (which commits). D-AIPC-014.
 */
export type ModelConfigProfilePreview = {
  profileId: string;
  profileTitle: string;
  isFirstApply: boolean;
  identical: boolean;
  rows: ModelConfigProfileDiffRow[];
  probeWarnings: string[];
};

export type ModelConfigProfileController = {
  currentOrigin: {
    profileId: string;
    title?: string | null;
  } | null;
  profiles: ModelConfigProfileOption[];
  selectedProfileId: string | null;
  isLoading?: boolean;
  isReloading?: boolean;
  error?: string | null;
  applying?: boolean;
  /** True while a non-committing apply preview (D-AIPC-014) is being computed. */
  previewing?: boolean;
  /**
   * The computed before→after preview awaiting explicit confirm. Null when no
   * profile has been previewed or after a commit / cancel.
   */
  preview?: ModelConfigProfilePreview | null;
  copy: ModelConfigProfileCopy;
  onSelectedProfileChange: (profileId: string | null) => void;
  /**
   * Begin a profile apply: computes the D-AIPC-014 preview. Does NOT commit.
   * The committed write happens only on `onConfirmApply` after the user
   * confirms the surfaced diff.
   */
  onApply: (profileId: string) => void;
  /** Commit the pending previewed profile via D-AIPC-005 atomic apply. */
  onConfirmApply: () => void;
  /** Discard the pending preview without committing. */
  onCancelPreview: () => void;
  onManage?: () => void;
  onReload?: () => void;
};

export type TextGenerateParamsState = {
  tone: string;
  length: string;
  temperature: string;
  topP: string;
  topK: string;
  maxTokens: string;
  timeoutMs: string;
  stopSequences: string[];
  presencePenalty: string;
  frequencyPenalty: string;
};

export type AudioSynthesizeParamsState = {
  voiceRef: NimiRuntimeSpeechVoiceReference | null;
  speakingRate: string;
  volume: string;
  pitchSemitones: string;
  languageHint: string;
  responseFormat: string;
  timeoutMs: string;
};

export type AudioTranscribeParamsState = {
  language: string;
  responseFormat: string;
  timeoutMs: string;
  speakerCount: string;
  prompt: string;
  timestamps: boolean;
  diarization: boolean;
};

export type VoiceWorkflowParamsState = {
  referenceAssetId: string;
  referenceText: string;
  voiceDesignPrompt: string;
  previewText: string;
  language: string;
  preferredName: string;
  durationSec: string;
  seed: string;
  timeoutMs: string;
};

export type ImageParamsState = {
  modelFamily?: string;
  size: string;
  responseFormat: string;
  seed: string;
  timeoutMs: string;
  steps: string;
  cfgScale: string;
  sampler: string;
  scheduler: string;
  optionsText: string;
};

export type VideoParamsState = {
  mode: string;
  ratio: string;
  durationSec: string;
  resolution: string;
  fps: string;
  seed: string;
  timeoutMs: string;
  negativePrompt: string;
  cameraFixed: boolean;
  generateAudio: boolean;
};

export type CompanionSlotDef = {
  slot: string;
  label: string;
  kind: string;
  required?: boolean;
};

export type LocalAssetEntry = {
  localAssetId: string;
  assetId: string;
  kind: string;
  engine: string;
  status: string;
  family?: string;
  modelFamily?: string;
  metadata?: Readonly<Record<string, unknown>>;
};

export type CapabilityModelCardProps = {
  item: ModelConfigCapabilityItem;
};

export type ModelConfigPanelProps = {
  profile?: ModelConfigProfileController;
  sections: ModelConfigSection[];
  className?: string;
};
