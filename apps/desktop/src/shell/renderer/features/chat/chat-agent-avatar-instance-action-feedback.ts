export type AgentAvatarInstanceLaunchFeedback =
  | { outcome: 'confirmed' }
  | { outcome: 'unconfirmed' };

export type AgentAvatarInstanceCloseFeedback =
  | { outcome: 'confirmed' }
  | { outcome: 'unconfirmed' | 'still_live' | 'refresh_failed' };

export function hasAvatarInstanceInLiveInventory(
  records: Array<{ avatarInstanceId: string }>,
  avatarInstanceId: string,
): boolean {
  return records.some((record) => record.avatarInstanceId === avatarInstanceId);
}

export function resolveAvatarInstanceLaunchFeedback(
  opened: boolean,
): AgentAvatarInstanceLaunchFeedback {
  return opened ? { outcome: 'confirmed' } : { outcome: 'unconfirmed' };
}

export function resolveAvatarInstanceCloseFeedback(input: {
  opened: boolean;
  instanceStillLive: boolean;
  inventoryRefreshFailed: boolean;
}): AgentAvatarInstanceCloseFeedback {
  if (!input.opened) {
    return { outcome: 'unconfirmed' };
  }
  if (input.inventoryRefreshFailed) {
    return { outcome: 'refresh_failed' };
  }
  if (input.instanceStillLive) {
    return { outcome: 'still_live' };
  }
  return { outcome: 'confirmed' };
}
