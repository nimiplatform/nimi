import assert from 'node:assert/strict';
import test from 'node:test';
import { toRuntimeMessages } from '../../src/runtime/helpers.js';
import { ChatContentPartType } from '../../src/runtime/generated/runtime/v1/ai.js';
import { ReasonCode } from '../../src/types/index.js';

test('toRuntimeMessages string input creates TEXT part for content', () => {
  const result = toRuntimeMessages('hello');

  assert.equal(result.input.length, 1);
  assert.equal(result.input[0]!.role, 'user');
  assert.equal(result.input[0]!.content, 'hello');
  assert.equal(result.input[0]!.parts.length, 1);
  assert.equal(result.input[0]!.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(result.input[0]!.parts[0]!.content.oneofKind, 'text');
  assert.equal(result.input[0]!.parts[0]!.content.text, 'hello');
});

test('toRuntimeMessages TextMessage with string content creates TEXT part', () => {
  const result = toRuntimeMessages([
    { role: 'user', content: 'hi' },
  ]);

  assert.equal(result.input.length, 1);
  assert.equal(result.input[0]!.content, 'hi');
  assert.equal(result.input[0]!.parts.length, 1);
  assert.equal(result.input[0]!.parts[0]!.type, ChatContentPartType.TEXT);
  assert.equal(result.input[0]!.parts[0]!.content.oneofKind, 'text');
  assert.equal(result.input[0]!.parts[0]!.content.text, 'hi');
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
  assert.equal(msg.parts[0]!.content.oneofKind, 'text');
  assert.equal(msg.parts[0]!.content.text, 'desc');

  assert.equal(msg.parts[1]!.type, ChatContentPartType.IMAGE_URL);
  assert.equal(msg.parts[1]!.content.oneofKind, 'imageUrl');
  assert.equal(msg.parts[1]!.content.imageUrl.url, 'https://example.com/img.png');
  assert.equal(msg.parts[1]!.content.imageUrl.detail, 'high');
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
  assert.equal(msg.parts[0]!.content.oneofKind, 'text');
  assert.equal(msg.parts[0]!.content.text, 'describe this');
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

test('toRuntimeMessages keeps video_url, audio_url and artifact_ref parts', () => {
  const result = toRuntimeMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'watch and listen' },
        { type: 'video_url', videoUrl: 'https://example.com/video.mp4' },
        { type: 'audio_url', audioUrl: 'https://example.com/audio.mp3' },
        { type: 'artifact_ref', artifactId: 'artifact-1', mimeType: 'image/png' },
      ],
    },
  ]);

  assert.equal(result.input.length, 1);
  assert.equal(result.input[0]!.parts.length, 4);
  assert.equal(result.input[0]!.parts[1]!.type, ChatContentPartType.VIDEO_URL);
  assert.equal(result.input[0]!.parts[1]!.content.oneofKind, 'videoUrl');
  assert.equal(result.input[0]!.parts[1]!.content.videoUrl, 'https://example.com/video.mp4');
  assert.equal(result.input[0]!.parts[2]!.type, ChatContentPartType.AUDIO_URL);
  assert.equal(result.input[0]!.parts[2]!.content.oneofKind, 'audioUrl');
  assert.equal(result.input[0]!.parts[2]!.content.audioUrl, 'https://example.com/audio.mp3');
  assert.equal(result.input[0]!.parts[3]!.type, ChatContentPartType.ARTIFACT_REF);
  assert.equal(result.input[0]!.parts[3]!.content.oneofKind, 'artifactRef');
  assert.equal(result.input[0]!.parts[3]!.content.artifactRef.artifactId, 'artifact-1');
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
  assert.equal(part.content.oneofKind, 'imageUrl');
  assert.equal(part.content.imageUrl.detail, 'auto');
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

test('toRuntimeMessages rejects artifact_ref without identifiers', () => {
  assert.throws(
    () => toRuntimeMessages([
      {
        role: 'user',
        content: [
          { type: 'artifact_ref', mimeType: 'image/png' },
        ],
      },
    ]),
    (error: unknown) => {
      assert.equal(typeof error, 'object');
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.AI_INPUT_INVALID);
      return true;
    },
  );
});
