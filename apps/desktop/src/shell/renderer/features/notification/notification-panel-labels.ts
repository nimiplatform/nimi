export function getBadgeDefaultLabel(key: string): string {
  switch (key) {
    case 'friendRequestReceived':
      return 'Friend Request';
    case 'friendRequestAccepted':
      return 'Friend Accepted';
    case 'friendRequestRejected':
      return 'Friend Rejected';
    case 'giftReceived':
      return 'Gift Received';
    case 'giftAccepted':
      return 'Gift Accepted';
    case 'giftRejected':
      return 'Gift Rejected';
    case 'giftStatusUpdated':
      return 'Gift Updated';
    case 'reviewReceived':
      return 'Review Received';
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
