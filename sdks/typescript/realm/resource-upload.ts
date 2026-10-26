import type {
  CreateMediaDirectUploadDto, RealmCreateAudioDirectUploadOperationRequest,
  RealmCreateImageDirectUploadOperationRequest, RealmCreateVideoDirectUploadOperationRequest,
  RealmFinalizeResourceOperationRequest, RealmGetResourceOperationRequest,
  RealmCancelResourceUploadOperationRequest, RealmTypedCallOptions, ResourceDetailDto,
  ResourceDirectUploadSessionDto,
} from '../core-generated/realm-typed-client';
import { createNimiError } from '../types';
import { createSha256Hasher } from '../types/sha256.js';

export type NimiRealmResourceUploadKind = 'image' | 'video' | 'audio';
export type NimiRealmResourceUploadDeliveryAccess = 'PUBLIC' | 'SIGNED';
export type NimiRealmResourceUploadSession = ResourceDirectUploadSessionDto;
export type NimiRealmResourceUploadResource = ResourceDetailDto;
export type NimiRealmResourceUploadMetadata = Omit<CreateMediaDirectUploadDto, 'requestId' | 'hashSha256' | 'sizeBytes' | 'mimeType' | 'deliveryAccess'>;

export interface NimiRealmResourceUploadApi {
  readonly resources: {
    createAudioDirectUpload(request: RealmCreateAudioDirectUploadOperationRequest, options?: RealmTypedCallOptions): Promise<ResourceDirectUploadSessionDto>;
    createImageDirectUpload(request: RealmCreateImageDirectUploadOperationRequest, options?: RealmTypedCallOptions): Promise<ResourceDirectUploadSessionDto>;
    createVideoDirectUpload(request: RealmCreateVideoDirectUploadOperationRequest, options?: RealmTypedCallOptions): Promise<ResourceDirectUploadSessionDto>;
    finalizeResource(request: RealmFinalizeResourceOperationRequest, options?: RealmTypedCallOptions): Promise<ResourceDetailDto>;
    getResource(request: RealmGetResourceOperationRequest, options?: RealmTypedCallOptions): Promise<ResourceDetailDto>;
    cancelResourceUpload(request: RealmCancelResourceUploadOperationRequest, options?: RealmTypedCallOptions): Promise<ResourceDetailDto>;
  };
}

export interface NimiRealmResourceUploadInput {
  readonly kind: NimiRealmResourceUploadKind;
  readonly file: Blob;
  readonly fetchImpl?: typeof fetch;
  readonly fileName?: string;
  readonly contentType?: string;
  readonly deliveryAccess?: NimiRealmResourceUploadDeliveryAccess;
  readonly metadata?: NimiRealmResourceUploadMetadata;
  readonly requestId?: string;
  readonly processingTimeoutMs?: number;
  readonly onProgress?: (progress: { phase: 'hashing' | 'uploading' | 'processing'; bytes: number; totalBytes: number }) => void;
  readonly failureMessage?: string;
  readonly options?: RealmTypedCallOptions;
}
export interface NimiRealmResourceUploadResult {
  readonly resourceId: string;
  readonly session: ResourceDirectUploadSessionDto;
  readonly resource: ResourceDetailDto;
}

function fail(phase: string, message: string, resourceId?: string, code?: string, requestId?: string): never {
  throw createNimiError({ message, reasonCode: phase === 'input' ? 'SDK_REALM_RESOURCE_UPLOAD_INPUT_INVALID' : 'REALM_RESOURCE_UPLOAD_FAILED', actionHint: phase === 'processing' ? 'inspect_or_resume_resource_processing' : 'inspect_realm_resource_upload', retryable: phase === 'processing', source: 'realm', details: { phase, ...(requestId ? { requestId } : {}), ...(resourceId ? { resourceId } : {}), ...(code ? { code } : {}) } });
}

async function hashFile(file: Blob, signal: AbortSignal | undefined, progress: NimiRealmResourceUploadInput['onProgress']): Promise<string> {
  const hash = createSha256Hasher();
  for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
    signal?.throwIfAborted();
    const end = Math.min(offset + 1024 * 1024, file.size);
    hash.update(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
    progress?.({ phase: 'hashing', bytes: end, totalBytes: file.size });
  }
  return hash.hex();
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// @nimi-authority: rule.nimi.sdks.realm-consumer.r007
export async function uploadNimiRealmResourceFile(realm: NimiRealmResourceUploadApi, input: NimiRealmResourceUploadInput): Promise<NimiRealmResourceUploadResult> {
  if (!['image', 'audio', 'video'].includes(input.kind) || !input.file || typeof input.file.slice !== 'function' || !Number.isSafeInteger(input.file.size) || input.file.size < 1 || input.file.size > 2147483647) fail('input', 'A supported non-empty media file is required.');
  const declaredType = (input.contentType || input.file.type || '').split(';', 1)[0].trim().toLowerCase();
  const contentType = ({ 'image/jpg': 'image/jpeg', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/mp3': 'audio/mpeg', 'audio/x-m4a': 'audio/mp4' } as Record<string, string>)[declaredType] ?? declaredType;
  if (!contentType) fail('input', 'A media Content-Type is required.');
  if (input.deliveryAccess !== undefined && !['PUBLIC', 'SIGNED'].includes(input.deliveryAccess)) fail('input', 'Unknown media delivery strategy.');
  const fetchImpl = input.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) fail('input', 'Resource upload requires fetch.');
  const processingTimeout = input.processingTimeoutMs ?? 600000;
  if (!Number.isFinite(processingTimeout) || processingTimeout < 1 || processingTimeout > 7200000) fail('input', 'Invalid media processing timeout.');
  const signal = input.options?.signal;
  signal?.throwIfAborted();
  const requestId = input.requestId ?? globalThis.crypto.randomUUID();
  const hashSha256 = await hashFile(input.file, signal, input.onProgress);
  const body: CreateMediaDirectUploadDto = { ...input.metadata, requestId, hashSha256, sizeBytes: input.file.size, mimeType: contentType, deliveryAccess: input.deliveryAccess ?? 'SIGNED', label: input.metadata?.label ?? input.fileName };
  const request = { path: {}, body };
  const session = input.kind === 'image' ? await realm.resources.createImageDirectUpload(request, input.options)
    : input.kind === 'video' ? await realm.resources.createVideoDirectUpload(request, input.options)
      : await realm.resources.createAudioDirectUpload(request, input.options);
  const resourceId = session.resourceId;
  function failIntent(phase: string, message: string, id = resourceId, code?: string): never { return fail(phase, message, id, code, requestId); }
  if (!resourceId || session.requestId !== requestId || session.resourceType !== input.kind.toUpperCase() || session.status !== 'PENDING') failIntent('prepare', 'Invalid resource upload identity or lifecycle.', resourceId);
  const transport = session.transport;
  const keys = Object.keys(transport ?? {}).sort();
  if (keys.join(',') !== 'bodyKind,contentType,method' || transport.method !== 'PUT' || transport.bodyKind !== 'BINARY' || !transport.contentType?.trim()) failIntent('prepare', 'Unknown resource upload transport; regenerate the SDK from the current Realm contract.', resourceId);
  let completed = false;
  try {
    signal?.throwIfAborted();
    input.onProgress?.({ phase: 'uploading', bytes: 0, totalBytes: input.file.size });
    let response: Response;
    try { response = await fetchImpl(session.uploadUrl, { method: 'PUT', body: input.file, headers: { 'Content-Type': transport.contentType }, credentials: 'omit', redirect: 'error', signal }); }
    catch { signal?.throwIfAborted(); failIntent('transport', input.failureMessage || 'Resource transport failed; the upload URL is not included in diagnostics.', resourceId); }
    if (!response.ok) failIntent('transport', input.failureMessage || `Resource upload returned HTTP ${response.status}.`, resourceId);
    signal?.throwIfAborted();
    let resource = await realm.resources.finalizeResource({ path: { resourceId }, body: { requestId } }, input.options);
    const deadline = Date.now() + processingTimeout;
    while (true) {
      signal?.throwIfAborted();
      if (resource.id !== resourceId || resource.resourceType !== session.resourceType) failIntent('finalize', 'Resource identity changed during finalization.', resourceId);
      if (resource.status === 'FAILED' || resource.status === 'DELETED' || resource.deliveryStatus.state === 'FAILED') failIntent('finalize', input.failureMessage || 'The media could not be verified or processed.', resourceId, resource.deliveryStatus.failureCode ?? undefined);
      if (resource.status === 'READY' && resource.deliveryStatus.state === 'READY') {
        if (!resource.delivery || resource.hashSha256 !== hashSha256 || resource.sizeBytes !== input.file.size || resource.mimeType !== transport.contentType || resource.delivery.contentVersion !== hashSha256) failIntent('finalize', 'The accepted original does not match the uploaded bytes.', resourceId);
        completed = true;
        return { resourceId, session, resource };
      }
      input.onProgress?.({ phase: 'processing', bytes: input.file.size, totalBytes: input.file.size });
      if (Date.now() >= deadline) failIntent('processing', 'Upload was received and is still processing. Check the resource status before retrying.', resourceId);
      await wait(Math.min(1000, Math.max(1, deadline - Date.now())), signal);
      resource = await realm.resources.getResource({ path: { resourceId } }, input.options);
    }
  } finally {
    if (!completed && signal?.aborted) {
      // Best-effort cancellation is never reported as confirmed server cancellation.
      try { await realm.resources.cancelResourceUpload({ path: { resourceId }, body: { requestId } }, { ...input.options, signal: undefined, timeoutMs: 5000 }); } catch { /* The persisted Resource remains queryable. */ }
    }
  }
}
