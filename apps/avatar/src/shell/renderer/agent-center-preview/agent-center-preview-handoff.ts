import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import {
  invokeAvatarHostCommand,
  listenAvatarHostEvent,
  type ShellEventUnsubscribe,
} from '../app-shell/avatar-host-bridge.js';
import {
  createAgentCenterAvatarPreviewService,
  type AgentCenterAvatarPreviewService,
  type AgentCenterAvatarPreviewServiceResolveResult,
} from './agent-center-preview-service.js';

export const AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT = 'avatar://agent-center-preview-request';
export const AVATAR_AGENT_CENTER_PREVIEW_COMPLETE_COMMAND = 'nimi_avatar_agent_center_preview_complete';

export type AvatarAgentCenterPreviewRequest = {
  readonly requestId: string;
  readonly agentId: string;
  readonly avatarAssetRef: string;
  readonly backendKind: 'live2d' | 'vrm';
  readonly presentationRevision: string;
};

type PreviewHandoffContext = {
  readonly agentId: string | null;
  readonly carrier: AvatarRuntimeCarrier | null;
};

export type AvatarAgentCenterPreviewHandoff = {
  readonly handleRequest: (
    request: AvatarAgentCenterPreviewRequest,
  ) => AgentCenterAvatarPreviewServiceResolveResult;
};

export function createAvatarAgentCenterPreviewHandoff(input: {
  readonly service?: AgentCenterAvatarPreviewService;
  readonly getContext: () => PreviewHandoffContext;
  readonly document?: Pick<Document, 'querySelector'>;
}): AvatarAgentCenterPreviewHandoff {
  const service = input.service ?? createAgentCenterAvatarPreviewService();
  return Object.freeze({
    handleRequest(request) {
      const requestId = normalizeText(request.requestId);
      const avatarAssetRef = normalizeText(request.avatarAssetRef);
      const presentationRevision = normalizeText(request.presentationRevision);
      const backendKind = request.backendKind;
      if (!requestId || !avatarAssetRef || !presentationRevision
        || (backendKind !== 'live2d' && backendKind !== 'vrm')) {
        return failedResult(request, null, 'invalid_manifest', 'Avatar preview carrier received an invalid projection request.');
      }
      const context = input.getContext();
      if (!context.carrier) {
        return unavailableResult(request, null, 'Avatar preview carrier is not available.');
      }
      if (normalizeText(context.agentId) !== normalizeText(request.agentId)) {
        return failedResult(request, null, 'invalid_manifest', 'Avatar preview request does not match the active Local Agent.');
      }
      const selection = context.carrier.committedPresentationSelection;
      if (!selection
        || selection.avatarAssetRef !== avatarAssetRef
        || selection.backendKind !== backendKind
        || selection.presentationRevision !== presentationRevision
        || context.carrier.backend.kind !== backendKind) {
        return failedResult(request, selection?.previewMaterialRef ?? null, 'invalid_manifest', 'Avatar committed-effect request does not match the current committed presentation.');
      }
      const previewMaterialRef = selection.previewMaterialRef;
      const documentRef = input.document ?? globalThis.document;
      if (!documentRef) {
        return unavailableResult(request, previewMaterialRef, 'Avatar preview renderer document is unavailable.');
      }
      const previewImageRef = `/__nimi/avatar-preview/${encodeURIComponent(requestId)}.png`;
      let surfaceHandle: string | null = null;
      try {
        surfaceHandle = service.registerPreviewSurface({
          avatarAssetRef,
          backendKind,
          previewMaterialRef,
          previewImageRef,
        }).previewSurfaceHandle;
        if (backendKind === 'live2d') {
          const surface = documentRef.querySelector('[data-avatar-live2d-carrier-status]');
          const status = surface?.getAttribute('data-avatar-live2d-carrier-status');
          const visiblePixels = readVisiblePixels(surface, 'data-avatar-live2d-carrier-visible-pixels');
          return service.resolvePreview({
            avatarAssetRef,
            backendKind,
            previewMaterialRef,
            previewSurfaceHandle: surfaceHandle,
            live2d: {
              status: status === 'ready' ? 'ready' : status === 'error' ? 'error' : 'pending',
              visiblePixels,
              reasonCode: surface?.getAttribute('data-avatar-live2d-carrier-error') || null,
            },
          });
        }
        const surface = documentRef.querySelector('[data-avatar-vrm-state]');
        const state = surface?.getAttribute('data-avatar-vrm-state');
        const visiblePixels = readVisiblePixels(surface, 'data-avatar-vrm-carrier-visible-pixels');
        return service.resolvePreview({
          avatarAssetRef,
          backendKind,
          previewMaterialRef,
          previewSurfaceHandle: surfaceHandle,
          vrm: {
            capabilityProfileRef: state === 'ready'
              ? `avatar.vrm.capability-profile:${avatarAssetRef}`
              : null,
            visiblePixels,
            failureReason: state === 'failed_closed'
              ? 'VRM preview renderer failed closed.'
              : 'VRM preview renderer has not produced visible output.',
          },
        });
      } catch (error) {
        return failedResult(
          request,
          previewMaterialRef,
          'host_internal_error',
          error instanceof Error && error.message.trim()
            ? `Avatar preview carrier failed: ${error.message}`
            : 'Avatar preview carrier failed with an internal error.',
        );
      } finally {
        if (surfaceHandle) service.unregisterPreviewSurface(surfaceHandle);
      }
    },
  });
}

export async function installAvatarAgentCenterPreviewHandoff(input: {
  readonly getContext: () => PreviewHandoffContext;
  readonly listen?: typeof listenAvatarHostEvent;
  readonly invoke?: typeof invokeAvatarHostCommand;
  readonly service?: AgentCenterAvatarPreviewService;
  readonly document?: Pick<Document, 'querySelector'>;
}): Promise<ShellEventUnsubscribe> {
  const handoff = createAvatarAgentCenterPreviewHandoff(input);
  const listen = input.listen ?? listenAvatarHostEvent;
  const invoke = input.invoke ?? invokeAvatarHostCommand;
  return listen<AvatarAgentCenterPreviewRequest>(
    AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT,
    (request) => {
      const result = handoff.handleRequest(request);
      void invoke(AVATAR_AGENT_CENTER_PREVIEW_COMPLETE_COMMAND, {
        requestId: normalizeText(request.requestId),
        result,
      }).catch(() => undefined);
    },
  );
}

function readVisiblePixels(element: Element | null, attribute: string): number | null {
  const value = Number(element?.getAttribute(attribute));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function failedResult(
  request: Pick<AvatarAgentCenterPreviewRequest, 'avatarAssetRef' | 'backendKind'>,
  previewMaterialRef: string | null,
  reasonCode: 'invalid_manifest' | 'host_internal_error',
  reason: string,
): AgentCenterAvatarPreviewServiceResolveResult {
  return {
    state: 'failed',
    tier: 'avatar_preview_service',
    avatarAssetRef: normalizeText(request.avatarAssetRef) || null,
    backendKind: request.backendKind === 'live2d' || request.backendKind === 'vrm' ? request.backendKind : null,
    previewMaterialRef: normalizeText(previewMaterialRef) || null,
    previewImageRef: null,
    visiblePixels: null,
    nonPlaceholder: false,
    reasonCode,
    reason,
    warnings: [],
  };
}

function unavailableResult(
  request: Pick<AvatarAgentCenterPreviewRequest, 'avatarAssetRef' | 'backendKind'>,
  previewMaterialRef: string | null,
  reason: string,
): AgentCenterAvatarPreviewServiceResolveResult {
  return {
    state: 'unavailable',
    tier: 'avatar_preview_service',
    avatarAssetRef: normalizeText(request.avatarAssetRef) || null,
    backendKind: request.backendKind === 'live2d' || request.backendKind === 'vrm' ? request.backendKind : null,
    previewMaterialRef: normalizeText(previewMaterialRef) || null,
    previewImageRef: null,
    visiblePixels: null,
    nonPlaceholder: false,
    reasonCode: 'capability_unavailable',
    reason,
    warnings: [],
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
