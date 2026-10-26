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
export const AVATAR_AGENT_CENTER_PREVIEW_CANCEL_EVENT = 'avatar://agent-center-preview-cancel';
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
    signal?: AbortSignal,
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
    async handleRequest(request, signal = new AbortController().signal) {
      const requestId = normalizeText(request.requestId);
      const conversationAnchorId = normalizeText(request.conversationAnchorId);
      const avatarAssetRef = normalizeText(request.avatarAssetRef);
      const presentationRevision = normalizeText(request.presentationRevision);
      const backendKind = request.backendKind;
      if (signal.aborted) return unavailableResult(request, null, 'Avatar preview observation was cancelled.');
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
            previewRequestId: requestId,
            signal,
            agentHandle: normalizeText(context.agentHandle),
            avatarAssetRef,
            backendKind,
            presentationRevision,
          });
        } catch (error) {
          if (signal.aborted) return unavailableResult(request, selection?.previewMaterialRef ?? null, 'Avatar preview observation was cancelled.');
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
      if (signal.aborted) return unavailableResult(request, previewMaterialRef, 'Avatar preview observation was cancelled.');
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
          wait: input.wait,
          signal,
        });
        signal.throwIfAborted();
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
        if (signal.aborted) return unavailableResult(request, previewMaterialRef, 'Avatar preview observation was cancelled.');
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
  readonly signal?: AbortSignal;
}): Promise<ShellEventUnsubscribe> {
  const handoff = createAvatarAgentCenterPreviewHandoff(input);
  const listen = input.listen ?? listenAvatarHostEvent;
  const invoke = input.invoke ?? invokeAvatarHostCommand;
  const scope = new AbortController();
  const requests = new Map<string, AbortController>();
  const unlisteners: ShellEventUnsubscribe[] = [];
  const release = () => {
    if (scope.signal.aborted) return;
    scope.abort();
    for (const controller of requests.values()) controller.abort();
    requests.clear();
    for (const unlisten of unlisteners) unlisten();
    unlisteners.length = 0;
    input.signal?.removeEventListener('abort', release);
  };
  input.signal?.addEventListener('abort', release, { once: true });
  if (input.signal?.aborted) { release(); return release; }
  let aborted!: () => void;
  const stopped = new Promise<void>(resolve => { aborted = resolve; scope.signal.addEventListener('abort', aborted, { once: true }); });
  const ownListener = async <T>(event: string, callback: (payload: T) => void) => {
    const unlisten = await listen<T>(event, callback);
    if (scope.signal.aborted) unlisten();
    else unlisteners.push(unlisten);
  };
  try {
    await Promise.race([Promise.all([
      ownListener<AvatarAgentCenterPreviewRequest>(AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT, request => {
        const requestId = normalizeText(request.requestId);
        if (scope.signal.aborted || !requestId || requests.has(requestId)) return;
        const controller = new AbortController();
        requests.set(requestId, controller);
        let reported = false;
        const report = (result: AgentCenterAvatarPreviewServiceResolveResult) => {
          if (reported) return;
          reported = true;
          void invoke(AVATAR_AGENT_CENTER_PREVIEW_COMPLETE_COMMAND, { requestId, result }).catch(() => undefined);
        };
        // Scope loss must revoke the Host's uncommitted lease work immediately,
        // even if renderer preparation or a Host owner read has not returned.
        controller.signal.addEventListener('abort', () => {
          report(unavailableResult(request, null, 'Avatar preview scope was cancelled.'));
        }, { once: true });
        void handoff.handleRequest(request, controller.signal).then(result => {
          if (!scope.signal.aborted && !controller.signal.aborted) {
            report(result);
          }
        }).catch(() => undefined).finally(() => {
          if (requests.get(requestId) === controller) requests.delete(requestId);
        });
      }),
      ownListener<{ requestId: string }>(AVATAR_AGENT_CENTER_PREVIEW_CANCEL_EVENT, request => {
        requests.get(normalizeText(request?.requestId))?.abort();
      }),
    ]), stopped]);
    return release;
  } catch (error) {
    release();
    throw error;
  } finally {
    scope.signal.removeEventListener('abort', aborted);
  }
}

async function waitForRendererReadiness(input: {
  readonly request: AvatarAgentCenterPreviewRequest;
  readonly document: Pick<Document, 'querySelector'>;
  readonly getContext: () => PreviewHandoffContext;
  readonly timeoutMs: number;
  readonly wait?: (delayMs: number) => Promise<void>;
  readonly signal: AbortSignal;
}): Promise<void> {
  const timeoutMs = Math.max(0, Math.min(AVATAR_PREVIEW_RENDERER_READINESS_TIMEOUT_MS, Math.floor(input.timeoutMs)));
  const deadline = Date.now() + timeoutMs;
  while (true) {
    input.signal.throwIfAborted();
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
    await waitForObservationDelay(
      Math.min(AVATAR_PREVIEW_RENDERER_READINESS_POLL_MS, Math.max(0, deadline - Date.now())),
      input.signal, input.wait,
    );
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

function waitForObservationDelay(delayMs: number, signal: AbortSignal, wait?: (delayMs: number) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) globalThis.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error !== undefined) reject(error); else resolve();
    };
    const abort = () => finish(new Error('Avatar preview observation was cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    if (wait) {
      void Promise.resolve().then(() => settled ? undefined : wait(delayMs)).then(() => finish(), finish);
    } else timer = globalThis.setTimeout(() => finish(), delayMs);
  });
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
