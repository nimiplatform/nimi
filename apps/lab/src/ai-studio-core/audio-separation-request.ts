import type { StudioAudioSeparationRequest } from './runtime-types.js';

export function isAudioSeparationRequest(value: unknown): value is StudioAudioSeparationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (request.kind === 'full-source') return Object.keys(request).length === 1;
  return request.kind === 'range'
    && Object.keys(request).every(key => ['kind', 'startSeconds', 'endSeconds'].includes(key))
    && typeof request.startSeconds === 'number' && Number.isFinite(request.startSeconds) && request.startSeconds >= 0
    && (request.endSeconds === undefined || (typeof request.endSeconds === 'number'
      && Number.isFinite(request.endSeconds) && request.endSeconds > request.startSeconds));
}

/** Only a saved submission, never the current composer or output duration. */
export function audioSeparationRequestFromParameters(
  parameters?: Readonly<Record<string, unknown>>,
): StudioAudioSeparationRequest | undefined {
  if (!parameters || typeof parameters.sourceRelativePath !== 'string' || !parameters.sourceRelativePath.trim()
    || parameters.recoverySubmissionId !== undefined) return undefined;
  if (parameters.startSeconds === undefined && parameters.endSeconds === undefined) return { kind: 'full-source' };
  const request = { kind: 'range', startSeconds: parameters.startSeconds === undefined ? 0 : parameters.startSeconds,
    ...(parameters.endSeconds === undefined ? {} : { endSeconds: parameters.endSeconds }) };
  return isAudioSeparationRequest(request) ? request : undefined;
}
