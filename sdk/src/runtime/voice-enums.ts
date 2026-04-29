export const VoiceWorkflowType = {
  UNSPECIFIED: 0,
  VOICE_CLONE: 1,
  VOICE_DESIGN: 2,
} as const;

export type VoiceWorkflowType = (typeof VoiceWorkflowType)[keyof typeof VoiceWorkflowType];

export const VoiceReferenceKind = {
  UNSPECIFIED: 0,
  PRESET: 1,
  VOICE_ASSET: 2,
  PROVIDER_VOICE_REF: 3,
} as const;

export type VoiceReferenceKind = (typeof VoiceReferenceKind)[keyof typeof VoiceReferenceKind];

export const VoiceAssetStatus = {
  UNSPECIFIED: 0,
  ACTIVE: 1,
  EXPIRED: 2,
  DELETED: 3,
  FAILED: 4,
} as const;

export type VoiceAssetStatus = (typeof VoiceAssetStatus)[keyof typeof VoiceAssetStatus];
