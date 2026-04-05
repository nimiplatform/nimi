import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  appendPendingAttachment,
  buildPendingAttachment,
  clearPendingAttachments,
  formatPendingAttachmentSize,
  getTurnInputSendPlan,
  removePendingAttachmentAt,
} from '../src/shell/renderer/features/turns/turn-input-attachments.js';
import {
  addChatUploadPlaceholder,
  createChatUploadPlaceholder,
  getChatUploadPlaceholders,
  removeChatUploadPlaceholder,
} from '../src/shell/renderer/features/turns/chat-upload-placeholder-store.js';

const turnInputSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/turns/turn-input.tsx'),
  'utf8',
);
const messageTimelineSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/turns/message-timeline.tsx'),
  'utf8',
);
const humanConversationTranscriptSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/turns/human-conversation-transcript.tsx'),
  'utf8',
);

describe('TurnInput attachment staging helpers', () => {
  test('stages image attachments instead of sending immediately', () => {
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    const attachment = buildPendingAttachment(file, 'blob:image');

    assert.ok(attachment);
    assert.equal(attachment?.kind, 'image');
    assert.equal(attachment?.name, 'photo.png');
    assert.equal(attachment?.previewUrl, 'blob:image');
  });

  test('stages video attachments instead of sending immediately', () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    const attachment = buildPendingAttachment(file, 'blob:video');

    assert.ok(attachment);
    assert.equal(attachment?.kind, 'video');
    assert.equal(attachment?.name, 'clip.mp4');
  });

  test('clipboard images and picker images share the same pending attachment model', () => {
    const file = new File(['image'], 'pasted.png', { type: 'image/png' });

    const fromPaste = buildPendingAttachment(file, 'blob:paste');
    const fromPicker = buildPendingAttachment(file, 'blob:picker');

    assert.equal(fromPaste?.kind, 'image');
    assert.equal(fromPicker?.kind, 'image');
    assert.equal(fromPaste?.name, fromPicker?.name);
  });

  test('appending attachments keeps earlier attachments instead of replacing them', () => {
    const first = buildPendingAttachment(
      new File(['image'], 'first.png', { type: 'image/png' }),
      'blob:first',
    );
    assert.ok(first);

    const appended = appendPendingAttachment([first], new File(['video'], 'second.mp4', { type: 'video/mp4' }), {
      createObjectUrl: () => 'blob:second',
      revokeObjectUrl: () => undefined,
    });

    assert.equal(appended?.length, 2);
    assert.equal(appended?.[0]?.name, 'first.png');
    assert.equal(appended?.[1]?.kind, 'video');
  });

  test('removing a single attachment only revokes that attachment preview url', () => {
    const revoked: string[] = [];
    const first = buildPendingAttachment(new File(['image'], 'first.png', { type: 'image/png' }), 'blob:first');
    const second = buildPendingAttachment(new File(['video'], 'second.mp4', { type: 'video/mp4' }), 'blob:second');
    assert.ok(first);
    assert.ok(second);
    const attachments = [first, second];

    const remaining = removePendingAttachmentAt(attachments, 0, (url) => revoked.push(url));

    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.name, 'second.mp4');
    assert.deepEqual(revoked, ['blob:first']);
  });

  test('clearing all attachments revokes every preview url', () => {
    const revoked: string[] = [];
    const first = buildPendingAttachment(new File(['image'], 'first.png', { type: 'image/png' }), 'blob:first');
    const second = buildPendingAttachment(new File(['video'], 'second.mp4', { type: 'video/mp4' }), 'blob:second');
    assert.ok(first);
    assert.ok(second);
    const attachments = [first, second];

    const cleared = clearPendingAttachments(attachments, (url) => revoked.push(url));

    assert.deepEqual(cleared, []);
    assert.deepEqual(revoked, ['blob:first', 'blob:second']);
  });

  test('formats attachment sizes in KB and MB', () => {
    assert.equal(formatPendingAttachmentSize(764620.8), '746.7 KB');
    assert.equal(formatPendingAttachmentSize(2.5 * 1024 * 1024), '2.5 MB');
  });

  test('upload placeholders can be added and removed for a chat', () => {
    const placeholder = createChatUploadPlaceholder({
      chatId: 'chat-1',
      previewUrl: 'blob:preview',
      kind: 'image',
      senderId: 'user-1',
      createdAt: '2025-01-01T00:00:00.000Z',
    });

    addChatUploadPlaceholder(placeholder);
    assert.equal(getChatUploadPlaceholders('chat-1').some((entry) => entry.id === placeholder.id), true);

    removeChatUploadPlaceholder(placeholder.id);
    assert.equal(getChatUploadPlaceholders('chat-1').some((entry) => entry.id === placeholder.id), false);
  });

  test('canSend is true when there is a pending attachment even without text', () => {
    const pendingAttachment = buildPendingAttachment(
      new File(['image'], 'photo.png', { type: 'image/png' }),
      'blob:image',
    );
    assert.ok(pendingAttachment);
    const pendingAttachments = [pendingAttachment];

    const result = getTurnInputSendPlan({
      text: '',
      pendingAttachments,
      hasSelectedChat: true,
      isReadOnly: false,
      isSending: false,
      isUploading: false,
    });

    assert.equal(result.canSend, true);
    assert.equal(result.sendAttachment, true);
    assert.equal(result.sendText, false);
  });

  test('canSend is false when both text and attachment are absent', () => {
    const result = getTurnInputSendPlan({
      text: '   ',
      pendingAttachments: [],
      hasSelectedChat: true,
      isReadOnly: false,
      isSending: false,
      isUploading: false,
    });

    assert.equal(result.canSend, false);
    assert.equal(result.sendAttachment, false);
    assert.equal(result.sendText, false);
  });

  test('attachment-only send plans upload the attachment message', () => {
    const firstAttachment = buildPendingAttachment(new File(['video'], 'clip.mp4', { type: 'video/mp4' }), 'blob:video');
    const secondAttachment = buildPendingAttachment(new File(['image'], 'photo.png', { type: 'image/png' }), 'blob:image');
    assert.ok(firstAttachment);
    assert.ok(secondAttachment);
    const pendingAttachments = [firstAttachment, secondAttachment];

    const result = getTurnInputSendPlan({
      text: '',
      pendingAttachments,
      hasSelectedChat: true,
      isReadOnly: false,
      isSending: false,
      isUploading: false,
    });

    assert.equal(result.sendAttachment, true);
    assert.equal(result.sendText, false);
  });

  test('text plus attachment plans send both paths', () => {
    const firstAttachment = buildPendingAttachment(new File(['image'], 'photo.png', { type: 'image/png' }), 'blob:image');
    const secondAttachment = buildPendingAttachment(new File(['video'], 'clip.mp4', { type: 'video/mp4' }), 'blob:video');
    assert.ok(firstAttachment);
    assert.ok(secondAttachment);
    const pendingAttachments = [firstAttachment, secondAttachment];

    const result = getTurnInputSendPlan({
      text: 'hello',
      pendingAttachments,
      hasSelectedChat: true,
      isReadOnly: false,
      isSending: false,
      isUploading: false,
    });

    assert.equal(result.sendAttachment, true);
    assert.equal(result.sendText, true);
  });

  test('uploading blocks follow-up sends until the current attempt finishes', () => {
    const pendingAttachment = buildPendingAttachment(
      new File(['image'], 'photo.png', { type: 'image/png' }),
      'blob:image',
    );
    assert.ok(pendingAttachment);
    const pendingAttachments = [pendingAttachment];

    const result = getTurnInputSendPlan({
      text: 'hello',
      pendingAttachments,
      hasSelectedChat: true,
      isReadOnly: false,
      isSending: false,
      isUploading: true,
    });

    assert.equal(result.canSend, false);
    assert.equal(result.sendAttachment, false);
    assert.equal(result.sendText, false);
  });

  test('composer keeps attachment preview in a scrollable content area', () => {
    assert.match(
      turnInputSource,
      /<ScrollArea className="min-h-0 flex-1" viewportClassName="pr-2">/,
    );
  });

  test('composer renders attachment previews as a wrapped thumbnail list', () => {
    assert.match(
      turnInputSource,
      /pendingAttachments\.length > 0 \? \(\s*<div className="mb-2 flex flex-wrap gap-2">/,
    );
    assert.match(
      turnInputSource,
      /className="block h-20 w-20 rounded-xl object-cover"/,
    );
  });

  test('composer renders video attachments as rounded cards with metadata instead of square thumbnails', () => {
    assert.match(
      turnInputSource,
      /className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-\[0_6px_20px_rgba\(15,23,42,0\.08\)\]"/,
    );
    assert.match(
      turnInputSource,
      /className="relative h-24 w-40 overflow-hidden bg-gray-900"/,
    );
    assert.match(
      turnInputSource,
      /formatPendingAttachmentSize\(attachment\.file\.size\)/,
    );
    assert.doesNotMatch(
      turnInputSource,
      /className="block h-20 w-20 rounded-xl bg-black object-cover"/,
    );
  });

  test('composer keeps toolbar and send button in a fixed shrink-0 footer row', () => {
    assert.match(
      turnInputSource,
      /className="mt-2 flex shrink-0 items-center justify-between"/,
    );
    assert.match(
      turnInputSource,
      /className=\{`ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-all hover:bg-\[#0052A3\] disabled:opacity-40 disabled:cursor-not-allowed \$\{/,
    );
  });

  test('message timeline raises the default composer height', () => {
    assert.match(messageTimelineSource, /const COMPOSER_MIN_HEIGHT = 132;/);
    assert.match(messageTimelineSource, /const \[composerHeight, setComposerHeight\] = useState\(176\);/);
  });

  test('message timeline renders local upload placeholders with a spinner overlay', () => {
    assert.match(
      humanConversationTranscriptSource,
      /const uploadPlaceholders = useChatUploadPlaceholders\(selectedChatId\);/,
    );
    assert.match(
      humanConversationTranscriptSource,
      /<RealmChatTimeline/,
    );
    assert.match(
      humanConversationTranscriptSource,
      /t\('ChatTimeline\.uploadingMedia', 'Uploading\.\.\.'\)/,
    );
  });
});
