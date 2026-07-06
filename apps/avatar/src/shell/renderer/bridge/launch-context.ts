import {
  parseAvatarLaunchHandoffPayload,
  type AvatarLaunchHandoffPayload,
} from '@nimiplatform/kit/features/avatar/headless';
import { invokeAvatarHostCommand } from '../app-shell/avatar-host-bridge.js';

export type AvatarLaunchContext = AvatarLaunchHandoffPayload;

export function parseAvatarLaunchContext(value: unknown): AvatarLaunchContext {
  return parseAvatarLaunchHandoffPayload(value);
}

export async function getAvatarLaunchContext(): Promise<AvatarLaunchContext> {
  const payload = await invokeAvatarHostCommand('nimi_avatar_get_launch_context');
  return parseAvatarLaunchContext(payload);
}
