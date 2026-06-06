import type { RealmModel } from '../generated/type-helpers.js';
import type { Realm } from '../client.js';

export type RealmResourceUploadKind = 'image' | 'video' | 'audio';

export type RealmResourceUploadTransportMode =
  | 'multipartPost'
  | 'binaryPut'
  | 'multipartPostThenBinaryPut';

export type RealmResourceDirectUploadSession = RealmModel<'ResourceDirectUploadSessionDto'>;
export type RealmResourceDetail = RealmModel<'ResourceDetailDto'>;
export type RealmResourceFinalizeInput = RealmModel<'FinalizeResourceDto'>;

export type RealmResourceUploadClient = {
  createImageDirectUpload?: () => Promise<RealmResourceDirectUploadSession>;
  createVideoDirectUpload?: () => Promise<RealmResourceDirectUploadSession>;
  createAudioDirectUpload?: () => Promise<RealmResourceDirectUploadSession>;
  finalizeResource: (
    resourceId: string,
    payload: RealmResourceFinalizeInput,
  ) => Promise<RealmResourceDetail>;
};

export type RealmResourceUploadInput = {
  kind: RealmResourceUploadKind;
  file: Blob;
  client: RealmResourceUploadClient;
  fetchImpl?: typeof fetch;
  fileName?: string;
  contentType?: string;
  finalizePayload?: RealmResourceFinalizeInput;
  transportMode?: RealmResourceUploadTransportMode;
  failureMessage?: string;
};

export type RealmResourceUploadWithRealmInput = Omit<RealmResourceUploadInput, 'client'> & {
  realm: Realm;
};

export type RealmResourceUploadResult = {
  resourceId: string;
  session: RealmResourceDirectUploadSession;
  resource: RealmResourceDetail;
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function defaultFailureMessage(input: { kind: RealmResourceUploadKind; phase: string }): string {
  return `REALM_RESOURCE_UPLOAD_FAILED: kind=${input.kind} phase=${input.phase}`;
}

function fail(input: {
  kind: RealmResourceUploadKind;
  phase: string;
  message?: string;
  status?: number;
}): never {
  const suffix = typeof input.status === 'number' ? ` status=${input.status}` : '';
  throw new Error(input.message || `${defaultFailureMessage(input)}${suffix}`);
}

function resolveFetch(fetchImpl?: typeof fetch): typeof fetch {
  const resolved = fetchImpl || globalThis.fetch?.bind(globalThis);
  if (typeof resolved !== 'function') {
    throw new Error('REALM_RESOURCE_UPLOAD_FETCH_UNAVAILABLE');
  }
  return resolved;
}

function fileNameFromBlob(file: Blob): string | undefined {
  const name = (file as { name?: unknown }).name;
  const normalized = normalizeText(name);
  return normalized || undefined;
}

function buildMultipartBody(file: Blob, fileName?: string): FormData {
  const body = new FormData();
  const normalizedFileName = fileName || fileNameFromBlob(file);
  if (normalizedFileName) {
    body.append('file', file, normalizedFileName);
  } else {
    body.append('file', file);
  }
  return body;
}

async function createUploadSession(
  client: RealmResourceUploadClient,
  kind: RealmResourceUploadKind,
): Promise<RealmResourceDirectUploadSession> {
  if (kind === 'image' && client.createImageDirectUpload) {
    return client.createImageDirectUpload();
  }
  if (kind === 'video' && client.createVideoDirectUpload) {
    return client.createVideoDirectUpload();
  }
  if (kind === 'audio' && client.createAudioDirectUpload) {
    return client.createAudioDirectUpload();
  }
  throw new Error(`REALM_RESOURCE_UPLOAD_KIND_UNSUPPORTED: ${kind}`);
}

async function uploadWithMode(input: {
  fetchImpl: typeof fetch;
  uploadUrl: string;
  file: Blob;
  fileName?: string;
  contentType?: string;
  mode: RealmResourceUploadTransportMode;
}): Promise<Response> {
  if (input.mode === 'binaryPut') {
    return input.fetchImpl(input.uploadUrl, {
      method: 'PUT',
      body: input.file,
      headers: {
        'Content-Type': input.contentType || input.file.type || 'application/octet-stream',
      },
    });
  }

  const postResponse = await input.fetchImpl(input.uploadUrl, {
    method: 'POST',
    body: buildMultipartBody(input.file, input.fileName),
  });
  if (postResponse.ok || input.mode === 'multipartPost') {
    return postResponse;
  }

  return input.fetchImpl(input.uploadUrl, {
    method: 'PUT',
    body: input.file,
    headers: {
      'Content-Type': input.contentType || input.file.type || 'application/octet-stream',
    },
  });
}

export async function uploadRealmResourceFile(
  input: RealmResourceUploadInput,
): Promise<RealmResourceUploadResult> {
  const fetchImpl = resolveFetch(input.fetchImpl);
  const session = await createUploadSession(input.client, input.kind);
  const resourceId = normalizeText(session.resourceId);
  const uploadUrl = normalizeText(session.uploadUrl);
  if (!resourceId || !uploadUrl) {
    fail({ kind: input.kind, phase: 'prepare', message: input.failureMessage });
  }

  const uploadResponse = await uploadWithMode({
    fetchImpl,
    uploadUrl,
    file: input.file,
    fileName: input.fileName,
    contentType: input.contentType,
    mode: input.transportMode || 'multipartPost',
  });
  if (!uploadResponse.ok) {
    fail({
      kind: input.kind,
      phase: 'transport',
      message: input.failureMessage,
      status: uploadResponse.status,
    });
  }

  const resource = await input.client.finalizeResource(resourceId, input.finalizePayload || {});
  return {
    resourceId,
    session,
    resource,
  };
}

export async function uploadRealmResourceFileWithRealm(
  input: RealmResourceUploadWithRealmInput,
): Promise<RealmResourceUploadResult> {
  return uploadRealmResourceFile({
    ...input,
    client: {
      createImageDirectUpload: () => input.realm.services.ResourcesService.createImageDirectUpload(),
      createVideoDirectUpload: () => input.realm.services.ResourcesService.createVideoDirectUpload(),
      createAudioDirectUpload: () => input.realm.services.ResourcesService.createAudioDirectUpload({}),
      finalizeResource: (resourceId, payload) =>
        input.realm.services.ResourcesService.finalizeResource(resourceId, payload),
    },
  });
}
