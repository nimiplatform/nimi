// Native carriers expose bounded owner reasons through their existing public
// metadata. The transport reason alone cannot distinguish a duplicate bot.
const connectionReasons = new Set([
  'INTEGRATION_TELEGRAM_BOT_ALREADY_CONNECTED',
  'INTEGRATION_TELEGRAM_VERIFICATION_REQUIRED',
  'INTEGRATION_TELEGRAM_IDENTITY_INVALID',
  'INTEGRATION_TELEGRAM_WEBHOOK_CONFLICT',
  'INTEGRATION_NEW_TARGET_REQUIRED',
  'INTEGRATION_CREDENTIAL_UNAVAILABLE',
  'INTEGRATION_CUSTODY_UNAVAILABLE',
  'INTEGRATION_PROVIDER_REJECTED',
  'INTEGRATION_DISCOVERY_FAILED',
  'INTEGRATION_ENDPOINT_INVALID',
]);

export function integrationErrorCode(cause: unknown): string | undefined {
  if (!cause || typeof cause !== 'object') return undefined;
  const error = cause as { details?: { reasonMetadata?: Record<string, unknown> } };
  const reason = error.details?.reasonMetadata?.integration_reason;
  if (typeof reason === 'string' && connectionReasons.has(reason)) return reason;
  return undefined;
}
