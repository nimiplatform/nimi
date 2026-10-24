import { invokeAvatarHostCommand } from './avatar-host-bridge.js';

type LaunchBinding = Readonly<{ agentHandle: string; conversationAnchorId: string }>;

// @nimi-authority: rule.nimi.avatar.embodiment.r023
// This only asks the Host to abandon this window's pending launch. It carries
// no renderer state, backend diagnostic or lifecycle authority. The Host owns
// the decision; an already active window is left to its local recovery UI.
export function createAvatarPendingLaunchAbort(signal?: AbortSignal) {
  let binding: LaunchBinding | null = null;
  let closed = false;
  let pending: Promise<void> | null = null;
  return {
    bind(value: LaunchBinding) {
      if (!closed && !signal?.aborted) binding = Object.freeze({
        agentHandle: value.agentHandle,
        conversationAnchorId: value.conversationAnchorId,
      });
    },
    close() { closed = true; binding = null; },
    abort(): Promise<void> {
      if (pending) return pending;
      if (closed || signal?.aborted || !binding) return Promise.resolve();
      const captured = binding;
      pending = invokeAvatarHostCommand<{ accepted: boolean }>(
        'nimi_avatar_abort_pending_launch', captured,
      ).then((result) => {
        if (!result || Object.keys(result).length !== 1 || typeof result.accepted !== 'boolean') {
          throw new Error('Invalid pending-launch abort acknowledgement');
        }
      }).catch(() => {
        // Cleanup still runs. An unavailable control channel is not evidence
        // that the Host accepted the abort; its existing watchdog remains.
        console.warn('[avatar:launch] Pending launch abort was not acknowledged.');
      });
      return pending;
    },
  };
}
