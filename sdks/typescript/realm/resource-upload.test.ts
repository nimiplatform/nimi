import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import type { ResourceDetailDto, ResourceDirectUploadSessionDto, CreateMediaDirectUploadDto } from '../core-generated/realm-typed-client';
import { uploadNimiRealmResourceFile, type NimiRealmResourceUploadApi } from './resource-upload.js';

const file = new Blob(['verified original'], { type: 'image/png' });
const hash = createHash('sha256').update('verified original').digest('hex');
function detail(state: 'PROCESSING' | 'PUBLISHING' | 'READY' | 'FAILED' = 'READY'): ResourceDetailDto {
  return { id: 'resource-1', resourceType: 'IMAGE', provider: 'S3_OBJECT', mimeType: 'image/png', status: state === 'PROCESSING' ? 'PENDING' : state === 'FAILED' ? 'FAILED' : 'READY', hashSha256: hash, sizeBytes: file.size, controllerId: 'owner', controllerKind: 'ACCOUNT', uploaderAccountId: 'owner', provenance: 'UPLOADED', deliveryAccess: 'SIGNED', tags: [], createdAt: '2026-10-26T00:00:00Z', updatedAt: '2026-10-26T00:00:00Z', externalUrl: null,
    deliveryStatus: { state, failureCode: state === 'FAILED' ? 'MEDIA_ORIGINAL_HASH_MISMATCH' : null, revocationNotBefore: null },
    delivery: state === 'READY' ? { resourceId: 'resource-1', contentVersion: hash, publicationGeneration: 1, policyVersion: 'v1', expiresAt: '2026-10-26T00:05:00Z', images: [], previewUrl: null, originalUrl: 'https://media.example/original', video: null } : null };
}
function fake(initial: ResourceDetailDto = detail()) {
  let prepared: CreateMediaDirectUploadDto | undefined;
  let finalized: unknown;
  let cancelled = false;
  let polls = 0;
  const prepare = async (request: { body: CreateMediaDirectUploadDto }): Promise<ResourceDirectUploadSessionDto> => {
    prepared = request.body;
    return { resourceId: 'resource-1', requestId: request.body.requestId, resourceType: 'IMAGE', deliveryAccess: 'SIGNED', status: 'PENDING', transport: { method: 'PUT', bodyKind: 'BINARY', contentType: request.body.mimeType }, uploadUrl: 'https://upload.example/staging', expiresIn: 300 };
  };
  const api: NimiRealmResourceUploadApi = { resources: {
    createImageDirectUpload: prepare, createVideoDirectUpload: prepare, createAudioDirectUpload: prepare,
    finalizeResource: async (request) => { finalized = request; return initial; },
    getResource: async () => { polls++; return detail(); },
    cancelResourceUpload: async () => { cancelled = true; return detail('FAILED'); },
  } };
  return { api, prepared: () => prepared, finalized: () => finalized, polls: () => polls, cancelled: () => cancelled };
}

test('uploads exact bytes through the declared binary transport and commits only the intent ID', async () => {
  const x = fake(); let transport: RequestInit | undefined;
  const result = await uploadNimiRealmResourceFile(x.api, { kind: 'image', file, requestId: 'request-1', metadata: { label: 'Example' }, fetchImpl: async (_url, init) => { transport = init; return new Response(null, { status: 200 }); } });
  assert.equal(x.prepared()?.hashSha256, hash); assert.equal(x.prepared()?.sizeBytes, file.size);
  assert.equal(x.prepared()?.deliveryAccess, 'SIGNED');
  assert.deepEqual(x.finalized(), { path: { resourceId: 'resource-1' }, body: { requestId: 'request-1' } });
  assert.equal(transport?.body, file); assert.equal(transport?.method, 'PUT'); assert.equal(transport?.credentials, 'omit');
  assert.equal(result.resource.deliveryStatus.state, 'READY');
});

test('does not mistake prepared bytes for effective publication', async () => {
  const x = fake(detail('PUBLISHING'));
  await uploadNimiRealmResourceFile(x.api, { kind: 'image', file, fetchImpl: async () => new Response(null, { status: 200 }) });
  assert.equal(x.polls(), 1);
});

test('rejects measured hash mismatch and real processing failure', async () => {
  for (const resource of [{ ...detail(), hashSha256: 'b'.repeat(64) }, detail('FAILED')]) {
    const x = fake(resource);
    await assert.rejects(uploadNimiRealmResourceFile(x.api, { kind: 'image', file, fetchImpl: async () => new Response(null, { status: 200 }) }));
  }
});

test('aborting processing attempts intent cancellation without forwarding the aborted signal', async () => {
  const abort = new AbortController(); const x = fake(detail('PROCESSING'));
  await assert.rejects(uploadNimiRealmResourceFile(x.api, { kind: 'image', file, options: { signal: abort.signal }, onProgress: (p) => { if (p.phase === 'processing') abort.abort(); }, fetchImpl: async () => new Response(null, { status: 200 }) }));
  assert.equal(x.cancelled(), true);
});

test('does not finalize a failed binary transfer', async () => {
  const x = fake();
  await assert.rejects(uploadNimiRealmResourceFile(x.api, { kind: 'image', file, requestId: 'retryable-request', fetchImpl: async () => new Response(null, { status: 403 }) }), (error: unknown) => {
    const details = (error as { details: Record<string, unknown> }).details;
    assert.equal(details.resourceId, 'resource-1'); assert.equal(details.requestId, 'retryable-request');
    return true;
  });
  assert.equal(x.finalized(), undefined);
});

test('normalizes browser MIME aliases and parameters before preparing the immutable upload', async () => {
  const x = fake({ ...detail(), mimeType: 'image/jpeg' });
  await uploadNimiRealmResourceFile(x.api, { kind: 'image', file, contentType: 'image/jpg; charset=binary', fetchImpl: async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('content-type'), 'image/jpeg'); return new Response(null, { status: 200 });
  } });
  assert.equal(x.prepared()?.mimeType, 'image/jpeg');
});
