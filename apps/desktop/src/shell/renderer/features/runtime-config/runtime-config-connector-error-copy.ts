/**
 * Plain-language reading of a save or check failure; the raw text stays in
 * details. A failed check leaves the saved connection in place, so its
 * fallback never says the connection could not be saved.
 */
export function humanizeConnectorError(raw: string, t: (key: string) => string, operation: 'save' | 'check'): string {
  const text = raw.toUpperCase();
  // Runtime rejects a Connector whose service or settings it no longer admits,
  // such as a retired provider; a new key cannot repair that.
  if (text.includes('AI_CONNECTOR_INVALID'))
    return t('runtimeConfig.product.errorConnectorUnsupported');
  if (text.includes('AI_PROVIDER_AUTH_FAILED') || text.includes('AI_CONNECTOR_CREDENTIAL_MISSING') || text.includes('UNAUTHORIZED') || text.includes('401') || text.includes('INVALID_API_KEY'))
    return t('runtimeConfig.product.errorCredentialRejected');
  if (text.includes('UNREACHABLE') || text.includes('ECONNREFUSED') || text.includes('ENOTFOUND') || text.includes('TIMEOUT') || text.includes('NETWORK'))
    return t('runtimeConfig.product.errorEndpointUnreachable');
  if (text.includes('AI_PROVIDER_UNAVAILABLE'))
    return t('runtimeConfig.product.errorProviderUnavailable');
  return t(operation === 'check' ? 'runtimeConfig.product.connectionCheckFailed' : 'runtimeConfig.product.connectionSaveFailed');
}
