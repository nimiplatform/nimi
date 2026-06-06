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
  REALM_RESOURCE_METHODS,
  uploadNimiRealmResourceFile,
  type NimiRealmResourceUploadApi,
  type NimiRealmResourceUploadTransportMode,
} from './index';

type FetchCall = {
  readonly url: string;
  readonly init: RequestInit | undefined;
};

function directUploadSession(overrides: Partial<ResourceDirectUploadSessionDto> = {}): ResourceDirectUploadSessionDto {
  return {
    deliveryAccess: 'SIGNED',
    provider: 'S3_OBJECT',
    resourceId: 'resource-1',
    resourceType: 'IMAGE',
    status: 'PENDING',
    storageRef: 'storage/resource-1',
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

test('uploadNimiRealmResourceFile uses vNext fallback mode from multipart POST to binary PUT', async () => {
  const { realm, finalizeRequests } = createFakeRealm(
    directUploadSession({
      resourceId: 'resource-video',
      resourceType: 'VIDEO',
      uploadUrl: 'https://upload.example/video',
    }),
    resourceDetail({ id: 'resource-video', resourceType: 'VIDEO' }),
  );
  const { fetchImpl, calls } = createFetch([
    new Response(null, { status: 503 }),
    new Response(null, { status: 200 }),
  ]);
  const file = new Blob(['video'], { type: 'video/mp4' });

  const result = await uploadNimiRealmResourceFile(realm, {
    kind: 'video',
    file,
    fetchImpl,
    transportMode: 'multipart_post_then_binary_put',
    deliveryAccess: 'PUBLIC',
  });

  assert.equal(result.resourceId, 'resource-video');
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(calls[1]?.init?.method, 'PUT');
  assert.equal((calls[1]?.init?.headers as Record<string, string> | undefined)?.['Content-Type'], 'video/mp4');
  assert.equal(finalizeRequests[0]?.body.deliveryAccess, 'PUBLIC');
});

test('uploadNimiRealmResourceFile fails closed for pre-vNext transport mode spelling', async () => {
  const { realm } = createFakeRealm();
  const { fetchImpl } = createFetch([new Response(null, { status: 204 })]);

  await assert.rejects(
    () => uploadNimiRealmResourceFile(realm, {
      kind: 'image',
      file: new Blob(['x'], { type: 'image/png' }),
      fetchImpl,
      transportMode: 'multipartPostThenBinaryPut' as NimiRealmResourceUploadTransportMode,
    }),
    (error) => isNimiError(error)
      && error.reasonCode === 'SDK_REALM_RESOURCE_UPLOAD_INPUT_INVALID'
      && error.actionHint === 'use_vnext_realm_resource_upload_transport_mode',
  );
});

test('Realm resources module binds finalizeResource for upload lifecycle completion', () => {
  assert.equal(REALM_RESOURCE_METHODS.includes('finalizeResource'), true);
});
