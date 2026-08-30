import {
  parseAvatarRendererLaunchContext,
  type AvatarRendererLaunchContext,
} from '@nimiplatform/kit/features/avatar/headless';
import { invokeAvatarHostCommand } from '../app-shell/avatar-host-bridge.js';

export type AvatarLaunchContext = AvatarRendererLaunchContext;

export function parseAvatarLaunchContext(value: unknown): AvatarLaunchContext {
  return parseAvatarRendererLaunchContext(value);
}

export async function getAvatarLaunchContext(): Promise<AvatarLaunchContext> {
  const payload = await invokeAvatarHostCommand('nimi_avatar_get_launch_context');
  return parseAvatarLaunchContext(payload);
}

export async function refreshAvatarHostBinding(input: Readonly<{
  agentHandle: string;
  conversationAnchorId: string;
}>): Promise<void> {
  const result = await invokeAvatarHostCommand<unknown>('nimi_avatar_refresh_host_binding', input);
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || Object.keys(result).length !== 1
    || (result as Record<string, unknown>).accepted !== true) {
    throw new Error('Avatar Host did not accept the current-session binding.');
  }
}
