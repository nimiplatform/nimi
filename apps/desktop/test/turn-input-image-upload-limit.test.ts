import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONVERSATION_IMAGE_ATTACHMENT_MAX_BYTES,
  ConversationImageAttachmentError,
  prepareConversationImageAttachment,
  type ConversationImageReencodeRequest,
  type ConversationImageReencoder,
} from '../src/shell/renderer/features/turns/turn-input-image-upload-limit.js';

function fileOfSize(bytes: number, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function fakeReencoder(input: {
  size: { width: number; height: number } | null;
  bytesFor: (request: ConversationImageReencodeRequest) => number | null;
  calls?: ConversationImageReencodeRequest[];
}): ConversationImageReencoder {
  return {
    measure: async () => input.size,
    encode: async (request) => {
      input.calls?.push(request);
      const length = input.bytesFor(request);
      return length === null ? null : new Uint8Array(length);
    },
  };
}

describe('Conversation image attachment upload limit', () => {
  test('sends a supported in-limit image untouched', async () => {
    const file = fileOfSize(1024, 'photo.png', 'image/png');
    const calls: ConversationImageReencodeRequest[] = [];
    const prepared = await prepareConversationImageAttachment(file, {
      reencoder: fakeReencoder({ size: { width: 10, height: 10 }, bytesFor: () => 1, calls }),
    });

    assert.equal(prepared.reencoded, false);
    assert.equal(prepared.mimeType, 'image/png');
    assert.equal(prepared.bytes.byteLength, 1024);
    assert.equal(calls.length, 0);
  });

  test('re-encodes an oversize image down the scale ladder until it fits', async () => {
    const file = fileOfSize(CONVERSATION_IMAGE_ATTACHMENT_MAX_BYTES + 1, 'big.png', 'image/png');
    const calls: ConversationImageReencodeRequest[] = [];
    const prepared = await prepareConversationImageAttachment(file, {
      reencoder: fakeReencoder({
        size: { width: 4000, height: 3000 },
        // Full-size attempts stay oversize; the 0.7 scale fits.
        bytesFor: (request) => (request.width <= 2800 ? 3 * 1024 * 1024 : 5 * 1024 * 1024),
        calls,
      }),
    });

    assert.equal(prepared.reencoded, true);
    assert.equal(prepared.mimeType, 'image/webp');
    assert.equal(prepared.bytes.byteLength, 3 * 1024 * 1024);
    assert.deepEqual(calls.map((call) => [call.width, call.height, call.quality]), [
      [4000, 3000, 0.85],
      [4000, 3000, 0.7],
      [3400, 2550, 0.85],
      [3400, 2550, 0.7],
      [2800, 2100, 0.85],
    ]);
    assert.ok(calls.every((call) => call.mimeType === 'image/webp' && call.file === file));
  });

  test('re-encodes an unsupported but decodable format even when small', async () => {
    const file = fileOfSize(512, 'shot.bmp', 'image/bmp');
    const prepared = await prepareConversationImageAttachment(file, {
      reencoder: fakeReencoder({ size: { width: 8, height: 8 }, bytesFor: () => 300 }),
    });

    assert.equal(prepared.reencoded, true);
    assert.equal(prepared.mimeType, 'image/webp');
  });

  test('reports too-large when no ladder step fits', async () => {
    const file = fileOfSize(CONVERSATION_IMAGE_ATTACHMENT_MAX_BYTES * 3, 'huge.jpg', 'image/jpeg');
    await assert.rejects(
      prepareConversationImageAttachment(file, {
        reencoder: fakeReencoder({ size: { width: 100, height: 100 }, bytesFor: () => CONVERSATION_IMAGE_ATTACHMENT_MAX_BYTES + 1 }),
      }),
      (error: unknown) => error instanceof ConversationImageAttachmentError && error.reason === 'too-large',
    );
  });

  test('reports unsupported-format when the image cannot be decoded', async () => {
    const file = fileOfSize(CONVERSATION_IMAGE_ATTACHMENT_MAX_BYTES + 1, 'vector.svg', 'image/svg+xml');
    await assert.rejects(
      prepareConversationImageAttachment(file, {
        reencoder: fakeReencoder({ size: null, bytesFor: () => 1 }),
      }),
      (error: unknown) => error instanceof ConversationImageAttachmentError && error.reason === 'unsupported-format',
    );
  });

  test('treats encoder failures as a miss and keeps descending the ladder', async () => {
    const file = fileOfSize(CONVERSATION_IMAGE_ATTACHMENT_MAX_BYTES + 1, 'big.webp', 'image/webp');
    const prepared = await prepareConversationImageAttachment(file, {
      reencoder: fakeReencoder({
        size: { width: 1000, height: 1000 },
        bytesFor: (request) => (request.width === 1000 ? null : 100),
      }),
    });

    assert.equal(prepared.reencoded, true);
    assert.equal(prepared.bytes.byteLength, 100);
  });
});
