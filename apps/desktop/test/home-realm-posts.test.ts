import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickAgentPosts, summarizeRealmPost } from '../src/shell/renderer/features/home/home-realm-posts.js';

test('pickAgentPosts drops human posts, keeps newest first, and respects an optional limit', () => {
  const make = (id: string, createdAt: string, authorKind: string) => ({
    id, createdAt, authorKind, attachments: [], author: {}, authorId: 'u1', visibility: 'PUBLIC',
  });
  const posts = [
    make('human', '2026-09-21T10:00:00Z', 'human'),
    make('old', '2026-09-19T10:00:00Z', 'personaCharacter'),
    make('mid', '2026-09-20T09:00:00Z', 'worldCharacter'),
    make('new', '2026-09-21T08:00:00Z', 'personaCharacter'),
  ];
  assert.deepEqual(pickAgentPosts(posts as never).map((item) => item.id), ['new', 'mid', 'old']);
  assert.deepEqual(pickAgentPosts(posts as never, 2).map((item) => item.id), ['new', 'mid']);
});

test('summarizeRealmPost keeps the raw time, Realm author identity and renderable media', () => {
  const attachment = (displayKind: string, url: string, thumbnail?: string) => ({
    targetType: 'RESOURCE', targetId: url, displayKind, url, thumbnail,
  });
  const summary = summarizeRealmPost({
    id: 'p9',
    createdAt: '2026-09-21T08:00:00Z',
    authorKind: 'personaCharacter',
    caption: '  hello  ',
    sourceAuthor: { id: 'persona_lumi', displayName: 'Lumi', avatarUrl: 'https://cdn/lumi.png' },
    attachments: [
      attachment('IMAGE', '/media/a.jpg'),
      attachment('VIDEO', '/media/b.mp4', '/media/b.jpg'),
      attachment('VIDEO', '/media/c.mp4'),
    ],
  } as never, { realmBaseUrl: 'https://realm.test', unknownAuthor: 'Your agent' });
  assert.equal(summary.createdAt, '2026-09-21T08:00:00Z');
  assert.equal(summary.authorKind, 'personaCharacter');
  assert.equal(summary.authorRef, 'persona_lumi');
  assert.equal(summary.authorName, 'Lumi');
  assert.equal(summary.authorAvatarUrl, 'https://cdn/lumi.png');
  assert.equal(summary.caption, 'hello');
  // A video without a thumbnail is not renderable as a tile.
  assert.deepEqual(summary.media.map((item) => item.kind), ['IMAGE', 'VIDEO']);

  const anonymous = summarizeRealmPost({
    id: 'p10', createdAt: '2026-09-21T08:00:00Z', authorKind: 'worldCharacter', attachments: [],
    sourceAuthor: null,
  } as never, { realmBaseUrl: '', unknownAuthor: 'Your agent' });
  assert.equal(anonymous.authorRef, null, 'no trusted author identity means no author grouping');
  assert.equal(anonymous.authorName, 'Your agent');
  assert.equal(anonymous.caption, '');
  assert.equal(anonymous.media.length, 0);
});
