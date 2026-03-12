import assert from 'node:assert/strict';
import test from 'node:test';
import { toRuntimeMessages } from '../../src/runtime/helpers.js';
import { ChatContentPartType } from '../../src/runtime/generated/runtime/v1/ai.js';

test('toRuntimeMessages string input creates TEXT part for content', () => {
  const result = toRuntimeMessages('hello');

  assert.equal(result.input.length, 1);
  assert.equal(result.input[0]!.role, 'user');
  assert.equal(result.input[0]!.content, 'hello');
  assert.equal(result.input[0]!.parts.length, 1);
  assert.equal(result.input[0]!.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(result.input[0]!.parts[0]!.text, 'hello');
});

test('toRuntimeMessages TextMessage with string content creates TEXT part', () => {
  const result = toRuntimeMessages([
    { role: 'user', content: 'hi' },
  ]);

  assert.equal(result.input.length, 1);
  assert.equal(result.input[0]!.content, 'hi');
  assert.equal(result.input[0]!.parts.length, 1);
  assert.equal(result.input[0]!.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(result.input[0]!.parts[0]!.text, 'hi');
});

test('toRuntimeMessages TextMessage with multimodal content builds parts and dual-writes text', () => {
  const result = toRuntimeMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'desc' },
        { type: 'image_url', imageUrl: 'https://example.com/img.png', detail: 'high' as const },
      ],
    },
  ]);

  assert.equal(result.input.length, 1);
  const msg = result.input[0]!;

  // dual-write: content field has concatenated text
  assert.equal(msg.content, 'desc');

  // parts array has both TEXT and IMAGE_URL entries
  assert.equal(msg.parts.length, 2);

  assert.equal(msg.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(msg.parts[0]!.text, 'desc');

  assert.equal(msg.parts[1]!.type, ChatContentPartType.IMAGE_URL);
  assert.equal(msg.parts[1]!.text, '');
  assert.equal(msg.parts[1]!.imageUrl?.url, 'https://example.com/img.png');
  assert.equal(msg.parts[1]!.imageUrl?.detail, 'high');
});

test('toRuntimeMessages system message with multimodal content extracts text only', () => {
  const result = toRuntimeMessages([
    {
      role: 'system',
      content: [
        { type: 'text', text: 'system instructions' },
        { type: 'image_url', imageUrl: 'https://example.com/sys.png' },
      ],
    },
    { role: 'user', content: 'hello' },
  ]);

  // system text extracted into systemPrompt
  assert.equal(result.systemPrompt, 'system instructions');

  // only the user message survives in input
  assert.equal(result.input.length, 1);
  assert.equal(result.input[0]!.role, 'user');
  assert.equal(result.input[0]!.content, 'hello');
});

test('toRuntimeMessages skips empty/whitespace-only text parts in multimodal', () => {
  const result = toRuntimeMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'describe this' },
        { type: 'text', text: '  ' },
        { type: 'image_url', imageUrl: 'https://example.com/img.png' },
      ],
    },
  ]);

  assert.equal(result.input.length, 1);
  const msg = result.input[0]!;

  // content has only the non-whitespace text
  assert.equal(msg.content, 'describe this');

  // parts should have TEXT + IMAGE_URL, whitespace text skipped
  assert.equal(msg.parts.length, 2);
  assert.equal(msg.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(msg.parts[0]!.text, 'describe this');
  assert.equal(msg.parts[1]!.type, ChatContentPartType.IMAGE_URL);
});

test('toRuntimeMessages multimodal content with multiple text parts concatenates with newline', () => {
  const result = toRuntimeMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'line one' },
        { type: 'text', text: 'line two' },
      ],
    },
  ]);

  assert.equal(result.input.length, 1);
  assert.equal(result.input[0]!.content, 'line one\nline two');
  assert.equal(result.input[0]!.parts.length, 2);
  assert.equal(result.input[0]!.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(result.input[0]!.parts[1]!.type, ChatContentPartType.TEXT);
});

test('toRuntimeMessages video_url part maps to VIDEO_URL type', () => {
  const result = toRuntimeMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'watch this' },
        { type: 'video_url', videoUrl: 'https://example.com/video.mp4' },
      ],
    },
  ]);

  assert.equal(result.input[0]!.parts.length, 2);
  assert.equal(result.input[0]!.parts[1]!.type, ChatContentPartType.VIDEO_URL);
  assert.equal(result.input[0]!.parts[1]!.videoUrl, 'https://example.com/video.mp4');
});

test('toRuntimeMessages image_url defaults detail to auto', () => {
  const result = toRuntimeMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'look at this' },
        { type: 'image_url', imageUrl: 'https://example.com/img.png' },
      ],
    },
  ]);

  // IMAGE_URL is the second part (after TEXT)
  const part = result.input[0]!.parts[1]!;
  assert.equal(part.type, ChatContentPartType.IMAGE_URL);
  assert.equal(part.imageUrl?.detail, 'auto');
});

test('toRuntimeMessages explicit system param merges with inline system messages', () => {
  const result = toRuntimeMessages(
    [
      { role: 'system', content: 'inline system' },
      { role: 'user', content: 'hello' },
    ],
    'explicit system',
  );

  assert.equal(result.systemPrompt, 'inline system\n\nexplicit system');
});
