import type { SpeechSynthesizeInput } from '@nimiplatform/sdk/runtime/browser';
import type { OwnerPortfolioAgentDetail } from './portfolio-data.js';

export const MEDIA_CANDIDATE_RESOURCE_TYPES = ['IMAGE', 'VIDEO', 'AUDIO'] as const;
export const MEDIA_CANDIDATE_BINDING_POINTS = [
  'AGENT_AVATAR',
  'AGENT_PORTRAIT',
  'AGENT_CANDIDATE',
  'AGENT_VOICE_SAMPLE',
] as const;

export const VISUAL_MEDIA_BLOCKED_REASON = 'visual media candidate blocked: image generation and owner-scoped Resource-to-Agent binding ingress are not admitted; READY Resources may be used for post attachments only';
export const VOICE_DEMO_BLOCKED_REASON = 'voice demo candidate blocked: Runtime synthesis and Resource upload/finalize are not called in this local preview slice';
export const VOICE_DEMO_CANDIDATE_NOTICE = 'voice demo candidate uses Runtime media.tts.synthesize only; public voice/sample binding requires a dedicated owner-scoped Realm ingress';
export const VOICE_DEMO_SYNTHESIS_SOURCE = 'Runtime media.tts.synthesize';

export type MediaCandidateResourceType = typeof MEDIA_CANDIDATE_RESOURCE_TYPES[number];
export type MediaCandidateBindingPoint = typeof MEDIA_CANDIDATE_BINDING_POINTS[number];
export type VisualCandidateResourceType = Extract<MediaCandidateResourceType, 'IMAGE'>;
export type VoiceCandidateResourceType = Extract<MediaCandidateResourceType, 'AUDIO'>;

export type VisualMediaCandidateInput = {
  resourceType: string;
  bindingPoint: string;
  prompt: string;
  notes: string;
};

export type VoiceDemoCandidateInput = {
  scriptText: string;
  model: string;
};

export type NormalizedVisualMediaCandidateInput = {
  resourceType: VisualCandidateResourceType;
  bindingPoint: Exclude<MediaCandidateBindingPoint, 'AGENT_VOICE_SAMPLE'>;
  prompt: string;
  notes: string;
};

export type NormalizedVoiceDemoCandidateInput = {
  resourceType: VoiceCandidateResourceType;
  bindingPoint: Extract<MediaCandidateBindingPoint, 'AGENT_VOICE_SAMPLE'>;
  scriptText: string;
  model: string;
};

export type CandidateAgentContext = {
  source: 'Realm MeService.getMyRealmAgent';
  agentKey: string;
  handle: string;
  displayName: string;
  bio?: string;
  greeting?: string;
  profileCoverUrl?: string;
};

export type BlockedVisualAssetCandidatePayload = {
  candidate: true;
  blocked: true;
  publicTruth: false;
  blockedReason: typeof VISUAL_MEDIA_BLOCKED_REASON;
  source: 'realm-agent-studio.local-visual-media-candidate';
  agentContext: CandidateAgentContext;
  localDraft: {
    prompt: string;
    notes?: string;
  };
  futureEvidencePath: {
    resource: {
      carrier: 'Resource';
      type: VisualCandidateResourceType;
      status: 'candidate-only';
    };
    binding: {
      family: 'Binding';
      hostType: 'AGENT';
      objectType: 'RESOURCE';
      bindingPoint: Exclude<MediaCandidateBindingPoint, 'AGENT_VOICE_SAMPLE'>;
      status: 'candidate-blocked';
    };
  };
};

export type BlockedVoiceDemoRequestPayload = {
  candidate: true;
  blocked: true;
  publicTruth: false;
  blockedReason: typeof VOICE_DEMO_BLOCKED_REASON;
  source: 'realm-agent-studio.local-voice-demo-candidate';
  agentContext: CandidateAgentContext;
  runtimePreview: {
    capabilityToken: 'audio.synthesize';
    currentSdkPath: 'media.tts.synthesize';
    requestCandidate: {
      model: string;
      text: string;
      metadata: {
        source: 'realm-agent-studio.local-voice-demo-candidate';
        agentKey: string;
      };
    };
    status: 'candidate-blocked';
  };
  futureEvidencePath: {
    resource: {
      carrier: 'Resource';
      type: VoiceCandidateResourceType;
      status: 'candidate-only';
    };
    binding: {
      family: 'Binding';
      hostType: 'AGENT';
      objectType: 'RESOURCE';
      bindingPoint: Extract<MediaCandidateBindingPoint, 'AGENT_VOICE_SAMPLE'>;
      status: 'candidate-blocked';
    };
  };
};

export type ReviewedVoiceDemoCandidatePayload = {
  candidate: true;
  publicTruth: false;
  source: 'realm-agent-studio.reviewed-voice-demo-candidate';
  agentContext: CandidateAgentContext;
  runtime: {
    capabilityToken: 'audio.synthesize';
    currentSdkPath: 'media.tts.synthesize';
    source: typeof VOICE_DEMO_SYNTHESIS_SOURCE;
    request: SpeechSynthesizeInput;
    status: 'candidate-ready';
  };
  futureEvidencePath: {
    resource: {
      carrier: 'Resource';
      type: VoiceCandidateResourceType;
      status: 'candidate-only';
    };
    binding: {
      family: 'Binding';
      hostType: 'AGENT';
      objectType: 'RESOURCE';
      bindingPoint: Extract<MediaCandidateBindingPoint, 'AGENT_VOICE_SAMPLE'>;
      status: 'candidate-only';
    };
  };
};

export type MediaCandidateBuildResult<TPayload> =
  | {
    blocked: true;
    changed: true;
    errors: [];
    payload: TPayload;
  }
  | {
    blocked: true;
    changed: false;
    errors: string[];
    payload: null;
  };

export type VoiceDemoCandidateBuildResult<TPayload> =
  | {
    changed: true;
    errors: [];
    payload: TPayload;
  }
  | {
    changed: false;
    errors: string[];
    payload: null;
  };

const VISUAL_RESOURCE_TYPES = new Set<VisualCandidateResourceType>(['IMAGE']);
const VISUAL_BINDING_POINTS = new Set<Exclude<MediaCandidateBindingPoint, 'AGENT_VOICE_SAMPLE'>>([
  'AGENT_AVATAR',
  'AGENT_PORTRAIT',
  'AGENT_CANDIDATE',
]);
const FORBIDDEN_MEDIA_CANDIDATE_FIELDS = new Set([
  'provider',
  'model',
  'localAgent',
  'worldId',
  'publicSuccess',
  'bindingSuccess',
  'resourceReady',
]);
const MODEL_ALLOWED_PATHS = new Set([
  'runtimePreview.requestCandidate.model',
  'runtime.request.model',
]);

function normalizeLineText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function normalizeSingleLine(value: string): string {
  return normalizeLineText(value).replace(/[ \t]+/g, ' ');
}

function isVisualResourceType(value: string): value is VisualCandidateResourceType {
  return VISUAL_RESOURCE_TYPES.has(value as VisualCandidateResourceType);
}

function isVisualBindingPoint(value: string): value is Exclude<MediaCandidateBindingPoint, 'AGENT_VOICE_SAMPLE'> {
  return VISUAL_BINDING_POINTS.has(value as Exclude<MediaCandidateBindingPoint, 'AGENT_VOICE_SAMPLE'>);
}

export function isAllowedMediaCandidateResourceType(value: string): value is MediaCandidateResourceType {
  return MEDIA_CANDIDATE_RESOURCE_TYPES.includes(value as MediaCandidateResourceType);
}

export function isAllowedMediaCandidateBindingPoint(value: string): value is MediaCandidateBindingPoint {
  return MEDIA_CANDIDATE_BINDING_POINTS.includes(value as MediaCandidateBindingPoint);
}

export function assertNoForbiddenMediaCandidateFields(value: unknown, path: string[] = []): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = [...path, key];
    if (FORBIDDEN_MEDIA_CANDIDATE_FIELDS.has(key) && !(key === 'model' && MODEL_ALLOWED_PATHS.has(nextPath.join('.')))) {
      return key;
    }
    const nestedViolation = assertNoForbiddenMediaCandidateFields(nested, nextPath);
    if (nestedViolation) {
      return nestedViolation;
    }
  }

  return null;
}

function createAgentContext(agent: OwnerPortfolioAgentDetail): CandidateAgentContext {
  return {
    source: agent.source,
    agentKey: agent.id,
    handle: agent.handle.value,
    displayName: agent.displayName.value,
    ...(agent.bio.value ? { bio: agent.bio.value } : {}),
    ...(agent.greeting.value ? { greeting: agent.greeting.value } : {}),
    ...(agent.profileCoverUrl.value ? { profileCoverUrl: agent.profileCoverUrl.value } : {}),
  };
}

export function normalizeVisualMediaCandidateInput(input: VisualMediaCandidateInput): NormalizedVisualMediaCandidateInput {
  return {
    resourceType: isVisualResourceType(input.resourceType) ? input.resourceType : 'IMAGE',
    bindingPoint: isVisualBindingPoint(input.bindingPoint) ? input.bindingPoint : 'AGENT_CANDIDATE',
    prompt: normalizeLineText(input.prompt),
    notes: normalizeLineText(input.notes),
  };
}

export function normalizeVoiceDemoCandidateInput(input: VoiceDemoCandidateInput): NormalizedVoiceDemoCandidateInput {
  return {
    resourceType: 'AUDIO',
    bindingPoint: 'AGENT_VOICE_SAMPLE',
    scriptText: normalizeLineText(input.scriptText),
    model: normalizeSingleLine(input.model),
  };
}

export function buildReviewedVoiceSynthesisPayload(
  input: VoiceDemoCandidateInput,
  agent: OwnerPortfolioAgentDetail,
): VoiceDemoCandidateBuildResult<SpeechSynthesizeInput> {
  const normalized = normalizeVoiceDemoCandidateInput(input);
  const errors: string[] = [];

  if (!normalized.scriptText) {
    errors.push('voice demo script missing for Runtime media.tts.synthesize');
  }
  if (!normalized.model) {
    errors.push('Runtime media.tts.synthesize model config missing');
  }

  if (errors.length > 0) {
    return { changed: false, errors, payload: null };
  }

  const payload: SpeechSynthesizeInput = {
    model: normalized.model,
    text: normalizeSingleLine(normalized.scriptText),
    metadata: {
      source: 'realm-agent-studio.reviewed-voice-demo-candidate',
      agentKey: agent.id,
    },
  };

  return { changed: true, errors: [], payload };
}

export function buildReviewedVoiceDemoCandidatePayload(
  input: VoiceDemoCandidateInput,
  agent: OwnerPortfolioAgentDetail,
): VoiceDemoCandidateBuildResult<ReviewedVoiceDemoCandidatePayload> {
  const synthesisPayload = buildReviewedVoiceSynthesisPayload(input, agent);
  const normalized = normalizeVoiceDemoCandidateInput(input);

  if (!synthesisPayload.payload) {
    return synthesisPayload;
  }

  return {
    changed: true,
    errors: [],
    payload: {
      candidate: true,
      publicTruth: false,
      source: 'realm-agent-studio.reviewed-voice-demo-candidate',
      agentContext: createAgentContext(agent),
      runtime: {
        capabilityToken: 'audio.synthesize',
        currentSdkPath: 'media.tts.synthesize',
        source: VOICE_DEMO_SYNTHESIS_SOURCE,
        request: synthesisPayload.payload,
        status: 'candidate-ready',
      },
      futureEvidencePath: {
        resource: {
          carrier: 'Resource',
          type: normalized.resourceType,
          status: 'candidate-only',
        },
        binding: {
          family: 'Binding',
          hostType: 'AGENT',
          objectType: 'RESOURCE',
          bindingPoint: normalized.bindingPoint,
          status: 'candidate-only',
        },
      },
    },
  };
}

export function buildBlockedVisualAssetCandidatePayload(
  input: VisualMediaCandidateInput,
  agent: OwnerPortfolioAgentDetail,
): MediaCandidateBuildResult<BlockedVisualAssetCandidatePayload> {
  const normalized = normalizeVisualMediaCandidateInput(input);
  const errors: string[] = [];

  if (!normalized.prompt) {
    errors.push('visual prompt missing');
  }
  if (!isAllowedMediaCandidateResourceType(normalized.resourceType)) {
    errors.push('resource type not admitted');
  }
  if (!isAllowedMediaCandidateBindingPoint(normalized.bindingPoint)) {
    errors.push('binding point not admitted');
  }

  if (errors.length > 0) {
    return { blocked: true, changed: false, errors, payload: null };
  }

  const payload: BlockedVisualAssetCandidatePayload = {
    candidate: true,
    blocked: true,
    publicTruth: false,
    blockedReason: VISUAL_MEDIA_BLOCKED_REASON,
    source: 'realm-agent-studio.local-visual-media-candidate',
    agentContext: createAgentContext(agent),
    localDraft: {
      prompt: normalized.prompt,
      ...(normalized.notes ? { notes: normalized.notes } : {}),
    },
    futureEvidencePath: {
      resource: {
        carrier: 'Resource',
        type: normalized.resourceType,
        status: 'candidate-only',
      },
      binding: {
        family: 'Binding',
        hostType: 'AGENT',
        objectType: 'RESOURCE',
        bindingPoint: normalized.bindingPoint,
        status: 'candidate-blocked',
      },
    },
  };

  const forbiddenKey = assertNoForbiddenMediaCandidateFields(payload);
  if (forbiddenKey) {
    return {
      blocked: true,
      changed: false,
      errors: [`media candidate rejected: forbidden ${forbiddenKey} present`],
      payload: null,
    };
  }

  return { blocked: true, changed: true, errors: [], payload };
}

export function buildBlockedVoiceDemoRequestPayload(
  input: VoiceDemoCandidateInput,
  agent: OwnerPortfolioAgentDetail,
): MediaCandidateBuildResult<BlockedVoiceDemoRequestPayload> {
  const normalized = normalizeVoiceDemoCandidateInput(input);
  const errors: string[] = [];

  if (!normalized.scriptText) {
    errors.push('voice demo script missing for Runtime media.tts.synthesize');
  }
  if (!normalized.model) {
    errors.push('Runtime media.tts.synthesize model config missing');
  }

  if (errors.length > 0) {
    return { blocked: true, changed: false, errors, payload: null };
  }

  const payload: BlockedVoiceDemoRequestPayload = {
    candidate: true,
    blocked: true,
    publicTruth: false,
    blockedReason: VOICE_DEMO_BLOCKED_REASON,
    source: 'realm-agent-studio.local-voice-demo-candidate',
    agentContext: createAgentContext(agent),
    runtimePreview: {
      capabilityToken: 'audio.synthesize',
      currentSdkPath: 'media.tts.synthesize',
      requestCandidate: {
        model: normalized.model,
        text: normalizeSingleLine(normalized.scriptText),
        metadata: {
          source: 'realm-agent-studio.local-voice-demo-candidate',
          agentKey: agent.id,
        },
      },
      status: 'candidate-blocked',
    },
    futureEvidencePath: {
      resource: {
        carrier: 'Resource',
        type: normalized.resourceType,
        status: 'candidate-only',
      },
      binding: {
        family: 'Binding',
        hostType: 'AGENT',
        objectType: 'RESOURCE',
        bindingPoint: normalized.bindingPoint,
        status: 'candidate-blocked',
      },
    },
  };

  const forbiddenKey = assertNoForbiddenMediaCandidateFields(payload);
  if (forbiddenKey) {
    return {
      blocked: true,
      changed: false,
      errors: [`media candidate rejected: forbidden ${forbiddenKey} present`],
      payload: null,
    };
  }

  return { blocked: true, changed: true, errors: [], payload };
}
