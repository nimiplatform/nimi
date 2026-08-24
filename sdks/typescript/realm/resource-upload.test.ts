import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  RealmCreateAudioDirectUploadOperationRequest,
  RealmCreateImageDirectUploadOperationRequest,
  RealmCreateVideoDirectUploadOperationRequest,
  RealmFinalizeResourceOperationRequest,
  ResourceDetailDto,
  ResourceDirectUploadSessionDto,
} from '../core-generated/realm-typed-client';
import { isNimiError } from '../types';
import {
  uploadNimiRealmResourceFile,
  type NimiRealmResourceUploadApi,
} from './index';

type FetchCall = {
  readonly url: string;
  readonly init: RequestInit | undefined;
};

function directUploadSession(overrides: Partial<ResourceDirectUploadSessionDto> = {}): ResourceDirectUploadSessionDto {
  return {
    deliveryAccess: 'SIGNED',
    provider: 'CF_IMAGE',
    resourceId: 'resource-1',
    resourceType: 'IMAGE',
    status: 'PENDING',
    storageRef: 'storage/resource-1',
    transport: {
      method: 'POST',
      bodyKind: 'MULTIPART_FORM_DATA',
      formField: 'file',
    },
    uploadUrl: 'https://upload.example/resource-1',
    ...overrides,
  };
}

function resourceDetail(overrides: Partial<ResourceDetailDto> = {}): ResourceDetailDto {
  return {
    controllerId: 'account-1',
    controllerKind: 'ACCOUNT',
    createdAt: '2026-06-05T00:00:00.000Z',
    deliveryAccess: 'SIGNED',
    id: 'resource-1',
    provenance: 'UPLOADED',
    provider: 'S3_OBJECT',
    resourceType: 'IMAGE',
    status: 'READY',
    storageRef: 'storage/resource-1',
    tags: [],
    updatedAt: '2026-06-05T00:00:01.000Z',
    uploaderAccountId: 'account-1',
    ...overrides,
  };
}

function createFakeRealm(
  session: ResourceDirectUploadSessionDto = directUploadSession(),
  resource: ResourceDetailDto = resourceDetail(),
) {
  const imageRequests: RealmCreateImageDirectUploadOperationRequest[] = [];
  const videoRequests: RealmCreateVideoDirectUploadOperationRequest[] = [];
  const audioRequests: RealmCreateAudioDirectUploadOperationRequest[] = [];
  const finalizeRequests: RealmFinalizeResourceOperationRequest[] = [];
  const realm: NimiRealmResourceUploadApi = {
    resources: {
      async createAudioDirectUpload(request) {
        audioRequests.push(request);
        return session;
      },
      async createImageDirectUpload(request) {
        imageRequests.push(request);
        return session;
      },
      async createVideoDirectUpload(request) {
        videoRequests.push(request);
        return session;
      },
      async finalizeResource(request) {
        finalizeRequests.push(request);
        return resource;
      },
    },
  };
  return { realm, imageRequests, videoRequests, audioRequests, finalizeRequests };
}

function createFetch(responses: readonly Response[]) {
  const calls: FetchCall[] = [];
  let index = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const response = responses[index];
    index += 1;
    if (!response) {
      throw new Error('unexpected fetch call');
    }
    return response;
  };
  return { fetchImpl, calls };
}

test('uploadNimiRealmResourceFile prepares signed image upload, transports file, and finalizes resource', async () => {
  const { realm, imageRequests, finalizeRequests } = createFakeRealm(
    directUploadSession(),
    resourceDetail({ mimeType: 'image/png', sizeBytes: 7 }),
  );
  const { fetchImpl, calls } = createFetch([new Response(null, { status: 204 })]);
  const file = new Blob(['content'], { type: 'image/png' });

  const result = await uploadNimiRealmResourceFile(realm, {
    kind: 'image',
    file,
    fileName: 'avatar.png',
    fetchImpl,
  });

  assert.equal(result.resourceId, 'resource-1');
  assert.deepEqual(imageRequests, [
    {
      path: {},
      query: { requireSignedUrls: 'true' },
    },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://upload.example/resource-1');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(calls[0]?.init?.body instanceof FormData, true);
  assert.deepEqual(finalizeRequests, [
    {
      path: { resourceId: 'resource-1' },
      body: {
        deliveryAccess: 'SIGNED',
        mimeType: 'image/png',
        sizeBytes: file.size,
      },
    },
  ]);
  assert.equal(result.resource.status, 'READY');
});

test('uploadNimiRealmResourceFile does not retry a failed session-selected transport', async () => {
  const { realm, finalizeRequests } = createFakeRealm(
    directUploadSession({
      resourceId: 'resource-video',
      resourceType: 'VIDEO',
      provider: 'CF_STREAM',
      uploadUrl: 'https://upload.example/video',
    }),
    resourceDetail({ id: 'resource-video', resourceType: 'VIDEO' }),
  );
  const { fetchImpl, calls } = createFetch([new Response(null, { status: 503 })]);
  const file = new Blob(['video'], { type: 'video/mp4' });

  await assert.rejects(
    () =>
      uploadNimiRealmResourceFile(realm, {
        kind: 'video',
        file,
        fetchImpl,
        deliveryAccess: 'PUBLIC',
      }),
    (error) =>
      isNimiError(error) &&
      error.reasonCode === 'REALM_RESOURCE_UPLOAD_FAILED' &&
      error.details?.phase === 'transport',
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(finalizeRequests.length, 0);
});

test('uploadNimiRealmResourceFile executes the exact binary PUT content contract once', async () => {
  const { realm, audioRequests, finalizeRequests } = createFakeRealm(
    directUploadSession({
      provider: 'S3_OBJECT',
      resourceId: 'resource-audio',
      resourceType: 'AUDIO',
      storageRef: 'audio/user-1/voice.ogg',
      transport: {
        method: 'PUT',
        bodyKind: 'BINARY',
        contentType: 'audio/ogg',
      },
      uploadUrl: 'https://upload.example/audio',
    }),
    resourceDetail({ id: 'resource-audio', resourceType: 'AUDIO', mimeType: 'audio/ogg' }),
  );
  const { fetchImpl, calls } = createFetch([new Response(null, { status: 200 })]);
  const file = new Blob(['voice'], { type: 'audio/ogg' });

  const result = await uploadNimiRealmResourceFile(realm, {
    kind: 'audio',
    file,
    fileName: 'voice.ogg',
    fetchImpl,
  });

  assert.equal(result.resourceId, 'resource-audio');
  assert.equal(audioRequests.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init?.method, 'PUT');
  assert.equal(calls[0]?.init?.body, file);
  assert.equal(
    (calls[0]?.init?.headers as Record<string, string> | undefined)?.['Content-Type'],
    'audio/ogg',
  );
  assert.equal(finalizeRequests.length, 1);
});

test('uploadNimiRealmResourceFile fails closed for an unknown session transport contract', async () => {
  const { realm, finalizeRequests } = createFakeRealm(
    directUploadSession({
      transport: {
        method: 'DELETE',
        bodyKind: 'BINARY',
        contentType: 'image/png',
      } as never,
    }),
  );
  const { fetchImpl, calls } = createFetch([]);

  await assert.rejects(
    () =>
      uploadNimiRealmResourceFile(realm, {
        kind: 'image',
        file: new Blob(['x'], { type: 'image/png' }),
        fetchImpl,
      }),
    (error) =>
      isNimiError(error) &&
      error.reasonCode === 'REALM_RESOURCE_UPLOAD_FAILED' &&
      error.details?.phase === 'prepare' &&
      error.actionHint === 'regenerate_realm_sdk_from_current_openapi',
  );
  assert.equal(calls.length, 0);
  assert.equal(finalizeRequests.length, 0);
});

test('uploadNimiRealmResourceFile fails closed for a mismatched method and body contract', async () => {
  const { realm, finalizeRequests } = createFakeRealm(
    directUploadSession({
      transport: {
        method: 'POST',
        bodyKind: 'BINARY',
        contentType: 'image/png',
      } as never,
    }),
  );
  const { fetchImpl, calls } = createFetch([]);

  await assert.rejects(
    () =>
      uploadNimiRealmResourceFile(realm, {
        kind: 'image',
        file: new Blob(['x'], { type: 'image/png' }),
        fetchImpl,
      }),
    (error) =>
      isNimiError(error) &&
      error.reasonCode === 'REALM_RESOURCE_UPLOAD_FAILED' &&
      error.details?.phase === 'prepare',
  );
  assert.equal(calls.length, 0);
  assert.equal(finalizeRequests.length, 0);
});
