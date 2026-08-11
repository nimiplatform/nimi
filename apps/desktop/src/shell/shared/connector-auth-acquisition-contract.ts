export const DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND = 'connector_auth_acquire_managed_credential';
export const DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND = 'connector_auth_cancel_managed_credential';
export const DESKTOP_MANAGED_CONNECTOR_AUTH_PENDING_EVENT_PREFIX =
  'connector-auth-acquisition:pending:';

export function desktopManagedConnectorAuthPendingEvent(requestId: string): string {
  return `${DESKTOP_MANAGED_CONNECTOR_AUTH_PENDING_EVENT_PREFIX}${requestId}`;
}
