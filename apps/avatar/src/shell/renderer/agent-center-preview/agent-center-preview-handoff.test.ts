import { describe, expect, it, vi } from 'vitest';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import {
  AVATAR_AGENT_CENTER_PREVIEW_COMPLETE_COMMAND,
  AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT,
  AVATAR_AGENT_CENTER_PREVIEW_CANCEL_EVENT,
  createAvatarAgentCenterPreviewHandoff,
  installAvatarAgentCenterPreviewHandoff,
  type AvatarAgentCenterPreviewRequest,
} from './agent-center-preview-handoff.js';

const PREVIEW_MATERIAL_REF = 'avatar-materialization:live2d:live2d_111111111111';
const AVATAR_HANDLE = `agent_ref_${'a'.repeat(43)}`;
const request: AvatarAgentCenterPreviewRequest = {
  requestId: 'request-1',
  conversationAnchorId: 'agent_anchor_preview_current',
  avatarAssetRef: 'live2d_111111111111',
  backendKind: 'live2d',
  presentationRevision: '7',
};

function carrier(overrides: Partial<AvatarRuntimeCarrier> = {}): AvatarRuntimeCarrier {
  return {
    committedPresentationSelection: {
      avatarAssetRef: request.avatarAssetRef,
      backendKind: request.backendKind,
      previewMaterialRef: PREVIEW_MATERIAL_REF,
      presentationRevision: request.presentationRevision,
    },
    backend: { kind: 'live2d' },
    ...overrides,
  } as AvatarRuntimeCarrier;
}

function surface(attributes: Readonly<Record<string, string>>): Pick<Document, 'querySelector'> {
  const rootAttributes: Readonly<Record<string, string>> = {
    'data-avatar-presentation-asset-ref': request.avatarAssetRef,
    'data-avatar-presentation-backend': request.backendKind,
    'data-avatar-presentation-revision': request.presentationRevision,
    'data-avatar-presentation-state': 'ready',
    ...attributes,
  };
  return {
    querySelector: (selector: string) => ({
      getAttribute: (name: string) => (
        selector === '[data-avatar-presentation-asset-ref][data-avatar-presentation-backend][data-avatar-presentation-revision]'
          ? rootAttributes[name]
          : attributes[name]
      ) ?? null,
    }) as Element,
  };
}

describe('Avatar Agent Center preview handoff', () => {
  it('cancels a renderer-readiness observation without waiting for the next poll', async () => {
    const scope = new AbortController();
    const wait = vi.fn(() => new Promise<void>(() => {}));
    const handoff = createAvatarAgentCenterPreviewHandoff({
      getContext: () => ({ agentHandle: AVATAR_HANDLE, conversationAnchorId: request.conversationAnchorId, carrier: carrier() }),
      document: surface({ 'data-avatar-live2d-carrier-status': 'pending' }), wait,
    });
    const pending = handoff.handleRequest(request, scope.signal);
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
    scope.abort();
    await expect(pending).resolves.toMatchObject({ state: 'unavailable', previewImageRef: null });
    expect(wait).toHaveBeenCalledOnce();
  });

  it('bounds renderer observation to three seconds even when a caller asks for longer', async () => {
    vi.useFakeTimers();
    try {
      const handoff = createAvatarAgentCenterPreviewHandoff({
        getContext: () => ({ agentHandle: AVATAR_HANDLE, conversationAnchorId: request.conversationAnchorId, carrier: carrier() }),
        document: surface({ 'data-avatar-live2d-carrier-status': 'pending' }), readinessTimeoutMs: 9000,
      });
      let result: Awaited<ReturnType<typeof handoff.handleRequest>> | undefined;
      void handoff.handleRequest(request).then(value => { result = value; });
      await vi.advanceTimersByTimeAsync(3000);
      expect(result).toMatchObject({ state: 'failed', previewImageRef: null });
    } finally { vi.clearAllTimers(); vi.useRealTimers(); }
  });

  it.each(['host-cancel', 'scope-loss'] as const)('reports %s immediately while activation is pending and never reports its late result twice', async (reason) => {
    const listeners = new Map<string, (payload: never) => void>();
    const unlisten = vi.fn();
    const scope = new AbortController();
    const invoke = vi.fn(async () => undefined);
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    let active = carrier({ committedPresentationSelection: { ...carrier().committedPresentationSelection!, presentationRevision: '6' } });
    let activationSignal: AbortSignal | undefined;
    const activate = vi.fn(async (input: { signal: AbortSignal }) => { activationSignal = input.signal; await gate; });
    const release = await installAvatarAgentCenterPreviewHandoff({
      signal: scope.signal,
      getContext: () => ({ agentHandle: AVATAR_HANDLE, conversationAnchorId: request.conversationAnchorId, carrier: active }),
      document: surface({ 'data-avatar-live2d-carrier-status': 'ready' }),
      activatePresentation: activate,
      listen: (async (name: string, callback: (payload: never) => void) => { listeners.set(name, callback); return unlisten; }) as never,
      invoke: invoke as never,
    });
    try {
      listeners.get(AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT)!(request as never);
      expect(activate).toHaveBeenCalledOnce();
      if (reason === 'host-cancel') listeners.get(AVATAR_AGENT_CENTER_PREVIEW_CANCEL_EVENT)!({ requestId: request.requestId } as never);
      else scope.abort();
      expect(activationSignal?.aborted).toBe(true);
      expect(invoke).toHaveBeenCalledExactlyOnceWith(AVATAR_AGENT_CENTER_PREVIEW_COMPLETE_COMMAND,
        expect.objectContaining({ requestId: request.requestId, result: expect.objectContaining({ state: 'unavailable', previewImageRef: null }) }));
      if (reason === 'host-cancel') {
        active = carrier();
        listeners.get(AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT)!({ ...request, requestId: 'request-next' } as never);
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
        expect(invoke.mock.calls[1]).toEqual([AVATAR_AGENT_CENTER_PREVIEW_COMPLETE_COMMAND,
          expect.objectContaining({ requestId: 'request-next', result: expect.objectContaining({ state: 'ready' }) })]);
      }
      const count = invoke.mock.calls.length;
      finish(); await gate; await Promise.resolve(); await Promise.resolve();
      expect(invoke).toHaveBeenCalledTimes(count);
    } finally { finish(); release(); }
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it('releases listener registrations that arrive after the owner scope was cancelled', async () => {
    const scope = new AbortController();
    const completions: Array<(unlisten: () => void) => void> = [];
    const unlisten = vi.fn();
    const pending = installAvatarAgentCenterPreviewHandoff({ signal: scope.signal,
      getContext: () => ({ agentHandle: AVATAR_HANDLE, conversationAnchorId: request.conversationAnchorId, carrier: carrier() }),
      listen: (() => new Promise<() => void>(resolve => { completions.push(resolve); })) as never,
    });
    scope.abort();
    const release = await pending;
    for (const complete of completions) complete(unlisten);
    await Promise.resolve(); await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(2);
    release();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it('reports render evidence for the current committed presentation', async () => {
    const handoff = createAvatarAgentCenterPreviewHandoff({
      getContext: () => ({ agentHandle: AVATAR_HANDLE, conversationAnchorId: request.conversationAnchorId, carrier: carrier() }),
      document: surface({
        'data-avatar-live2d-carrier-status': 'ready',
      }),
    });

    await expect(handoff.handleRequest(request)).resolves.toEqual({
      state: 'ready',
      tier: 'avatar_preview_service',
      avatarAssetRef: request.avatarAssetRef,
      backendKind: 'live2d',
      previewMaterialRef: PREVIEW_MATERIAL_REF,
      previewImageRef: '/__nimi/avatar-preview/request-1.png',
      warnings: ['avatar_preview_service:live2d'],
    });
  });

  it('does not synthesize a VRM capability profile ref from an asset ref', async () => {
    const vrmRequest: AvatarAgentCenterPreviewRequest = {
      ...request,
      avatarAssetRef: 'vrm_222222222222',
      backendKind: 'vrm',
    };
    const vrmCarrier = carrier({
      committedPresentationSelection: {
        avatarAssetRef: vrmRequest.avatarAssetRef,
        backendKind: 'vrm',
        previewMaterialRef: 'avatar-materialization:vrm:vrm_222222222222',
        presentationRevision: vrmRequest.presentationRevision,
      },
      backend: { kind: 'vrm' },
    } as Partial<AvatarRuntimeCarrier>);
    const documentRef: Pick<Document, 'querySelector'> = {
      querySelector: (selector: string) => ({
        getAttribute: (name: string) => (
          selector === '[data-avatar-presentation-asset-ref][data-avatar-presentation-backend][data-avatar-presentation-revision]'
            ? {
                'data-avatar-presentation-asset-ref': vrmRequest.avatarAssetRef,
                'data-avatar-presentation-backend': vrmRequest.backendKind,
                'data-avatar-presentation-revision': vrmRequest.presentationRevision,
                'data-avatar-presentation-state': 'ready',
              }[name]
            : { 'data-avatar-vrm-state': 'ready' }[name]
        ) ?? null,
      }) as Element,
    };
    const handoff = createAvatarAgentCenterPreviewHandoff({
      getContext: () => ({
        agentHandle: AVATAR_HANDLE,
        conversationAnchorId: vrmRequest.conversationAnchorId,
        carrier: vrmCarrier,
      }),
      document: documentRef,
    });

    await expect(handoff.handleRequest(vrmRequest)).resolves.toMatchObject({
      state: 'failed',
      reasonCode: 'invalid_manifest',
    });
  });

  it('fails closed when the committed Avatar material does not match the request', async () => {
    const handoff = createAvatarAgentCenterPreviewHandoff({
      getContext: () => ({
        agentHandle: AVATAR_HANDLE,
        conversationAnchorId: request.conversationAnchorId,
        carrier: carrier({
          committedPresentationSelection: {
            avatarAssetRef: 'live2d_aaaaaaaaaaaa',
            backendKind: 'live2d',
            previewMaterialRef: 'avatar-materialization:live2d:live2d_aaaaaaaaaaaa',
            presentationRevision: request.presentationRevision,
          },
        }),
      }),
      document: surface({}),
    });

    await expect(handoff.handleRequest(request)).resolves.toMatchObject({
      state: 'failed',
      reasonCode: 'invalid_manifest',
    });
  });

  it('fails closed when the canonical presentation revision is stale', async () => {
    const handoff = createAvatarAgentCenterPreviewHandoff({
      getContext: () => ({ agentHandle: AVATAR_HANDLE, conversationAnchorId: request.conversationAnchorId, carrier: carrier() }),
      document: surface({}),
    });
    await expect(handoff.handleRequest({ ...request, presentationRevision: '6' })).resolves.toMatchObject({
      state: 'failed',
      reasonCode: 'invalid_manifest',
    });
  });

  it('activates a newly committed presentation before awaiting its renderer evidence', async () => {
    let activeCarrier = carrier({
      committedPresentationSelection: {
        avatarAssetRef: 'live2d_aaaaaaaaaaaa',
        backendKind: 'live2d',
        previewMaterialRef: 'avatar-materialization:live2d:live2d_aaaaaaaaaaaa',
        presentationRevision: '6',
      },
    });
    const activatePresentation = vi.fn(async () => {
      activeCarrier = carrier();
    });
    const handoff = createAvatarAgentCenterPreviewHandoff({
      getContext: () => ({ agentHandle: AVATAR_HANDLE, conversationAnchorId: request.conversationAnchorId, carrier: activeCarrier }),
      activatePresentation,
      document: surface({
        'data-avatar-live2d-carrier-status': 'ready',
      }),
    });

    await expect(handoff.handleRequest(request)).resolves.toMatchObject({
      state: 'ready',
      avatarAssetRef: request.avatarAssetRef,
    });
    expect(activatePresentation).toHaveBeenCalledWith({
      previewRequestId: request.requestId,
      signal: expect.any(AbortSignal),
      agentHandle: AVATAR_HANDLE,
      avatarAssetRef: request.avatarAssetRef,
      backendKind: request.backendKind,
      presentationRevision: request.presentationRevision,
    });
  });

  it('installs on the existing Avatar host event/command seam', async () => {
    let listener: ((payload: AvatarAgentCenterPreviewRequest) => void) | null = null;
    const invoke = vi.fn(async () => undefined);
    const unlisten = vi.fn();
    const listen = vi.fn(async (eventName: string, handler: (payload: AvatarAgentCenterPreviewRequest) => void) => {
      if (eventName === AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT) listener = handler;
      else expect(eventName).toBe(AVATAR_AGENT_CENTER_PREVIEW_CANCEL_EVENT);
      return unlisten;
    });
    const release = await installAvatarAgentCenterPreviewHandoff({
      getContext: () => ({ agentHandle: AVATAR_HANDLE, conversationAnchorId: request.conversationAnchorId, carrier: carrier() }),
      document: surface({
        'data-avatar-live2d-carrier-status': 'error',
        'data-avatar-live2d-carrier-error': 'render_failed',
      }),
      listen: listen as never,
      invoke: invoke as never,
    });

    expect(listener).not.toBeNull();
    (listener as unknown as (payload: AvatarAgentCenterPreviewRequest) => void)(request);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
      AVATAR_AGENT_CENTER_PREVIEW_COMPLETE_COMMAND,
      expect.objectContaining({
        requestId: request.requestId,
        result: expect.objectContaining({ state: 'failed', reasonCode: 'invalid_manifest' }),
      }),
    ));
    release();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the exact committed presentation never reaches the renderer root', async () => {
    const mismatchedDocument: Pick<Document, 'querySelector'> = {
      querySelector: (selector: string) => ({
        getAttribute: (name: string) => (
          selector === '[data-avatar-presentation-asset-ref][data-avatar-presentation-backend][data-avatar-presentation-revision]'
            ? {
                'data-avatar-presentation-asset-ref': 'live2d_aaaaaaaaaaaa',
                'data-avatar-presentation-backend': request.backendKind,
                'data-avatar-presentation-revision': '6',
                'data-avatar-presentation-state': 'ready',
              }[name]
            : { 'data-avatar-live2d-carrier-status': 'ready' }[name]
        ) ?? null,
      }) as Element,
    };
    const handoff = createAvatarAgentCenterPreviewHandoff({
      getContext: () => ({
        agentHandle: AVATAR_HANDLE,
        conversationAnchorId: request.conversationAnchorId,
        carrier: carrier(),
      }),
      document: mismatchedDocument,
      readinessTimeoutMs: 0,
    });

    await expect(handoff.handleRequest(request)).resolves.toMatchObject({
      state: 'failed',
      reasonCode: 'host_internal_error',
      previewImageRef: null,
    });
  });
});
