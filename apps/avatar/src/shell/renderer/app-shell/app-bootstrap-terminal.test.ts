import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAvatarStore } from './app-store.js';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  sessionStatus: vi.fn(),
  presentationSnapshot: vi.fn(),
  createDriver: vi.fn(),
  resolveAsset: vi.fn(),
}));

vi.mock('./avatar-host-bridge.js', () => ({ invokeAvatarHostCommand: mocks.invoke }));
vi.mock('./app-bootstrap-helpers.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./app-bootstrap-helpers.js')>(),
  installAvatarRuntimeBridge: () => ({ installed: true }),
  waitForAvatarLaunchContext: async () => ({
    avatarInstanceId: 'pending-avatar',
    agentHandle: 'launch-handle',
    conversationAnchorId: 'conversation-anchor',
    launchSource: 'zhiyu',
  }),
}));
vi.mock('./avatar-local-app-client.js', () => ({
  getAvatarLocalAppClient: () => ({
    auth: { status: mocks.sessionStatus },
    agents: { listReferences: async () => [{ agentHandle: 'avatar-session-handle' }] },
    conversation: {
      snapshot: async () => ({ conversationAnchorId: 'conversation-anchor' }),
      open: async () => ({ conversationAnchorId: 'conversation-anchor' }),
    },
    agentConfigure: { presentation: { snapshot: mocks.presentationSnapshot } },
  }),
}));
vi.mock('../driver/factory.js', () => ({
  resolveDriverKind: () => 'sdk',
  createDriver: mocks.createDriver,
}));
vi.mock('../carrier/model-resolver.js', () => ({
  resolveRuntimePresentationAvatarAsset: mocks.resolveAsset,
  releaseRuntimePresentationMaterializationLease: vi.fn(),
  commitRuntimePresentationMaterializationLease: vi.fn(),
}));
vi.mock('./device-tier-detector.js', () => ({ detectDeviceTier: vi.fn() }));

import { bootstrapAvatar } from './app-bootstrap.js';

function abortCalls() {
  return mocks.invoke.mock.calls.filter(([command]) => command === 'nimi_avatar_abort_pending_launch');
}

describe('bootstrap terminal launch abandonment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAvatarStore.setState(useAvatarStore.getInitialState(), true);
    mocks.invoke.mockResolvedValue({ accepted: true });
    mocks.sessionStatus.mockResolvedValue({ sessionBound: true });
    mocks.presentationSnapshot.mockResolvedValue({ profile: null, presentationRevision: null });
  });

  it('abandons missing presentation after the actual current-session binding refresh', async () => {
    const handle = await bootstrapAvatar();

    expect(mocks.invoke.mock.calls).toEqual([
      ['nimi_avatar_refresh_host_binding', {
        agentHandle: 'avatar-session-handle', conversationAnchorId: 'conversation-anchor',
      }],
      ['nimi_avatar_abort_pending_launch', {
        agentHandle: 'avatar-session-handle', conversationAnchorId: 'conversation-anchor',
      }],
    ]);
    expect(mocks.createDriver).not.toHaveBeenCalled();
    expect(mocks.resolveAsset).not.toHaveBeenCalled();
    expect(handle.carrier).toBeNull();
    expect(useAvatarStore.getState().runtime.binding).toMatchObject({
      status: 'unavailable', reasonCode: 'RUNTIME_AGENT_PRESENTATION_ASSET_NOT_CONFIGURED',
    });
    await handle.abortPendingLaunch();
    expect(abortCalls()).toHaveLength(1);
    await handle.shutdown();
  });

  it('abandons a bound launch when formal session initialization throws, without sending the error', async () => {
    mocks.sessionStatus.mockRejectedValueOnce(new Error('private session diagnostic'));
    const handle = await bootstrapAvatar();

    expect(abortCalls()).toEqual([['nimi_avatar_abort_pending_launch', {
      agentHandle: 'launch-handle', conversationAnchorId: 'conversation-anchor',
    }]]);
    expect(mocks.presentationSnapshot).not.toHaveBeenCalled();
    expect(handle.driver).toBeNull();
    expect(useAvatarStore.getState().runtime.binding.status).toBe('unavailable');
    await handle.shutdown();
  });

  it('abandons a failed presentation lookup with the refreshed binding', async () => {
    mocks.presentationSnapshot.mockRejectedValueOnce(new Error('private presentation diagnostic'));
    const handle = await bootstrapAvatar();

    expect(abortCalls()).toEqual([['nimi_avatar_abort_pending_launch', {
      agentHandle: 'avatar-session-handle', conversationAnchorId: 'conversation-anchor',
    }]]);
    expect(mocks.resolveAsset).not.toHaveBeenCalled();
    expect(useAvatarStore.getState().runtime.binding).toMatchObject({
      status: 'unavailable', stage: 'runtime_presentation_profile',
    });
    await handle.shutdown();
  });

  it.each(['missing profile', 'lookup error'] as const)(
    'does not send abandonment when %s arrives after its bootstrap scope was cancelled',
    async (outcome) => {
      let finish!: () => void;
      let reached!: () => void;
      const lookupStarted = new Promise<void>((resolve) => { reached = resolve; });
      mocks.presentationSnapshot.mockImplementationOnce(() => {
        reached();
        return new Promise((resolve, reject) => {
          finish = () => outcome === 'missing profile'
            ? resolve({ profile: null, presentationRevision: null })
            : reject(new Error('late failed lookup'));
        });
      });
      const scope = new AbortController();
      const bootstrap = bootstrapAvatar({ signal: scope.signal });
      await lookupStarted;
      scope.abort();
      finish();
      const handle = await bootstrap;

      expect(abortCalls()).toEqual([]);
      await handle.abortPendingLaunch();
      expect(abortCalls()).toEqual([]);
      expect(mocks.createDriver).not.toHaveBeenCalled();
      await handle.shutdown();
    },
  );
});
