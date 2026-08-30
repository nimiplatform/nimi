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
import {
  AvatarPresentationActivationMismatchError,
  isAvatarPresentationActivationMismatchError,
} from '../app-shell/live-presentation-swap.js';
import type { AvatarCommittedPresentationActivation } from '../app-shell/app-bootstrap-types.js';

export const AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT = 'avatar://agent-center-preview-request';
export const AVATAR_AGENT_CENTER_PREVIEW_COMPLETE_COMMAND = 'nimi_avatar_agent_center_preview_complete';

export type AvatarAgentCenterPreviewRequest = {
  readonly requestId: string;
  readonly conversationAnchorId: string;
  readonly avatarAssetRef: string;
  readonly backendKind: 'live2d' | 'vrm';
  readonly presentationRevision: string;
};

type PreviewHandoffContext = {
  readonly agentHandle: string | null;
  readonly conversationAnchorId: string | null;
  readonly carrier: AvatarRuntimeCarrier | null;
};

export type AvatarAgentCenterPreviewHandoff = {
  readonly handleRequest: (
    request: AvatarAgentCenterPreviewRequest,
  ) => Promise<AgentCenterAvatarPreviewServiceResolveResult>;
};

const AVATAR_PREVIEW_RENDERER_READINESS_TIMEOUT_MS = 3_000;
const AVATAR_PREVIEW_RENDERER_READINESS_POLL_MS = 50;

export function createAvatarAgentCenterPreviewHandoff(input: {
  readonly service?: AgentCenterAvatarPreviewService;
  readonly getContext: () => PreviewHandoffContext;
  readonly activatePresentation?: (request: AvatarCommittedPresentationActivation) => Promise<void>;
  readonly document?: Pick<Document, 'querySelector'>;
  readonly readinessTimeoutMs?: number;
  readonly wait?: (delayMs: number) => Promise<void>;
}): AvatarAgentCenterPreviewHandoff {
  const service = input.service ?? createAgentCenterAvatarPreviewService();
  return Object.freeze({
    async handleRequest(request) {
      const requestId = normalizeText(request.requestId);
      const conversationAnchorId = normalizeText(request.conversationAnchorId);
      const avatarAssetRef = normalizeText(request.avatarAssetRef);
      const presentationRevision = normalizeText(request.presentationRevision);
      const backendKind = request.backendKind;
      if (!requestId || !conversationAnchorId || !avatarAssetRef || !presentationRevision
        || (backendKind !== 'live2d' && backendKind !== 'vrm')) {
        return failedResult(request, null, 'invalid_manifest', 'Avatar preview carrier received an invalid projection request.');
      }
      let context = input.getContext();
      if (!context.carrier) {
        return unavailableResult(request, null, 'Avatar preview carrier is not available.');
      }
      if (normalizeText(context.conversationAnchorId) !== conversationAnchorId) {
        return failedResult(request, null, 'invalid_manifest', 'Avatar preview request does not match the active Conversation anchor.');
      }
      let selection = context.carrier.committedPresentationSelection;
      if (!selectionMatches(context.carrier, request)) {
        if (!input.activatePresentation) {
          return failedResult(request, selection?.previewMaterialRef ?? null, 'invalid_manifest', 'Avatar committed-effect request does not match the current committed presentation.');
        }
        try {
          await input.activatePresentation({
            agentHandle: normalizeText(context.agentHandle),
            avatarAssetRef,
            backendKind,
            presentationRevision,
          });
        } catch (error) {
          return failedResult(
            request,
            selection?.previewMaterialRef ?? null,
            isAvatarPresentationActivationMismatchError(error) ? 'invalid_manifest' : 'host_internal_error',
            error instanceof Error && error.message.trim()
              ? `Avatar presentation replacement failed: ${error.message}`
              : 'Avatar presentation replacement failed.',
          );
        }
        context = input.getContext();
        selection = context.carrier?.committedPresentationSelection ?? null;
        if (normalizeText(context.conversationAnchorId) !== conversationAnchorId
          || !context.carrier
          || !selectionMatches(context.carrier, request)) {
          return failedResult(request, selection?.previewMaterialRef ?? null, 'invalid_manifest', 'Avatar replacement carrier does not match the committed presentation.');
        }
      }
      const previewMaterialRef = selection!.previewMaterialRef;
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
        await waitForRendererReadiness({
          request,
          document: documentRef,
          getContext: input.getContext,
          timeoutMs: input.readinessTimeoutMs ?? AVATAR_PREVIEW_RENDERER_READINESS_TIMEOUT_MS,
          wait: input.wait ?? waitForDelay,
        });
        if (backendKind === 'live2d') {
          const surface = documentRef.querySelector('[data-avatar-live2d-carrier-status]');
          const status = surface?.getAttribute('data-avatar-live2d-carrier-status');
          return service.resolvePreview({
            avatarAssetRef,
            backendKind,
            previewMaterialRef,
            previewSurfaceHandle: surfaceHandle,
            live2d: {
              status: status === 'ready' ? 'ready' : status === 'error' ? 'error' : 'pending',
              reasonCode: surface?.getAttribute('data-avatar-live2d-carrier-error') || null,
            },
          });
        }
        const surface = documentRef.querySelector('[data-avatar-vrm-state]');
        const state = surface?.getAttribute('data-avatar-vrm-state');
        const capabilityProfileRef = surface?.getAttribute(
          'data-avatar-vrm-capability-profile-ref',
        )?.trim() || null;
        return service.resolvePreview({
          avatarAssetRef,
          backendKind,
          previewMaterialRef,
          previewSurfaceHandle: surfaceHandle,
          vrm: {
            capabilityProfileRef: state === 'ready' ? capabilityProfileRef : null,
            failureReason: state === 'failed_closed'
              ? 'VRM preview renderer failed closed.'
              : 'VRM preview renderer has not produced visible output.',
          },
        });
      } catch (error) {
        return failedResult(
          request,
          previewMaterialRef,
          isAvatarPresentationActivationMismatchError(error) ? 'invalid_manifest' : 'host_internal_error',
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
  readonly activatePresentation?: (request: AvatarCommittedPresentationActivation) => Promise<void>;
  readonly readinessTimeoutMs?: number;
}): Promise<ShellEventUnsubscribe> {
  const handoff = createAvatarAgentCenterPreviewHandoff(input);
  const listen = input.listen ?? listenAvatarHostEvent;
  const invoke = input.invoke ?? invokeAvatarHostCommand;
  return listen<AvatarAgentCenterPreviewRequest>(
    AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT,
    (request) => {
      void handoff.handleRequest(request).then((result) => (
        invoke(AVATAR_AGENT_CENTER_PREVIEW_COMPLETE_COMMAND, {
          requestId: normalizeText(request.requestId),
          result,
        })
      )).catch(() => undefined);
    },
  );
}

async function waitForRendererReadiness(input: {
  readonly request: AvatarAgentCenterPreviewRequest;
  readonly document: Pick<Document, 'querySelector'>;
  readonly getContext: () => PreviewHandoffContext;
  readonly timeoutMs: number;
  readonly wait: (delayMs: number) => Promise<void>;
}): Promise<void> {
  const timeoutMs = Math.max(0, Math.min(4_000, Math.floor(input.timeoutMs)));
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const context = input.getContext();
    if (normalizeText(context.conversationAnchorId) !== normalizeText(input.request.conversationAnchorId)
      || !context.carrier
      || !selectionMatches(context.carrier, input.request)) {
      throw new AvatarPresentationActivationMismatchError(
        'Avatar presentation changed while renderer readiness was pending.',
      );
    }
    const root = input.document.querySelector(
      '[data-avatar-presentation-asset-ref][data-avatar-presentation-backend][data-avatar-presentation-revision]',
    );
    const rootMatches = root?.getAttribute('data-avatar-presentation-asset-ref') === input.request.avatarAssetRef
      && root.getAttribute('data-avatar-presentation-backend') === input.request.backendKind
      && root.getAttribute('data-avatar-presentation-revision') === input.request.presentationRevision
      && root.getAttribute('data-avatar-presentation-state') === 'ready';
    if (rootMatches && rendererIsTerminal(input.document, input.request.backendKind)) return;
    if (Date.now() >= deadline) {
      throw new Error('Avatar preview renderer did not bind the exact committed presentation before the deadline.');
    }
    await input.wait(Math.min(AVATAR_PREVIEW_RENDERER_READINESS_POLL_MS, Math.max(0, deadline - Date.now())));
  }
}

function rendererIsTerminal(
  documentRef: Pick<Document, 'querySelector'>,
  backendKind: 'live2d' | 'vrm',
): boolean {
  if (backendKind === 'live2d') {
    const surface = documentRef.querySelector('[data-avatar-live2d-carrier-status]');
    const status = surface?.getAttribute('data-avatar-live2d-carrier-status');
    return status === 'ready' || status === 'error';
  }
  const surface = documentRef.querySelector('[data-avatar-vrm-state]');
  const state = surface?.getAttribute('data-avatar-vrm-state');
  return state === 'ready' || state === 'failed_closed';
}

function selectionMatches(
  carrier: AvatarRuntimeCarrier,
  request: AvatarAgentCenterPreviewRequest,
): boolean {
  const selection = carrier.committedPresentationSelection;
  return selection?.avatarAssetRef === normalizeText(request.avatarAssetRef)
    && selection.backendKind === request.backendKind
    && selection.presentationRevision === normalizeText(request.presentationRevision)
    && carrier.backend.kind === request.backendKind;
}

function waitForDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
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
    reasonCode: 'capability_unavailable',
    reason,
    warnings: [],
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
