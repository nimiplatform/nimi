/**
 * Plain-language reading of a save or check failure; the raw text stays in
 * details. A failed check leaves the saved connection in place, so its
 * fallback never says the connection could not be saved.
 */
// @nimi-authority: rule.nimi.desktop.shell-ui.r073
export function connectorCredentialFormatErrorCopy(error: unknown, t: (key: string) => string): string | null {
  const value = error as { reasonCode?: unknown; details?: { reasonMetadata?: { input_format?: unknown } } } | null;
  return value?.reasonCode === 'AI_CONNECTOR_INVALID'
    && value?.details?.reasonMetadata?.input_format === 'mubert-customer-pair-v1'
    ? t('runtimeConfig.product.errorMubertCredentialFormat') : null;
}

export function humanizeConnectorError(raw: unknown, t: (key: string) => string, operation: 'save' | 'check'): string {
  const formatCopy = connectorCredentialFormatErrorCopy(raw, t);
  if (formatCopy) return formatCopy;
  const text = (raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '').toUpperCase();
  // Runtime rejects a Connector whose service or settings it no longer admits,
  // such as a retired provider; a new key cannot repair that.
  if (text.includes('AI_CONNECTOR_INVALID'))
    return t('runtimeConfig.product.errorConnectorUnsupported');
  if (text.includes('AI_PROVIDER_AUTH_FAILED') || text.includes('AI_CONNECTOR_CREDENTIAL_MISSING') || text.includes('UNAUTHORIZED') || text.includes('401') || text.includes('INVALID_API_KEY'))
    return t('runtimeConfig.product.errorCredentialRejected');
  if (text.includes('TIMEOUT') || text.includes('TIMED OUT') || text.includes('DEADLINE_EXCEEDED') || text.includes('DEADLINEEXCEEDED'))
    return t('runtimeConfig.product.errorConnectionTimeout');
  if (text.includes('UNREACHABLE') || text.includes('ECONNREFUSED') || text.includes('ENOTFOUND') || text.includes('NETWORK'))
    return t('runtimeConfig.product.errorEndpointUnreachable');
  if (text.includes('AI_PROVIDER_UNAVAILABLE'))
    return t('runtimeConfig.product.errorProviderUnavailable');
  return t(operation === 'check' ? 'runtimeConfig.product.connectionCheckFailed' : 'runtimeConfig.product.connectionSaveFailed');
}
