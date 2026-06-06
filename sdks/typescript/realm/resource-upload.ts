import type {
  CreateAudioDirectUploadDto,
  FinalizeResourceDto,
  RealmCreateAudioDirectUploadOperationRequest,
  RealmCreateImageDirectUploadOperationRequest,
  RealmCreateVideoDirectUploadOperationRequest,
  RealmFinalizeResourceOperationRequest,
  RealmTypedCallOptions,
  ResourceDetailDto,
  ResourceDirectUploadSessionDto,
} from '../core-generated/realm-typed-client';
import { createNimiError, type JsonObject } from '../types';

export type NimiRealmResourceUploadKind = 'image' | 'video' | 'audio';

export type NimiRealmResourceUploadTransportMode =
  | 'multipart_post'
  | 'binary_put'
  | 'multipart_post_then_binary_put';

export type NimiRealmResourceUploadDeliveryAccess = 'PUBLIC' | 'SIGNED';
export type NimiRealmResourceUploadSession = ResourceDirectUploadSessionDto;
export type NimiRealmResourceUploadResource = ResourceDetailDto;
export type NimiRealmResourceUploadFinalizeInput = FinalizeResourceDto;

export interface NimiRealmResourceUploadApi {
  readonly resources: {
    createAudioDirectUpload(
      request: RealmCreateAudioDirectUploadOperationRequest,
      options?: RealmTypedCallOptions,
    ): Promise<ResourceDirectUploadSessionDto>;
    createImageDirectUpload(
      request: RealmCreateImageDirectUploadOperationRequest,
      options?: RealmTypedCallOptions,
    ): Promise<ResourceDirectUploadSessionDto>;
    createVideoDirectUpload(
      request: RealmCreateVideoDirectUploadOperationRequest,
      options?: RealmTypedCallOptions,
    ): Promise<ResourceDirectUploadSessionDto>;
    finalizeResource(
      request: RealmFinalizeResourceOperationRequest,
      options?: RealmTypedCallOptions,
    ): Promise<ResourceDetailDto>;
  };
}

export interface NimiRealmResourceUploadInput {
  readonly kind: NimiRealmResourceUploadKind;
  readonly file: Blob;
  readonly fetchImpl?: typeof fetch;
  readonly fileName?: string;
  readonly contentType?: string;
  readonly deliveryAccess?: NimiRealmResourceUploadDeliveryAccess;
  readonly finalizePayload?: FinalizeResourceDto;
  readonly transportMode?: NimiRealmResourceUploadTransportMode;
  readonly failureMessage?: string;
  readonly options?: RealmTypedCallOptions;
}

export interface NimiRealmResourceUploadResult {
  readonly resourceId: string;
  readonly session: ResourceDirectUploadSessionDto;
  readonly resource: ResourceDetailDto;
}

type UploadPhase = 'input' | 'prepare' | 'transport' | 'finalize';

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isBlobLike(value: unknown): value is Blob {
  const record = toRecord(value);
  return typeof record.size === 'number'
    && typeof record.type === 'string'
    && typeof record.arrayBuffer === 'function';
}

function fail(input: {
  readonly phase: UploadPhase;
  readonly kind?: unknown;
  readonly message: string;
  readonly actionHint: string;
  readonly retryable?: boolean;
  readonly details?: JsonObject;
}): never {
  throw createNimiError({
    message: input.message,
    reasonCode: input.phase === 'input'
      ? 'SDK_REALM_RESOURCE_UPLOAD_INPUT_INVALID'
      : 'REALM_RESOURCE_UPLOAD_FAILED',
    actionHint: input.actionHint,
    retryable: input.retryable,
    source: 'realm',
    details: {
      phase: input.phase,
      ...(input.kind !== undefined && input.kind !== null ? { kind: normalizeText(input.kind) } : {}),
      ...(input.details || {}),
    },
  });
}

function normalizeKind(kind: unknown): NimiRealmResourceUploadKind {
  if (kind === 'image' || kind === 'video' || kind === 'audio') {
    return kind;
  }
  fail({
    phase: 'input',
    kind,
    message: 'Realm resource upload kind must be image, video, or audio.',
    actionHint: 'pass_supported_realm_resource_upload_kind',
  });
}

function normalizeTransportMode(mode: unknown): NimiRealmResourceUploadTransportMode {
  if (mode == null || mode === '') {
    return 'multipart_post';
  }
  if (mode === 'multipart_post' || mode === 'binary_put' || mode === 'multipart_post_then_binary_put') {
    return mode;
  }
  fail({
    phase: 'input',
    message: 'Realm resource upload transport mode is not supported by SDK vNext.',
    actionHint: 'use_vnext_realm_resource_upload_transport_mode',
    details: { transportMode: normalizeText(mode) },
  });
}

function resolveFetch(fetchImpl?: typeof fetch): typeof fetch {
  const resolved = fetchImpl || globalThis.fetch?.bind(globalThis);
  if (typeof resolved !== 'function') {
    fail({
      phase: 'input',
      message: 'Realm resource upload requires an explicit fetch implementation.',
      actionHint: 'pass_fetch_impl_or_run_in_fetch_capable_runtime',
    });
  }
  return resolved;
}

function resolveDeliveryAccess(access: NimiRealmResourceUploadDeliveryAccess | undefined): NimiRealmResourceUploadDeliveryAccess {
  return access === 'PUBLIC' ? 'PUBLIC' : 'SIGNED';
}

function fileNameFromBlob(file: Blob): string | undefined {
  const name = (file as { readonly name?: unknown }).name;
  const normalized = normalizeText(name);
  return normalized || undefined;
}

function contentTypeFromInput(input: NimiRealmResourceUploadInput): string | undefined {
  const explicit = normalizeText(input.contentType);
  if (explicit) {
    return explicit;
  }
  return normalizeText(input.file.type) || undefined;
}

function sizeBytesFromFile(file: Blob): number | undefined {
  return Number.isFinite(file.size) ? file.size : undefined;
}

function buildMultipartBody(file: Blob, fileName?: string): FormData {
  if (typeof FormData !== 'function') {
    fail({
      phase: 'input',
      message: 'Realm resource multipart upload requires FormData.',
      actionHint: 'use_binary_put_or_provide_form_data_capable_runtime',
    });
  }
  const body = new FormData();
  const normalizedFileName = normalizeText(fileName) || fileNameFromBlob(file);
  if (normalizedFileName) {
    body.append('file', file, normalizedFileName);
  } else {
    body.append('file', file);
  }
  return body;
}

function buildAudioDirectUploadBody(input: NimiRealmResourceUploadInput): CreateAudioDirectUploadDto {
  const finalizePayload = input.finalizePayload || {};
  const filename = normalizeText(input.fileName) || fileNameFromBlob(input.file);
  return {
    ...finalizePayload,
    deliveryAccess: finalizePayload.deliveryAccess ?? resolveDeliveryAccess(input.deliveryAccess),
    ...(filename ? { filename } : {}),
    mimeType: finalizePayload.mimeType ?? contentTypeFromInput(input),
    sizeBytes: finalizePayload.sizeBytes ?? sizeBytesFromFile(input.file),
  };
}

function buildFinalizeBody(input: NimiRealmResourceUploadInput): FinalizeResourceDto {
  const finalizePayload = input.finalizePayload || {};
  return {
    ...finalizePayload,
    deliveryAccess: finalizePayload.deliveryAccess ?? resolveDeliveryAccess(input.deliveryAccess),
    mimeType: finalizePayload.mimeType ?? contentTypeFromInput(input),
    sizeBytes: finalizePayload.sizeBytes ?? sizeBytesFromFile(input.file),
  };
}

async function createUploadSession(input: {
  readonly realm: NimiRealmResourceUploadApi;
  readonly kind: NimiRealmResourceUploadKind;
  readonly upload: NimiRealmResourceUploadInput;
}): Promise<ResourceDirectUploadSessionDto> {
  if (input.kind === 'image') {
    return input.realm.resources.createImageDirectUpload({
      path: {},
      query: { requireSignedUrls: resolveDeliveryAccess(input.upload.deliveryAccess) === 'SIGNED' ? 'true' : 'false' },
    }, input.upload.options);
  }
  if (input.kind === 'video') {
    return input.realm.resources.createVideoDirectUpload({
      path: {},
      query: { requireSignedUrls: resolveDeliveryAccess(input.upload.deliveryAccess) === 'SIGNED' ? 'true' : 'false' },
    }, input.upload.options);
  }
  return input.realm.resources.createAudioDirectUpload({
    path: {},
    body: buildAudioDirectUploadBody(input.upload),
  }, input.upload.options);
}

async function uploadBinaryPut(input: {
  readonly fetchImpl: typeof fetch;
  readonly uploadUrl: string;
  readonly file: Blob;
  readonly contentType?: string;
}): Promise<Response> {
  return input.fetchImpl(input.uploadUrl, {
    method: 'PUT',
    body: input.file,
    headers: {
      'Content-Type': input.contentType || input.file.type || 'application/octet-stream',
    },
  });
}

async function uploadMultipartPost(input: {
  readonly fetchImpl: typeof fetch;
  readonly uploadUrl: string;
  readonly file: Blob;
  readonly fileName?: string;
}): Promise<Response> {
  return input.fetchImpl(input.uploadUrl, {
    method: 'POST',
    body: buildMultipartBody(input.file, input.fileName),
  });
}

async function uploadWithMode(input: {
  readonly fetchImpl: typeof fetch;
  readonly uploadUrl: string;
  readonly file: Blob;
  readonly fileName?: string;
  readonly contentType?: string;
  readonly mode: NimiRealmResourceUploadTransportMode;
}): Promise<Response> {
  if (input.mode === 'binary_put') {
    return uploadBinaryPut(input);
  }

  const postResponse = await uploadMultipartPost(input);
  if (postResponse.ok || input.mode === 'multipart_post') {
    return postResponse;
  }

  return uploadBinaryPut(input);
}

export async function uploadNimiRealmResourceFile(
  realm: NimiRealmResourceUploadApi,
  input: NimiRealmResourceUploadInput,
): Promise<NimiRealmResourceUploadResult> {
  const kind = normalizeKind(input.kind);
  if (!isBlobLike(input.file)) {
    fail({
      phase: 'input',
      kind,
      message: 'Realm resource upload requires a Blob-like file.',
      actionHint: 'pass_blob_or_file',
    });
  }

  const mode = normalizeTransportMode(input.transportMode);
  const fetchImpl = resolveFetch(input.fetchImpl);
  const session = await createUploadSession({ realm, kind, upload: input });
  const resourceId = normalizeText(session.resourceId);
  const uploadUrl = normalizeText(session.uploadUrl);
  if (!resourceId || !uploadUrl) {
    fail({
      phase: 'prepare',
      kind,
      message: input.failureMessage || 'Realm direct upload session is missing resourceId or uploadUrl.',
      actionHint: 'inspect_realm_resource_prepare_response',
      details: { resourceId, hasUploadUrl: Boolean(uploadUrl) },
    });
  }

  const uploadResponse = await uploadWithMode({
    fetchImpl,
    uploadUrl,
    file: input.file,
    fileName: input.fileName,
    contentType: input.contentType,
    mode,
  });
  if (!uploadResponse.ok) {
    fail({
      phase: 'transport',
      kind,
      message: input.failureMessage || `Realm resource upload transport failed with status ${uploadResponse.status}.`,
      actionHint: 'inspect_direct_upload_endpoint_response',
      retryable: uploadResponse.status >= 500,
      details: { status: uploadResponse.status },
    });
  }

  const resource = await realm.resources.finalizeResource({
    path: { resourceId },
    body: buildFinalizeBody(input),
  }, input.options);

  return {
    resourceId,
    session,
    resource,
  };
}
