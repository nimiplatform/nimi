import {
  createLive2DAgentCenterPreviewDescriptor,
  type Live2DAgentCenterPreviewDescriptor,
  type Live2DAgentCenterPreviewReadinessInput,
} from '../live2d/live2d-agent-center-preview.js';
import {
  createVrmAgentCenterPreviewDescriptor,
  type VrmAgentCenterPreviewDescriptor,
  type VrmAgentCenterPreviewReadinessInput,
} from '../vrm/vrm-agent-center-preview.js';

type AgentCenterAvatarPreviewBackendKind = 'live2d' | 'vrm';

export type AgentCenterAvatarPreviewFailureReasonCode =
  | 'missing_asset'
  | 'invalid_manifest'
  | 'unsupported_preview_tier'
  | 'capability_unavailable'
  | 'host_internal_error';

export type AgentCenterAvatarPreviewServiceResolveInput =
  | {
      readonly avatarAssetRef: string;
      readonly backendKind: 'live2d';
      readonly previewMaterialRef: string;
      readonly previewSurfaceHandle: string;
      readonly live2d: Live2DAgentCenterPreviewReadinessInput;
    }
  | {
      readonly avatarAssetRef: string;
      readonly backendKind: 'vrm';
      readonly previewMaterialRef: string;
      readonly previewSurfaceHandle: string;
      readonly vrm: VrmAgentCenterPreviewReadinessInput;
    };

export type AgentCenterAvatarPreviewSurfaceRegistrationInput = {
  readonly avatarAssetRef: string;
  readonly backendKind: AgentCenterAvatarPreviewBackendKind;
  readonly previewMaterialRef: string;
  readonly previewImageRef: string;
};

export type AgentCenterAvatarPreviewServiceResolveResult =
  | {
      readonly state: 'ready';
      readonly tier: 'avatar_preview_service';
      readonly avatarAssetRef: string;
      readonly backendKind: AgentCenterAvatarPreviewBackendKind;
      readonly previewMaterialRef: string;
      readonly previewImageRef: string;
      readonly warnings: readonly string[];
    }
  | {
      readonly state: 'failed' | 'unavailable' | 'loading';
      readonly tier: 'avatar_preview_service';
      readonly avatarAssetRef: string | null;
      readonly backendKind: AgentCenterAvatarPreviewBackendKind | null;
      readonly previewMaterialRef: string | null;
      readonly previewImageRef: null;
      readonly reasonCode: AgentCenterAvatarPreviewFailureReasonCode;
      readonly reason: string;
      readonly warnings: readonly string[];
    };

export type AgentCenterAvatarPreviewService = {
  readonly registerPreviewSurface: (
    input: AgentCenterAvatarPreviewSurfaceRegistrationInput,
  ) => { readonly previewSurfaceHandle: string };
  readonly unregisterPreviewSurface: (previewSurfaceHandle: string) => boolean;
  readonly resolvePreview: (
    input: AgentCenterAvatarPreviewServiceResolveInput,
  ) => AgentCenterAvatarPreviewServiceResolveResult;
};

type RegisteredPreviewSurface = {
  readonly avatarAssetRef: string;
  readonly backendKind: AgentCenterAvatarPreviewBackendKind;
  readonly previewMaterialRef: string;
  readonly previewImageRef: string;
};

const SERVICE_WARNING_BY_BACKEND = {
  live2d: 'avatar_preview_service:live2d',
  vrm: 'avatar_preview_service:vrm',
} as const;

export function createAgentCenterAvatarPreviewService(): AgentCenterAvatarPreviewService {
  const registeredSurfaces = new Map<string, RegisteredPreviewSurface>();

  return {
    registerPreviewSurface(input) {
      const backendKind = requireBackendKind(input.backendKind);
      const avatarAssetRef = requireManagedAvatarAssetRef(input.avatarAssetRef, backendKind);
      const previewMaterialRef = requireBoundPreviewMaterialRef(
        input.previewMaterialRef,
        backendKind,
        avatarAssetRef,
      );
      const previewImageRef = requireControlledPreviewSurface(input.previewImageRef);
      const previewSurfaceHandle = createPreviewSurfaceHandle();
      registeredSurfaces.set(previewSurfaceHandle, {
        avatarAssetRef,
        backendKind,
        previewMaterialRef,
        previewImageRef,
      });
      return { previewSurfaceHandle };
    },
    unregisterPreviewSurface(previewSurfaceHandle) {
      return registeredSurfaces.delete(normalizeText(previewSurfaceHandle));
    },
    resolvePreview(input) {
      return resolveAgentCenterAvatarPreviewService(input, registeredSurfaces);
    },
  };
}

function resolveAgentCenterAvatarPreviewService(
  input: AgentCenterAvatarPreviewServiceResolveInput,
  registeredSurfaces: ReadonlyMap<string, RegisteredPreviewSurface>,
): AgentCenterAvatarPreviewServiceResolveResult {
  let avatarAssetRef: string | null = null;
  let backendKind: AgentCenterAvatarPreviewBackendKind | null = null;
  let previewMaterialRef: string | null = null;
  try {
    const record = input as unknown as Readonly<Record<string, unknown>>;
    const candidateBackendKind = normalizeText(record.backendKind);
    if (candidateBackendKind !== 'live2d' && candidateBackendKind !== 'vrm') {
      return unavailableResult({
        avatarAssetRef: normalizeText(record.avatarAssetRef) || null,
        backendKind: null,
        previewMaterialRef: normalizeText(record.previewMaterialRef) || null,
        reasonCode: 'unsupported_preview_tier',
        reason: 'Avatar preview service supports only the admitted Live2D and VRM tiers.',
      });
    }
    backendKind = candidateBackendKind;
    avatarAssetRef = normalizeText(record.avatarAssetRef) || null;
    if (!avatarAssetRef || !isManagedAvatarAssetRef(avatarAssetRef, backendKind)) {
      return failedResult({
        avatarAssetRef,
        backendKind,
        previewMaterialRef: normalizeText(record.previewMaterialRef) || null,
        reasonCode: 'missing_asset',
        reason: 'Avatar preview service requires a managed Avatar asset ref.',
      });
    }
    previewMaterialRef = normalizeText(record.previewMaterialRef) || null;
    if (!previewMaterialRef || !isBoundPreviewMaterialRef(previewMaterialRef, backendKind, avatarAssetRef)) {
      return failedResult({
        avatarAssetRef,
        backendKind,
        previewMaterialRef,
        reasonCode: 'invalid_manifest',
        reason: 'Avatar preview material does not match the selected backend and asset.',
      });
    }

    const previewSurfaceHandle = normalizeText(record.previewSurfaceHandle);
    const surface = registeredSurfaces.get(previewSurfaceHandle);
    if (!surface) {
      return unavailableResult({
        avatarAssetRef,
        backendKind,
        previewMaterialRef,
        reasonCode: 'capability_unavailable',
        reason: 'Avatar preview service has no registered renderer surface for this request.',
      });
    }
    if (surface.avatarAssetRef !== avatarAssetRef
      || surface.backendKind !== backendKind
      || surface.previewMaterialRef !== previewMaterialRef) {
      return failedResult({
        avatarAssetRef,
        backendKind,
        previewMaterialRef,
        reasonCode: 'invalid_manifest',
        reason: 'Registered Avatar preview surface does not match the selected material.',
      });
    }

    if (backendKind === 'live2d') {
      if (!isRecord(record.live2d)) {
        return invalidDescriptorResult(avatarAssetRef, backendKind, previewMaterialRef);
      }
      const descriptor = createLive2DAgentCenterPreviewDescriptor(
        record.live2d as Live2DAgentCenterPreviewReadinessInput,
      );
      if (descriptor.validationStatus === 'checking') {
        return loadingResult({
          avatarAssetRef,
          backendKind,
          previewMaterialRef,
          reasonCode: 'capability_unavailable',
          reason: descriptor.validationMessage,
        });
      }
      if (descriptor.validationStatus !== 'valid') {
        return failedResult({
          avatarAssetRef,
          backendKind,
          previewMaterialRef,
          reasonCode: 'invalid_manifest',
          reason: descriptor.validationMessage,
        });
      }
      return readyResult(avatarAssetRef, previewMaterialRef, surface.previewImageRef, descriptor);
    }

    if (!isRecord(record.vrm)) {
      return invalidDescriptorResult(avatarAssetRef, backendKind, previewMaterialRef);
    }
    const descriptor = createVrmAgentCenterPreviewDescriptor(
      record.vrm as VrmAgentCenterPreviewReadinessInput,
    );
    if (descriptor.validationStatus !== 'valid') {
      return failedResult({
        avatarAssetRef,
        backendKind,
        previewMaterialRef,
        reasonCode: 'invalid_manifest',
        reason: descriptor.validationMessage,
      });
    }
    if (!isNamespacedOpaqueRef(descriptor.capabilityProfileRef, 'avatar.vrm.capability-profile:')) {
      return failedResult({
        avatarAssetRef,
        backendKind,
        previewMaterialRef,
        reasonCode: 'invalid_manifest',
        reason: 'VRM preview renderer returned no current capability profile.',
      });
    }
    return readyResult(avatarAssetRef, previewMaterialRef, surface.previewImageRef, descriptor);
  } catch (error) {
    return failedResult({
      avatarAssetRef,
      backendKind,
      previewMaterialRef,
      reasonCode: 'host_internal_error',
      reason: error instanceof Error && error.message
        ? `Avatar preview renderer failed: ${error.message}`
        : 'Avatar preview renderer failed with an internal error.',
    });
  }
}

function readyResult(
  avatarAssetRef: string,
  previewMaterialRef: string,
  previewImageRef: string,
  descriptor: Extract<
    Live2DAgentCenterPreviewDescriptor | VrmAgentCenterPreviewDescriptor,
    { readonly validationStatus: 'valid' }
  >,
): AgentCenterAvatarPreviewServiceResolveResult {
  return {
    state: 'ready',
    tier: 'avatar_preview_service',
    avatarAssetRef,
    backendKind: descriptor.backendKind,
    previewMaterialRef,
    previewImageRef,
    warnings: [SERVICE_WARNING_BY_BACKEND[descriptor.backendKind]],
  };
}

function invalidDescriptorResult(
  avatarAssetRef: string,
  backendKind: AgentCenterAvatarPreviewBackendKind,
  previewMaterialRef: string,
): AgentCenterAvatarPreviewServiceResolveResult {
  return failedResult({
    avatarAssetRef,
    backendKind,
    previewMaterialRef,
    reasonCode: 'invalid_manifest',
    reason: 'Avatar preview renderer returned no valid backend output.',
  });
}

type NonReadyResultInput = {
  readonly avatarAssetRef: string | null;
  readonly backendKind: AgentCenterAvatarPreviewBackendKind | null;
  readonly previewMaterialRef: string | null;
  readonly reasonCode: AgentCenterAvatarPreviewFailureReasonCode;
  readonly reason: string;
};

function failedResult(input: NonReadyResultInput): AgentCenterAvatarPreviewServiceResolveResult {
  return nonReadyResult('failed', input);
}

function unavailableResult(input: NonReadyResultInput): AgentCenterAvatarPreviewServiceResolveResult {
  return nonReadyResult('unavailable', input);
}

function loadingResult(input: NonReadyResultInput): AgentCenterAvatarPreviewServiceResolveResult {
  return nonReadyResult('loading', input);
}

function nonReadyResult(
  state: 'failed' | 'unavailable' | 'loading',
  input: NonReadyResultInput,
): AgentCenterAvatarPreviewServiceResolveResult {
  return {
    state,
    tier: 'avatar_preview_service',
    avatarAssetRef: input.avatarAssetRef,
    backendKind: input.backendKind,
    previewMaterialRef: input.previewMaterialRef,
    previewImageRef: null,
    reasonCode: input.reasonCode,
    reason: input.reason,
    warnings: input.backendKind ? [SERVICE_WARNING_BY_BACKEND[input.backendKind]] : [],
  };
}

function createPreviewSurfaceHandle(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (!randomUUID) {
    throw new Error('Avatar preview surface registration requires platform randomUUID support.');
  }
  return `avatar-preview-surface:${randomUUID()}`;
}

function requireBackendKind(value: unknown): AgentCenterAvatarPreviewBackendKind {
  if (value !== 'live2d' && value !== 'vrm') {
    throw new Error('Avatar preview surface backend is unsupported.');
  }
  return value;
}

function requireManagedAvatarAssetRef(
  value: unknown,
  backendKind: AgentCenterAvatarPreviewBackendKind,
): string {
  const text = normalizeText(value);
  if (!isManagedAvatarAssetRef(text, backendKind)) {
    throw new Error('Avatar preview surface requires a managed asset ref.');
  }
  return text;
}

function isManagedAvatarAssetRef(
  value: string,
  backendKind: AgentCenterAvatarPreviewBackendKind,
): boolean {
  return value.startsWith(`${backendKind}_`) && /^(?:live2d|vrm)_[a-f0-9]{12}$/u.test(value);
}

function requireBoundPreviewMaterialRef(
  value: unknown,
  backendKind: AgentCenterAvatarPreviewBackendKind,
  avatarAssetRef: string,
): string {
  const text = normalizeText(value);
  if (!isBoundPreviewMaterialRef(text, backendKind, avatarAssetRef)) {
    throw new Error('Avatar preview surface material does not match its backend and asset.');
  }
  return text;
}

function isBoundPreviewMaterialRef(
  value: string,
  backendKind: AgentCenterAvatarPreviewBackendKind,
  avatarAssetRef: string,
): boolean {
  const parts = value.split(':');
  return parts.length === 5
    && parts[0] === 'agent-center-avatar-asset'
    && isShellCustodySegment(parts[1] ?? '')
    && isShellCustodySegment(parts[2] ?? '')
    && parts[3] === backendKind
    && parts[4] === avatarAssetRef;
}

function isShellCustodySegment(value: string): boolean {
  const body = value.startsWith('~') ? value.slice(1) : value;
  return value.length <= 128 && /^[a-z0-9][a-z0-9_-]*$/u.test(body);
}

function isNamespacedOpaqueRef(value: string, namespace: string): boolean {
  if (!value.startsWith(namespace)) return false;
  const tail = value.slice(namespace.length);
  return tail.length <= 1_024
    && /^[A-Za-z0-9][A-Za-z0-9._:@+~/-]*$/u.test(tail)
    && !tail.includes('..')
    && !tail.includes('//');
}

function requireControlledPreviewSurface(value: unknown): string {
  const text = controlledPreviewSurface(value);
  if (!text) {
    throw new Error('Avatar preview surface must be a controlled root-relative or current-origin blob URL.');
  }
  return text;
}

function controlledPreviewSurface(value: unknown): string {
  const text = normalizeText(value);
  if (text.startsWith('/') && !text.startsWith('//') && !text.includes('\\')) return text;
  if (!text.startsWith('blob:')) return '';
  const origin = normalizeText(globalThis.location?.origin);
  if (!origin || origin === 'null') return '';
  try {
    return new URL(text.slice('blob:'.length)).origin === origin ? text : '';
  } catch {
    return '';
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
