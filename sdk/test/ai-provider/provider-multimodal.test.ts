import assert from 'node:assert/strict';
import test from 'node:test';
import { toRuntimePrompt } from '../../src/ai-provider/helpers.js';
import { ChatContentPartType } from '../../src/runtime/generated/runtime/v1/ai.js';
import { ReasonCode } from '../../src/types/index.js';

test('toRuntimePrompt text-only prompt produces TEXT parts and correct content', () => {
  const result = toRuntimePrompt([
    { role: 'system', content: 'You are helpful' },
    {
      role: 'user',
      content: [{ type: 'text', text: 'Hello world' }],
    },
  ]);

  assert.equal(result.hasNonSystemInput, true);
  assert.equal(result.systemPrompt, 'You are helpful');
  assert.equal(result.input.length, 1);

  const msg = result.input[0]!;
  assert.equal(msg.role, 'user');
  assert.equal(msg.content, 'Hello world');
  assert.equal(msg.parts.length, 1);
  assert.equal(msg.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(msg.parts[0]!.content.oneofKind, 'text');
  assert.equal(msg.parts[0]!.content.text, 'Hello world');
});

test('toRuntimePrompt file part with URL object maps to IMAGE_URL part', () => {
  const result = toRuntimePrompt([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this' },
        { type: 'file', data: new URL('https://example.com/img.png'), mediaType: 'image/png' },
      ],
    },
  ]);

  assert.equal(result.hasNonSystemInput, true);
  assert.equal(result.input.length, 1);
  const msg = result.input[0]!;
  assert.equal(msg.content, 'Describe this');

  // TEXT part + IMAGE_URL part
  assert.equal(msg.parts.length, 2);
  assert.equal(msg.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(msg.parts[0]!.content.oneofKind, 'text');
  assert.equal(msg.parts[0]!.content.text, 'Describe this');
  assert.equal(msg.parts[1]!.type, ChatContentPartType.IMAGE_URL);
  assert.equal(msg.parts[1]!.content.oneofKind, 'imageUrl');
  assert.equal(msg.parts[1]!.content.imageUrl.url, 'https://example.com/img.png');
  assert.equal(msg.parts[1]!.content.imageUrl.detail, 'auto');
});

test('toRuntimePrompt file part with http string maps to IMAGE_URL part', () => {
  const result = toRuntimePrompt([
    {
      role: 'user',
      content: [
        { type: 'file', data: 'https://example.com/img.jpg', mediaType: 'image/jpeg' },
      ],
    },
  ]);

  assert.equal(result.hasNonSystemInput, true);
  assert.equal(result.input.length, 1);
  const msg = result.input[0]!;
  assert.equal(msg.parts.length, 1);
  assert.equal(msg.parts[0]!.type, ChatContentPartType.IMAGE_URL);
  assert.equal(msg.parts[0]!.content.oneofKind, 'imageUrl');
  assert.equal(msg.parts[0]!.content.imageUrl.url, 'https://example.com/img.jpg');
});

test('toRuntimePrompt file part with non-URL string fails closed for recognized media', () => {
  assert.throws(
    () => toRuntimePrompt([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'check this' },
          { type: 'file', data: 'base64encodeddata...', mediaType: 'image/png' },
        ],
      },
    ]),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.AI_INPUT_INVALID);
      return true;
    },
  );
});

test('toRuntimePrompt file part with video mediaType maps to VIDEO_URL part', () => {
  const result = toRuntimePrompt([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'watch this' },
        { type: 'file', data: new URL('https://example.com/demo.mp4'), mediaType: 'video/mp4' },
      ],
    },
  ]);

  assert.equal(result.hasNonSystemInput, true);
  assert.equal(result.input[0]!.parts[1]!.type, ChatContentPartType.VIDEO_URL);
  assert.equal(result.input[0]!.parts[1]!.content.oneofKind, 'videoUrl');
  assert.equal(result.input[0]!.parts[1]!.content.videoUrl, 'https://example.com/demo.mp4');
});

test('toRuntimePrompt file part with audio mediaType maps to AUDIO_URL part', () => {
  const result = toRuntimePrompt([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'listen' },
        { type: 'file', data: new URL('https://example.com/audio.mp3'), mediaType: 'audio/mp3' },
      ],
    },
  ]);

  assert.equal(result.input.length, 1);
  const msg = result.input[0]!;

  assert.equal(msg.parts.length, 2);
  assert.equal(msg.parts[1]!.type, ChatContentPartType.AUDIO_URL);
  assert.equal(msg.parts[1]!.content.oneofKind, 'audioUrl');
  assert.equal(msg.parts[1]!.content.audioUrl, 'https://example.com/audio.mp3');
});

test('toRuntimePrompt extracts text parts from system content arrays', () => {
  const result = toRuntimePrompt([
    {
      role: 'system',
      content: [
        { type: 'text', text: 'You are a vision assistant' },
        { type: 'file', data: new URL('https://example.com/system.png'), mediaType: 'image/png' },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'text', text: 'Describe the image' }],
    },
  ]);

  assert.equal(result.hasNonSystemInput, true);
  assert.equal(result.systemPrompt, 'You are a vision assistant');
  assert.equal(result.input.length, 1);
});

test('toRuntimePrompt preserves media-only messages and marks non-system input present', () => {
  const result = toRuntimePrompt([
    {
      role: 'user',
      content: [
        { type: 'file', data: new URL('https://example.com/image.png'), mediaType: 'image/png' },
      ],
    },
  ]);

  assert.equal(result.hasNonSystemInput, true);
  assert.equal(result.input.length, 1);
  assert.equal(result.input[0]!.parts.length, 1);
  assert.equal(result.input[0]!.parts[0]!.type, ChatContentPartType.IMAGE_URL);
});

test('toRuntimePrompt rejects unsafe loopback media URLs', () => {
  assert.throws(
    () => toRuntimePrompt([
      {
        role: 'user',
        content: [
          { type: 'file', data: new URL('https://127.0.0.1/private.png'), mediaType: 'image/png' },
        ],
      },
    ]),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.AI_INPUT_INVALID);
      return true;
    },
  );
});

test('toRuntimePrompt reasoning part maps to TEXT part', () => {
  const result = toRuntimePrompt([
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'thinking about this...' },
        { type: 'text', text: 'The answer is 42' },
      ],
    },
  ]);

  assert.equal(result.input.length, 1);
  const msg = result.input[0]!;

  // content is concatenation of reasoning + text
  assert.equal(msg.content, 'thinking about this...\nThe answer is 42');

  // both map to TEXT parts
  assert.equal(msg.parts.length, 2);
  assert.equal(msg.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(msg.parts[0]!.content.oneofKind, 'text');
  assert.equal(msg.parts[0]!.content.text, 'thinking about this...');
  assert.equal(msg.parts[1]!.type, ChatContentPartType.TEXT);
  assert.equal(msg.parts[1]!.content.oneofKind, 'text');
  assert.equal(msg.parts[1]!.content.text, 'The answer is 42');
});

test('toRuntimePrompt mixed file and text with URL object produces correct parts', () => {
  const result = toRuntimePrompt([
    { role: 'system', content: 'Analyze images' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Compare these' },
        { type: 'file', data: new URL('https://example.com/a.png'), mediaType: 'image/png' },
        { type: 'file', data: new URL('https://example.com/b.jpg'), mediaType: 'image/jpeg' },
      ],
    },
  ]);

  assert.equal(result.systemPrompt, 'Analyze images');
  assert.equal(result.input.length, 1);

  const msg = result.input[0]!;
  assert.equal(msg.parts.length, 3);
  assert.equal(msg.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(msg.parts[0]!.content.oneofKind, 'text');
  assert.equal(msg.parts[1]!.type, ChatContentPartType.IMAGE_URL);
  assert.equal(msg.parts[1]!.content.oneofKind, 'imageUrl');
  assert.equal(msg.parts[1]!.content.imageUrl.url, 'https://example.com/a.png');
  assert.equal(msg.parts[2]!.type, ChatContentPartType.IMAGE_URL);
  assert.equal(msg.parts[2]!.content.oneofKind, 'imageUrl');
  assert.equal(msg.parts[2]!.content.imageUrl.url, 'https://example.com/b.jpg');
});

test('toRuntimePrompt artifact-backed file part maps to ARTIFACT_REF', () => {
  const result = toRuntimePrompt([
    {
      role: 'user',
      content: [
        { type: 'file', artifactId: 'artifact-123', mediaType: 'video/mp4' },
      ],
    },
  ]);

  assert.equal(result.hasNonSystemInput, true);
  assert.equal(result.input[0]!.parts[0]!.type, ChatContentPartType.ARTIFACT_REF);
  assert.equal(result.input[0]!.parts[0]!.content.oneofKind, 'artifactRef');
  assert.equal(result.input[0]!.parts[0]!.content.artifactRef.artifactId, 'artifact-123');
  assert.equal(result.input[0]!.parts[0]!.content.artifactRef.mimeType, 'video/mp4');
});

test('toRuntimePrompt empty content message is skipped', () => {
  const result = toRuntimePrompt([
    {
      role: 'user',
      content: [{ type: 'text', text: 'real message' }],
    },
    {
      role: 'assistant',
      content: [],
    },
  ]);

  // empty content message should be filtered out
  assert.equal(result.input.length, 1);
  assert.equal(result.input[0]!.role, 'user');
});
