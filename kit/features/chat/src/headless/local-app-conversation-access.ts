import { extractNimiErrorFields } from '@nimiplatform/kit/core/sdk-contract';

// Exact current Runtime ReasonCode vocabulary (common.proto); transport errors
// and prose containing these words never revoke a Conversation view.
const deniedReasons = new Set([
  'LOCAL_APP_ACCESS_DENIED', 'LOCAL_APP_SESSION_REVOKED', 'SESSION_EXPIRED',
  'LOCAL_APP_ACCOUNT_CHANGED', 'LOCAL_APP_PROCESS_MISMATCH', 'LOCAL_APP_OPERATION_UNAVAILABLE',
]);
export function isLocalAppConversationAccessDenied(error: unknown): boolean {
  const fields = extractNimiErrorFields(error);
  return deniedReasons.has(fields.reasonCode || fields.code || '');
}
