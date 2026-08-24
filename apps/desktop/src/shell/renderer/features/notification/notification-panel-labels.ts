export function getBadgeDefaultLabel(key: string): string {
  switch (key) {
    case 'friendRequestReceived':
      return 'Friend Request';
    case 'friendRequestAccepted':
      return 'Friend Accepted';
    case 'friendRequestRejected':
      return 'Friend Rejected';
    default:
      return 'System';
  }
}

export function getActionLabel(
  pendingAction: { itemId: string; action: string } | null,
  itemId: string,
  action: string,
  fallback: string,
  pendingFallback: string,
): string {
  return pendingAction?.itemId === itemId && pendingAction.action === action
    ? pendingFallback
    : fallback;
}
