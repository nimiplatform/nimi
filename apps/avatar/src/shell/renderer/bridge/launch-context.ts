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
