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
const request: AvatarAgentCenterPreviewRequest = {
  requestId: 'request-1',
  agentHandle: `agent_ref_${'a'.repeat(43)}`,
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
  return {
    querySelector: () => ({
      getAttribute: (name: string) => attributes[name] ?? null,
    }) as Element,
  };
}

describe('Avatar Agent Center preview handoff', () => {
  it('reports render evidence for the current committed presentation', () => {
    const handoff = createAvatarAgentCenterPreviewHandoff({
      getContext: () => ({ agentHandle: request.agentHandle, carrier: carrier() }),
      document: surface({
        'data-avatar-live2d-carrier-status': 'ready',
        'data-avatar-live2d-carrier-visible-pixels': '42',
      }),
    });

    expect(handoff.handleRequest(request)).toEqual({
      state: 'ready',
      tier: 'avatar_preview_service',
      avatarAssetRef: request.avatarAssetRef,
      backendKind: 'live2d',
      previewMaterialRef: PREVIEW_MATERIAL_REF,
      previewImageRef: '/__nimi/avatar-preview/request-1.png',
      visiblePixels: 42,
      nonPlaceholder: true,
      warnings: ['avatar_preview_service:live2d'],
    });
  });

  it('fails closed when the committed Avatar material does not match the request', () => {
    const handoff = createAvatarAgentCenterPreviewHandoff({
      getContext: () => ({
        agentHandle: request.agentHandle,
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

    expect(handoff.handleRequest(request)).toMatchObject({
      state: 'failed',
      reasonCode: 'invalid_manifest',
      nonPlaceholder: false,
    });
  });

  it('fails closed when the canonical presentation revision is stale', () => {
    const handoff = createAvatarAgentCenterPreviewHandoff({
      getContext: () => ({ agentHandle: request.agentHandle, carrier: carrier() }),
      document: surface({}),
    });
    expect(handoff.handleRequest({ ...request, presentationRevision: '6' })).toMatchObject({
      state: 'failed',
      reasonCode: 'invalid_manifest',
      nonPlaceholder: false,
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
      getContext: () => ({ agentHandle: request.agentHandle, carrier: carrier() }),
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
