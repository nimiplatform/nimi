import assert from 'node:assert/strict';
import test from 'node:test';
import { toRuntimePrompt } from '../../src/ai-provider/helpers.js';
import { ChatContentPartType } from '../../src/runtime/generated/runtime/v1/ai.js';

test('toRuntimePrompt text-only prompt produces TEXT parts and correct content', () => {
  const result = toRuntimePrompt([
    { role: 'system', content: 'You are helpful' },
    {
      role: 'user',
      content: [{ type: 'text', text: 'Hello world' }],
    },
  ]);

  assert.equal(result.hasTextInput, true);
  assert.equal(result.systemPrompt, 'You are helpful');
  assert.equal(result.input.length, 1);

  const msg = result.input[0]!;
  assert.equal(msg.role, 'user');
  assert.equal(msg.content, 'Hello world');
  assert.equal(msg.parts.length, 1);
  assert.equal(msg.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(msg.parts[0]!.text, 'Hello world');
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

  assert.equal(result.hasTextInput, true);
  assert.equal(result.input.length, 1);
  const msg = result.input[0]!;
  assert.equal(msg.content, 'Describe this');

  // TEXT part + IMAGE_URL part
  assert.equal(msg.parts.length, 2);
  assert.equal(msg.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(msg.parts[0]!.text, 'Describe this');
  assert.equal(msg.parts[1]!.type, ChatContentPartType.IMAGE_URL);
  assert.equal(msg.parts[1]!.imageUrl?.url, 'https://example.com/img.png');
  assert.equal(msg.parts[1]!.imageUrl?.detail, 'auto');
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

  assert.equal(result.hasTextInput, false);
  assert.equal(result.input.length, 1);
  const msg = result.input[0]!;
  assert.equal(msg.parts.length, 1);
  assert.equal(msg.parts[0]!.type, ChatContentPartType.IMAGE_URL);
  assert.equal(msg.parts[0]!.imageUrl?.url, 'https://example.com/img.jpg');
});

test('toRuntimePrompt file part with non-URL string is skipped (v1 URL-only)', () => {
  const result = toRuntimePrompt([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'check this' },
        { type: 'file', data: 'base64encodeddata...', mediaType: 'image/png' },
      ],
    },
  ]);

  assert.equal(result.hasTextInput, true);
  assert.equal(result.input.length, 1);
  const msg = result.input[0]!;

  // only the TEXT part should be present; non-URL string file part is skipped
  assert.equal(msg.parts.length, 1);
  assert.equal(msg.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(msg.parts[0]!.text, 'check this');
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

  assert.equal(result.hasTextInput, true);
  assert.equal(result.input.length, 1);
  const msg = result.input[0]!;
  assert.equal(msg.parts.length, 2);
  assert.equal(msg.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(msg.parts[1]!.type, ChatContentPartType.VIDEO_URL);
  assert.equal(msg.parts[1]!.videoUrl, 'https://example.com/demo.mp4');
});

test('toRuntimePrompt file part with audio mediaType is skipped', () => {
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

  // only the TEXT part; audio file type is not supported in v1
  assert.equal(msg.parts.length, 1);
  assert.equal(msg.parts[0]!.type, ChatContentPartType.TEXT);
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

  assert.equal(result.hasTextInput, true);
  assert.equal(result.systemPrompt, 'You are a vision assistant');
  assert.equal(result.input.length, 1);
});

test('toRuntimePrompt preserves media-only messages but marks missing text input', () => {
  const result = toRuntimePrompt([
    {
      role: 'user',
      content: [
        { type: 'file', data: new URL('https://example.com/image.png'), mediaType: 'image/png' },
      ],
    },
  ]);

  assert.equal(result.hasTextInput, false);
  assert.equal(result.input.length, 1);
  assert.equal(result.input[0]!.parts.length, 1);
  assert.equal(result.input[0]!.parts[0]!.type, ChatContentPartType.IMAGE_URL);
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
  assert.equal(msg.parts[0]!.text, 'thinking about this...');
  assert.equal(msg.parts[1]!.type, ChatContentPartType.TEXT);
  assert.equal(msg.parts[1]!.text, 'The answer is 42');
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
  assert.equal(msg.parts[1]!.type, ChatContentPartType.IMAGE_URL);
  assert.equal(msg.parts[1]!.imageUrl?.url, 'https://example.com/a.png');
  assert.equal(msg.parts[2]!.type, ChatContentPartType.IMAGE_URL);
  assert.equal(msg.parts[2]!.imageUrl?.url, 'https://example.com/b.jpg');
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
