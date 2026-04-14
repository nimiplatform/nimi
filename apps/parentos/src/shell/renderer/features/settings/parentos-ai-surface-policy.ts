export type ParentosAIInputKind =
  | 'structured-local'
  | 'closed-set'
  | 'ocr-extract'
  | 'stt';

export type ParentosAISurfaceId =
  | 'parentos.advisor'
  | 'parentos.report'
  | 'parentos.profile.checkup-ocr'
  | 'parentos.medical.ocr-intake'
  | 'parentos.medical.smart-insight'
  | 'parentos.medical.event-analysis'
  | 'parentos.journal.ai-tagging'
  | 'parentos.journal.voice-observation'
  | `parentos.profile.summary.${string}`;

export interface ParentosAISurfacePolicy {
  surfaceId: ParentosAISurfaceId;
  localOnly: boolean;
  inputKind: ParentosAIInputKind;
  requiresSafetyFilter: boolean;
  requiresStructuredFallback: boolean;
  persistFrozenExecutionSnapshot: boolean;
}

const EXACT_SURFACE_POLICIES: Record<Exclude<ParentosAISurfaceId, `parentos.profile.summary.${string}`>, ParentosAISurfacePolicy> = {
  'parentos.advisor': {
    surfaceId: 'parentos.advisor',
    localOnly: true,
    inputKind: 'structured-local',
    requiresSafetyFilter: true,
    requiresStructuredFallback: true,
    persistFrozenExecutionSnapshot: true,
  },
  'parentos.report': {
    surfaceId: 'parentos.report',
    localOnly: true,
    inputKind: 'structured-local',
    requiresSafetyFilter: true,
    requiresStructuredFallback: false,
    persistFrozenExecutionSnapshot: false,
  },
  'parentos.profile.checkup-ocr': {
    surfaceId: 'parentos.profile.checkup-ocr',
    localOnly: true,
    inputKind: 'ocr-extract',
    requiresSafetyFilter: false,
    requiresStructuredFallback: false,
    persistFrozenExecutionSnapshot: false,
  },
  'parentos.medical.ocr-intake': {
    surfaceId: 'parentos.medical.ocr-intake',
    localOnly: true,
    inputKind: 'ocr-extract',
    requiresSafetyFilter: false,
    requiresStructuredFallback: false,
    persistFrozenExecutionSnapshot: false,
  },
  'parentos.medical.smart-insight': {
    surfaceId: 'parentos.medical.smart-insight',
    localOnly: true,
    inputKind: 'structured-local',
    requiresSafetyFilter: true,
    requiresStructuredFallback: false,
    persistFrozenExecutionSnapshot: false,
  },
  'parentos.medical.event-analysis': {
    surfaceId: 'parentos.medical.event-analysis',
    localOnly: true,
    inputKind: 'structured-local',
    requiresSafetyFilter: true,
    requiresStructuredFallback: false,
    persistFrozenExecutionSnapshot: false,
  },
  'parentos.journal.ai-tagging': {
    surfaceId: 'parentos.journal.ai-tagging',
    localOnly: true,
    inputKind: 'closed-set',
    requiresSafetyFilter: false,
    requiresStructuredFallback: false,
    persistFrozenExecutionSnapshot: false,
  },
  'parentos.journal.voice-observation': {
    surfaceId: 'parentos.journal.voice-observation',
    localOnly: true,
    inputKind: 'stt',
    requiresSafetyFilter: false,
    requiresStructuredFallback: false,
    persistFrozenExecutionSnapshot: false,
  },
};

export function getParentosAISurfacePolicy(surfaceId: ParentosAISurfaceId): ParentosAISurfacePolicy {
  if (surfaceId.startsWith('parentos.profile.summary.')) {
    return {
      surfaceId,
      localOnly: true,
      inputKind: 'structured-local',
      requiresSafetyFilter: true,
      requiresStructuredFallback: false,
      persistFrozenExecutionSnapshot: false,
    };
  }

  return EXACT_SURFACE_POLICIES[
    surfaceId as keyof typeof EXACT_SURFACE_POLICIES
  ];
}
