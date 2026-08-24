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

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
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

function buildMultipartBody(file: Blob, formField: string, fileName?: string): FormData {
  if (typeof FormData !== 'function') {
    fail({
      phase: 'input',
      message: 'Realm resource multipart upload requires FormData.',
      actionHint: 'run_in_form_data_capable_runtime',
    });
  }
  const body = new FormData();
  const normalizedFileName = normalizeText(fileName) || fileNameFromBlob(file);
  if (normalizedFileName) {
    body.append(formField, file, normalizedFileName);
  } else {
    body.append(formField, file);
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
  readonly contentType: string;
}): Promise<Response> {
  return input.fetchImpl(input.uploadUrl, {
    method: 'PUT',
    body: input.file,
    headers: {
      'Content-Type': input.contentType,
    },
  });
}

async function uploadMultipartPost(input: {
  readonly fetchImpl: typeof fetch;
  readonly uploadUrl: string;
  readonly file: Blob;
  readonly formField: string;
  readonly fileName?: string;
}): Promise<Response> {
  return input.fetchImpl(input.uploadUrl, {
    method: 'POST',
    body: buildMultipartBody(input.file, input.formField, input.fileName),
  });
}

// @nimi-authority: rule.nimi.sdks.realm-consumer.r007
async function uploadWithSessionTransport(input: {
  readonly fetchImpl: typeof fetch;
  readonly uploadUrl: string;
  readonly file: Blob;
  readonly fileName?: string;
  readonly session: Record<string, unknown>;
  readonly kind: NimiRealmResourceUploadKind;
}): Promise<Response> {
  const transport = toRecord(input.session.transport);
  const method = transport.method;
  const bodyKind = transport.bodyKind;

  if (
    hasExactKeys(transport, ['bodyKind', 'formField', 'method']) &&
    method === 'POST' &&
    bodyKind === 'MULTIPART_FORM_DATA' &&
    typeof transport.formField === 'string' &&
    transport.formField.trim().length > 0 &&
    transport.formField === transport.formField.trim() &&
    transport.contentType === undefined
  ) {
    return uploadMultipartPost({
      fetchImpl: input.fetchImpl,
      uploadUrl: input.uploadUrl,
      file: input.file,
      fileName: input.fileName,
      formField: transport.formField,
    });
  }

  if (
    hasExactKeys(transport, ['bodyKind', 'contentType', 'method']) &&
    method === 'PUT' &&
    bodyKind === 'BINARY' &&
    transport.formField === undefined &&
    typeof transport.contentType === 'string' &&
    transport.contentType.trim().length > 0 &&
    transport.contentType === transport.contentType.trim()
  ) {
    return uploadBinaryPut({
      fetchImpl: input.fetchImpl,
      uploadUrl: input.uploadUrl,
      file: input.file,
      contentType: transport.contentType,
    });
  }

  fail({
    phase: 'prepare',
    kind: input.kind,
    message: 'Realm direct upload session has an invalid transport contract.',
    actionHint: 'regenerate_realm_sdk_from_current_openapi',
    details: { method: normalizeText(method), bodyKind: normalizeText(bodyKind) },
  });
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

  const fetchImpl = resolveFetch(input.fetchImpl);
  const session = await createUploadSession({ realm, kind, upload: input });
  const sessionRecord = toRecord(session);
  const resourceId = normalizeText(sessionRecord.resourceId);
  const uploadUrl = normalizeText(sessionRecord.uploadUrl);
  const expectedResourceType = kind === 'image' ? 'IMAGE' : kind === 'video' ? 'VIDEO' : 'AUDIO';
  if (
    !resourceId ||
    !uploadUrl ||
    sessionRecord.resourceType !== expectedResourceType ||
    sessionRecord.status !== 'PENDING'
  ) {
    fail({
      phase: 'prepare',
      kind,
      message:
        input.failureMessage || 'Realm direct upload session has invalid identity or lifecycle fields.',
      actionHint: 'inspect_realm_resource_prepare_response',
      details: {
        resourceId,
        hasUploadUrl: Boolean(uploadUrl),
        resourceType: normalizeText(sessionRecord.resourceType),
        status: normalizeText(sessionRecord.status),
      },
    });
  }

  const uploadResponse = await uploadWithSessionTransport({
    fetchImpl,
    uploadUrl,
    file: input.file,
    fileName: input.fileName,
    session: sessionRecord,
    kind,
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
