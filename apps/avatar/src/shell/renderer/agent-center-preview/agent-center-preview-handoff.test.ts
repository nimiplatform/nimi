import { describe, expect, it, vi } from 'vitest';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import {
  AVATAR_AGENT_CENTER_PREVIEW_COMPLETE_COMMAND,
  AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT,
  createAvatarAgentCenterPreviewHandoff,
  installAvatarAgentCenterPreviewHandoff,
  type AvatarAgentCenterPreviewRequest,
} from './agent-center-preview-handoff.js';

const PREVIEW_MATERIAL_REF = 'agent-center-avatar-asset:id_account:id_agent:live2d:live2d_111111111111';
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
    ...attributes,
  };
  return {
    querySelector: (selector: string) => ({
      getAttribute: (name: string) => (
        selector === '[data-testid="avatar-root"]' ? rootAttributes[name] : attributes[name]
      ) ?? null,
    }) as Element,
  };
}

describe('Avatar Agent Center preview handoff', () => {
  it('reports render evidence for the current committed presentation', async () => {
    const handoff = createAvatarAgentCenterPreviewHandoff({
      getContext: () => ({ agentHandle: AVATAR_HANDLE, conversationAnchorId: request.conversationAnchorId, carrier: carrier() }),
      document: surface({
        'data-avatar-live2d-carrier-status': 'ready',
        'data-avatar-live2d-carrier-visible-pixels': '42',
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

  it('fails closed when the committed Avatar material does not match the request', async () => {
    const handoff = createAvatarAgentCenterPreviewHandoff({
      getContext: () => ({
        agentHandle: AVATAR_HANDLE,
        conversationAnchorId: request.conversationAnchorId,
        carrier: carrier({
          committedPresentationSelection: {
            avatarAssetRef: 'live2d_aaaaaaaaaaaa',
            backendKind: 'live2d',
            previewMaterialRef: 'agent-center-avatar-asset:id_account:id_agent:live2d:live2d_aaaaaaaaaaaa',
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
        previewMaterialRef: 'agent-center-avatar-asset:id_account:id_agent:live2d:live2d_aaaaaaaaaaaa',
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
        'data-avatar-live2d-carrier-visible-pixels': '64',
      }),
    });

    await expect(handoff.handleRequest(request)).resolves.toMatchObject({
      state: 'ready',
      avatarAssetRef: request.avatarAssetRef,
    });
    expect(activatePresentation).toHaveBeenCalledWith({
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
      expect(eventName).toBe(AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT);
      listener = handler;
      return unlisten;
    });
    const release = await installAvatarAgentCenterPreviewHandoff({
      getContext: () => ({ agentHandle: AVATAR_HANDLE, conversationAnchorId: request.conversationAnchorId, carrier: carrier() }),
      document: surface({
        'data-avatar-live2d-carrier-status': 'error',
        'data-avatar-live2d-carrier-visible-pixels': '0',
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
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
