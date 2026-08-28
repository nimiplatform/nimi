// @nimi-authority: rule.nimi.sdks.client-core.r021
/**
 * Returns true only when a Local App Agent operation proves that its opaque
 * selector belongs to another technical session or Agent. Generic NotFound,
 * owner-unavailable, and transport failures must remain visible to callers.
 */
export function isNimiLocalAppAgentSelectorMismatchError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const reasonCode = normalizeErrorToken(record.reasonCode);
  if (reasonCode === 'LOCAL_APP_ACCESS_DENIED') return true;

  const details = record.details && typeof record.details === 'object'
    && !Array.isArray(record.details)
    ? record.details as Record<string, unknown>
    : {};
  const notFoundCode = [record.code, record.grpcCode, details.grpcCode]
    .some((value) => value === 5 || normalizeErrorToken(value) === 'NOT_FOUND');
  const evidence = [record.message, details.cause];
  const resourceNotFound = evidence.some(exactConversationResourceNotFound);
  const prefixedGrpcStatus = evidence.some((value) => (
    /^5\s+NOT_FOUND:/iu.test(String(value ?? '').trim())
  ));
  const tauriNormalizedNotFound = [record.code, record.reasonCode]
    .some((value) => normalizeErrorToken(value) === 'RUNTIME_GRPC_NOT_FOUND')
    && evidence.some(exactTauriConversationResourceNotFound);
  return (resourceNotFound && (notFoundCode || prefixedGrpcStatus))
    || tauriNormalizedNotFound;
}

function normalizeErrorToken(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[-\s]+/gu, '_');
}

function exactConversationResourceNotFound(value: unknown): boolean {
  const text = String(value ?? '').trim();
  return text === 'local-app conversation resource not found'
    || /(?:^|:\s*)5\s+NOT_FOUND:\s+local-app conversation resource not found$/iu.test(text);
}

function exactTauriConversationResourceNotFound(value: unknown): boolean {
  const text = String(value ?? '').trim();
  if (text === 'local-app conversation resource not found') return true;
  if (!text.startsWith('{') || !text.endsWith('}')) return false;
  try {
    const parsed = JSON.parse(text) as unknown;
    return Boolean(
      parsed
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && (parsed as Record<string, unknown>).message === 'local-app conversation resource not found',
    );
  } catch {
    return false;
  }
}
