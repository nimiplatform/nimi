import { describe, expect, it, vi, beforeEach } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('./avatar-host-bridge.js', () => ({ invokeAvatarHostCommand: invoke }));
import { createAvatarPendingLaunchAbort } from './pending-launch-abort.js';

describe('pending launch abandonment', () => {
  beforeEach(() => { invoke.mockReset().mockResolvedValue({ accepted: true }); });

  it('only abandons one bound launch, with no renderer diagnostics or state', async () => {
    const launch = createAvatarPendingLaunchAbort();
    await launch.abort();
    expect(invoke).not.toHaveBeenCalled();
    const context = { agentHandle: 'current-handle', conversationAnchorId: 'current-anchor', avatarInstanceId: 'instance', launchSource: 'zhiyu' };
    launch.bind(context);
    await Promise.all([launch.abort(), launch.abort()]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('nimi_avatar_abort_pending_launch', {
      agentHandle: 'current-handle', conversationAnchorId: 'current-anchor',
    });
  });

  it('does not let an unmounted bootstrap abort its replacement', async () => {
    const scope = new AbortController();
    const launch = createAvatarPendingLaunchAbort(scope.signal);
    launch.bind({ agentHandle: 'old', conversationAnchorId: 'anchor' });
    scope.abort();
    await launch.abort();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('captures the exact accepted binding and never retargets an in-flight abort', async () => {
    let finish!: (value: { accepted: boolean }) => void;
    invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const launch = createAvatarPendingLaunchAbort();
    launch.bind({ agentHandle: 'old', conversationAnchorId: 'anchor' });
    launch.bind({ agentHandle: 'current', conversationAnchorId: 'anchor' });
    const pending = launch.abort();
    launch.bind({ agentHandle: 'newer', conversationAnchorId: 'anchor' });
    expect(invoke.mock.calls[0]?.[1]).toEqual({ agentHandle: 'current', conversationAnchorId: 'anchor' });
    finish({ accepted: false });
    await pending;
    await launch.abort();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('cleans up locally when the control channel fails, without inventing acknowledgement', async () => {
    invoke.mockRejectedValue(new Error('channel closed'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const launch = createAvatarPendingLaunchAbort();
      launch.bind({ agentHandle: 'handle', conversationAnchorId: 'anchor' });
      await launch.abort();
      launch.close();
      await launch.abort();
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledWith('[avatar:launch] Pending launch abort was not acknowledged.');
    } finally { warning.mockRestore(); }
  });
});
