import assert from 'node:assert/strict';
import test from 'node:test';
import { accountExportMarkdown, type AccountTextExport } from '../src/auth/account-export-format.js';

test('readable export retains coverage and text without interpreting user HTML', () => {
  const data = { format: 'nimi-account-text-export/v1', status: 'partial', startedAt: '2026-10-31T00:00:00Z', completedAt: '2026-10-31T00:01:00Z',
    profile: { accountId: 'self', displayName: 'Me', handle: '@me', languages: [], tags: [] }, settings: null, relationships: [],
    sections: [{ name: 'settings', status: 'unavailable', itemCount: 0, reason: 'source-read-unavailable' }],
    conversations: [{ chatId: 'chat', peerAccountId: 'peer', peerDisplayName: '<b>Peer</b>', peerHandle: '@peer', messages: [
      { messageId: '1', senderAccountId: 'peer', type: 'TEXT', text: '<script>alert(1)</script>\nHello\n![track](https://example.invalid/pixel)', createdAt: '2026-10-31', editedAt: null },
      { messageId: '2', senderAccountId: 'peer', type: 'RECALL', text: null, createdAt: '2026-10-31', editedAt: null },
    ] }], exclusions: [],
  } as unknown as AccountTextExport;
  const markdown = accountExportMarkdown(data, 'en');
  assert.match(markdown, /unavailable/);
  assert.match(markdown, /not an atomic snapshot/);
  assert.match(markdown, /Message recalled/);
  assert.match(markdown, /&lt;script&gt;/);
  assert.doesNotMatch(markdown, /<script>|<b>/);
  assert.match(markdown, /> Hello/);
  assert.ok(!markdown.includes('![track]('));
});
