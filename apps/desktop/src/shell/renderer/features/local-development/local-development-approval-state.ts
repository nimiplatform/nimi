export function isRiskAcknowledgedForApproval(
  acknowledgedRequestId: string,
  currentRequestId: string | undefined,
): boolean {
  return typeof currentRequestId === 'string'
    && currentRequestId.length > 0
    && acknowledgedRequestId === currentRequestId;
}
