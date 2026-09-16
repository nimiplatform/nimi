import { createNimiError } from '../../types';

export type NimiVoiceReferenceInputCapabilities = {
  readonly supportsBytes: boolean;
  readonly supportsUri: boolean;
  readonly textMode: 'unsupported' | 'optional' | 'required';
  /** Empty means the format set is not enumerated, not unrestricted audio. */
  readonly mimeTypes: readonly string[];
};

// @nimi-authority: rule.nimi.sdks.feature-clients.r014
export function projectVoiceReferenceInput(value: unknown): NimiVoiceReferenceInputCapabilities {
  const row = value as Record<string, unknown> | null;
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || Object.keys(row).sort().join('|') !== 'mimeTypes|supportsBytes|supportsUri|textMode'
    || typeof row.supportsBytes !== 'boolean' || typeof row.supportsUri !== 'boolean'
    || (!row.supportsBytes && !row.supportsUri)
    || !['unsupported', 'optional', 'required'].includes(String(row.textMode))
    || !Array.isArray(row.mimeTypes) || row.mimeTypes.length > 16
    || row.mimeTypes.some((mime) => typeof mime !== 'string' || !mime || mime.length > 64 || mime.trim() !== mime)) {
    throw createNimiError({ reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID', message: 'Voice reference input capabilities are invalid.', actionHint: 'update_matching_runtime_sdk_kit', source: 'sdk' });
  }
  return Object.freeze({ supportsBytes: row.supportsBytes, supportsUri: row.supportsUri,
    textMode: row.textMode as NimiVoiceReferenceInputCapabilities['textMode'], mimeTypes: Object.freeze([...row.mimeTypes]) });
}
