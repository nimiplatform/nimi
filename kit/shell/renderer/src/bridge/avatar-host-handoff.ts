import type { AvatarHostHandoffRequest } from '@nimiplatform/kit/features/avatar/headless';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { invoke } from './invoke.js';
import type { JsonObject } from './types.js';

/** Renderer transport only; the Avatar feature contract validates both ends. */
export function invokeAvatarHostHandoffMechanic(
  request: AvatarHostHandoffRequest,
): Promise<unknown> {
  return invoke(
    NIMI_STANDARD_SHELL_COMMANDS['avatar.hostHandoff'],
    { payload: request as unknown as JsonObject },
  );
}
