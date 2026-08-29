import { invokeAvatarHostHandoffMechanic } from '@nimiplatform/kit/shell/renderer/bridge';
import type {
  AvatarHostHandoffPort,
  AvatarHostHandoffRequest,
} from '@nimiplatform/kit/features/avatar/headless';

// Transport adapter only: the Desktop Host owns process/window mechanics and
// the common Kit contract owns request/result validation.
export function createZhiyuAvatarHostHandoffPort(
  invokeHost: (request: AvatarHostHandoffRequest) => Promise<unknown> = invokeAvatarHostHandoffMechanic,
): AvatarHostHandoffPort {
  return Object.freeze({
    invoke(request: AvatarHostHandoffRequest) {
      return invokeHost(request);
    },
  });
}
