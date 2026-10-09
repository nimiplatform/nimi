// Native carriers expose bounded owner reasons through their existing public
// metadata. The transport reason alone cannot distinguish a duplicate bot.
const connectionReasons = new Set([
  'INTEGRATION_ADAPTER_NOT_READY',
  'INTEGRATION_CONFIGURATION_CHANGED',
  'INTEGRATION_CONFIGURATION_INVALID',
  'INTEGRATION_INPUT_INVALID',
  'INTEGRATION_IDENTITY_ALREADY_CONNECTED',
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
  'INTEGRATION_SETUP_LIMIT',
  'INTEGRATION_SETUP_EXPIRED',
  'INTEGRATION_CREDENTIAL_EXPIRED',
  'INTEGRATION_RATE_LIMITED',
  'INTEGRATION_NETWORK_FAILED',
  'INTEGRATION_FEISHU_REQUEST_FAILED',
  'INTEGRATION_FEISHU_PROVIDER_REJECTED',
  'INTEGRATION_FEISHU_REGISTRATION_REJECTED',
  'INTEGRATION_FEISHU_REGISTRATION_DENIED',
  'INTEGRATION_FEISHU_REGISTRATION_INVALID',
  'INTEGRATION_FEISHU_IDENTITY_INVALID',
  'INTEGRATION_WEIXIN_QR_INVALID',
  'INTEGRATION_WEIXIN_QR_REJECTED',
  'INTEGRATION_WEIXIN_PROVIDER_REJECTED',
  'INTEGRATION_WEIXIN_IDENTITY_INVALID',
]);

export function integrationErrorCode(cause: unknown): string | undefined {
  if (!cause || typeof cause !== 'object') return undefined;
  const error = cause as { details?: { reasonMetadata?: Record<string, unknown> } };
  const reason = error.details?.reasonMetadata?.integration_reason;
  if (typeof reason === 'string' && connectionReasons.has(reason)) return reason;
  return undefined;
}

export function integrationErrorTranslationKey(code: string, adapter: string): string {
  if (code === 'INTEGRATION_INPUT_INVALID' && adapter === 'weixin') return 'Integrations.verificationInvalid';
  return code === 'INTEGRATION_CONFIGURATION_INVALID' && adapter === 'onebot-v11'
    ? 'Integrations.configurationInvalidOnebot'
    : `Integrations.errors.${code}`;
}
