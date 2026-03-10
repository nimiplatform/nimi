import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import type { PostDto } from '@nimiplatform/sdk/realm';

import { prepareHomeFeedItems } from '../src/shell/renderer/features/home/utils.js';

function makePost(input: {
  id: string;
  createdAt: string;
  authorId: string;
  isAgent?: boolean;
}): PostDto {
  return {
    id: input.id,
    authorId: input.authorId,
    author: {
      id: input.authorId,
      handle: input.isAgent ? `~${input.authorId}` : `@${input.authorId}`,
      displayName: input.isAgent ? 'Agent Author' : 'Human Author',
      isAgent: input.isAgent === true,
      createdAt: '2026-03-10T00:00:00.000Z',
    },
    media: [],
    visibility: 'PUBLIC',
    createdAt: input.createdAt,
    worldId: 'world-1',
  };
}

describe('prepareHomeFeedItems', () => {
  test('preserves all service-returned items, including agent posts', () => {
    const posts = [
      makePost({
        id: 'human-post',
        authorId: 'human-1',
        createdAt: '2026-03-10T09:00:00.000Z',
      }),
      makePost({
        id: 'agent-post',
        authorId: 'agent-1',
        createdAt: '2026-03-10T10:00:00.000Z',
        isAgent: true,
      }),
    ];

    const result = prepareHomeFeedItems(posts);

    assert.notStrictEqual(result, posts);
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((post) => post.id),
      ['agent-post', 'human-post'],
    );
  });
});
