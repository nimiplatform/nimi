import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadTurnAttachmentsModule() {
  const sourcePath = path.join(root, 'src/shell/agent-chat/turn-attachments.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

function objectUrlDeps(calls) {
  let sequence = 0;
  return {
    createObjectUrl: () => {
      sequence += 1;
      return `blob:preview-${sequence}`;
    },
    revokeObjectUrl: (url) => {
      calls.push(['revoke', url]);
    },
  };
}

function imageFile(overrides = {}) {
  return {
    type: 'image/png',
    name: 'photo.png',
    size: 4,
    arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    ...overrides,
  };
}

test('Zhiyu pending attachments admit one image and reject other shapes', async () => {
  const module = await loadTurnAttachmentsModule();
  const calls = [];
  const deps = objectUrlDeps(calls);

  const first = module.appendZhiyuPendingAttachment([], imageFile(), deps);
  assert.equal(first.length, 1);
  assert.equal(first[0].name, 'photo.png');
  assert.equal(first[0].previewUrl, 'blob:preview-1');

  assert.equal(module.appendZhiyuPendingAttachment(first, imageFile({ name: 'second.png' }), deps), null);
  assert.equal(module.appendZhiyuPendingAttachment([], imageFile({ type: 'application/pdf' }), deps), null);
  assert.equal(module.isZhiyuAttachmentFileAdmitted({ type: 'image/webp' }), true);
  assert.equal(module.isZhiyuAttachmentFileAdmitted({ type: 'video/mp4' }), false);

  const remaining = module.removeZhiyuPendingAttachmentAt(first, 0, deps.revokeObjectUrl);
  assert.deepEqual(remaining, []);
  assert.deepEqual(calls, [['revoke', 'blob:preview-1']]);
});

test('Zhiyu chat attachment upload forwards exact bytes and projects the artifact id', async () => {
  const module = await loadTurnAttachmentsModule();
  const uploads = [];
  const uploaded = await module.uploadZhiyuChatAttachment(
    {
      file: imageFile(),
      previewUrl: 'blob:preview-1',
      name: 'photo.png',
    },
    async (input) => {
      uploads.push(input);
      return { artifactId: 'artifact_01J' };
    },
  );
  assert.deepEqual(uploaded, { artifactId: 'artifact_01J', displayName: 'photo.png' });
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].mimeType, 'image/png');
  assert.equal(uploads[0].displayName, 'photo.png');
  assert.ok(uploads[0].data instanceof Uint8Array);
  assert.deepEqual([...uploads[0].data], [137, 80, 78, 71]);

  await assert.rejects(
    () => module.uploadZhiyuChatAttachment(
      { file: imageFile(), previewUrl: 'blob:preview-2', name: 'photo.png' },
      async () => ({ artifactId: '  ' }),
    ),
    /no artifactId/u,
  );
});

test('Zhiyu attachment media resolution encodes bytes and fails soft', async () => {
  const module = await loadTurnAttachmentsModule();

  const resolved = await module.resolveZhiyuChatAttachmentMedia(
    'artifact_01J',
    'image/png',
    async () => ({ bytes: new Uint8Array([137, 80, 78, 71]), mimeType: 'image/png' }),
  );
  assert.equal(resolved.mediaMimeType, 'image/png');
  assert.match(resolved.mediaUrl, /^data:image\/png;base64,iVBORw=/u);

  const fallback = await module.resolveZhiyuChatAttachmentMedia(
    'artifact_01J',
    'image/webp',
    async () => ({ bytes: new Uint8Array([1]), mimeType: '' }),
  );
  assert.equal(fallback.mediaMimeType, 'image/webp');

  const failed = await module.resolveZhiyuChatAttachmentMedia(
    'artifact_missing',
    'image/png',
    async () => { throw new Error('not found'); },
  );
  assert.equal(failed, null);

  const empty = await module.resolveZhiyuChatAttachmentMedia(
    'artifact_01J',
    'image/png',
    async () => ({ bytes: new Uint8Array(0), mimeType: 'image/png' }),
  );
  assert.equal(empty, null);

  assert.match(
    module.encodeZhiyuBytesAsDataUrl('image/png', new Uint8Array([137, 80, 78, 71])),
    /^data:image\/png;base64,iVBORw=/u,
  );
});
