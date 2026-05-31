import assert from 'node:assert/strict';
import test from 'node:test';

import {
  uploadRealmResourceFile,
  uploadRealmResourceFileWithRealm,
  type RealmResourceUploadClient,
} from '../../src/realm/index.js';

function createClient(events: string[]): RealmResourceUploadClient {
  return {
    async createImageDirectUpload() {
      events.push('create:image');
      return {
        resourceId: 'resource-image-1',
        uploadUrl: 'https://upload.nimi.test/image-1',
        storageRef: 'storage/image-1',
        resourceType: 'IMAGE',
        deliveryAccess: 'SIGNED',
        provider: 'S3_OBJECT',
        status: 'PENDING',
      };
    },
    async createVideoDirectUpload() {
      events.push('create:video');
      return {
        resourceId: 'resource-video-1',
        uploadUrl: 'https://upload.nimi.test/video-1',
        storageRef: 'storage/video-1',
        resourceType: 'VIDEO',
        deliveryAccess: 'SIGNED',
        provider: 'S3_OBJECT',
        status: 'PENDING',
      };
    },
    async finalizeResource(resourceId) {
      events.push(`finalize:${resourceId}`);
      return {
        id: resourceId,
        type: 'IMAGE',
        status: 'READY',
        url: `/api/resources/${resourceId}`,
      } as never;
    },
  };
}

test('uploadRealmResourceFile posts multipart data and finalizes the Realm resource', async () => {
  const events: string[] = [];
  const result = await uploadRealmResourceFile({
    kind: 'image',
    file: new Blob(['image'], { type: 'image/png' }),
    client: createClient(events),
    fetchImpl: async (url, init) => {
      events.push(`fetch:${String(init?.method)}:${url}`);
      assert.ok(init?.body instanceof FormData);
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(result.resourceId, 'resource-image-1');
  assert.equal(result.resource.id, 'resource-image-1');
  assert.deepEqual(events, [
    'create:image',
    'fetch:POST:https://upload.nimi.test/image-1',
    'finalize:resource-image-1',
  ]);
});

test('uploadRealmResourceFile can use binary PUT after a rejected multipart POST', async () => {
  const events: string[] = [];
  const file = new Blob(['video'], { type: 'video/mp4' });

  const result = await uploadRealmResourceFile({
    kind: 'video',
    file,
    client: createClient(events),
    transportMode: 'multipartPostThenBinaryPut',
    fetchImpl: async (url, init) => {
      events.push(`fetch:${String(init?.method)}:${url}`);
      if (init?.method === 'POST') {
        return new Response(null, { status: 405 });
      }
      assert.equal(init?.body, file);
      assert.deepEqual(init?.headers, { 'Content-Type': 'video/mp4' });
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(result.resourceId, 'resource-video-1');
  assert.deepEqual(events, [
    'create:video',
    'fetch:POST:https://upload.nimi.test/video-1',
    'fetch:PUT:https://upload.nimi.test/video-1',
    'finalize:resource-video-1',
  ]);
});

test('uploadRealmResourceFile fails closed before finalize when upload transport fails', async () => {
  const events: string[] = [];

  await assert.rejects(
    () => uploadRealmResourceFile({
      kind: 'image',
      file: new Blob(['image'], { type: 'image/png' }),
      client: createClient(events),
      failureMessage: 'Image upload failed',
      fetchImpl: async () => {
        events.push('fetch');
        return new Response(null, { status: 500 });
      },
    }),
    /Image upload failed/,
  );

  assert.deepEqual(events, ['create:image', 'fetch']);
});

test('uploadRealmResourceFileWithRealm builds the SDK Realm resource client adapter', async () => {
  const events: string[] = [];
  const result = await uploadRealmResourceFileWithRealm({
    realm: {
      services: {
        ResourcesService: {
          createImageDirectUpload: createClient(events).createImageDirectUpload,
          createVideoDirectUpload: createClient(events).createVideoDirectUpload,
          createAudioDirectUpload: async () => {
            throw new Error('audio not used');
          },
          finalizeResource: createClient(events).finalizeResource,
        },
      },
    } as never,
    kind: 'image',
    file: new Blob(['image'], { type: 'image/png' }),
    fetchImpl: async (url, init) => {
      events.push(`fetch:${String(init?.method)}:${url}`);
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(result.resourceId, 'resource-image-1');
  assert.deepEqual(events, [
    'create:image',
    'fetch:POST:https://upload.nimi.test/image-1',
    'finalize:resource-image-1',
  ]);
});
