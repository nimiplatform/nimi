// Show the on-duty agent through the shared Avatar Host. NimiDay never
// renders an avatar or keeps its own presence; Desktop and Runtime own it.

import {
  buildAvatarHostHandoffRequest,
  buildAvatarLaunchInstanceId,
  invokeAvatarHostHandoff,
  type AvatarHostHandoffResult,
} from '@nimiplatform/kit/features/avatar/headless';
import { invokeAvatarHostHandoffMechanic } from '@nimiplatform/kit/shell/renderer/bridge';

export type AvatarOutcome =
  | { readonly kind: 'shown'; readonly state: AvatarHostHandoffResult['state'] }
  | { readonly kind: 'declined' }
  | { readonly kind: 'failed'; readonly reason: string };

const port = { invoke: (request: Parameters<typeof invokeAvatarHostHandoffMechanic>[0]) => invokeAvatarHostHandoffMechanic(request) };

function reasonOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as { reasonCode?: unknown; code?: unknown; message?: unknown };
    const reason = record.reasonCode ?? record.code ?? record.message;
    if (typeof reason === 'string' && reason) return reason;
  }
  return error instanceof Error ? error.message : 'avatar-handoff-failed';
}

export async function showAgentAvatar(input: {
  readonly agentHandle: string;
  readonly conversationAnchorId: string;
  /** Asked when another companion already occupies the desktop. */
  readonly confirmSwitch: () => Promise<boolean>;
}): Promise<AvatarOutcome> {
  try {
    const target = (switchIntentRef: string | null) => ({
      agentHandle: input.agentHandle,
      conversationAnchorId: input.conversationAnchorId,
      avatarInstanceId: buildAvatarLaunchInstanceId({ agentHandle: input.agentHandle, sourceSurface: 'nimiday' }),
      launchSource: 'nimiday',
      switchIntentRef,
      committedPresentationRef: null,
      temporaryCustodyRef: null,
    });
    let result = await invokeAvatarHostHandoff(port, buildAvatarHostHandoffRequest({ command: 'launch', target: target(null) }));
    if (result.state === 'confirmation-required') {
      if (!(await input.confirmSwitch())) return { kind: 'declined' };
      result = await invokeAvatarHostHandoff(port, buildAvatarHostHandoffRequest({ command: 'launch', target: target(result.switchIntentRef) }));
    }
    if (result.state === 'present' || result.state === 'focused' || result.state === 'launching') {
      return { kind: 'shown', state: result.state };
    }
    return { kind: 'failed', reason: `avatar-${result.state}` };
  } catch (error) {
    return { kind: 'failed', reason: reasonOf(error) };
  }
}
