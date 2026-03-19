import assert from 'node:assert/strict';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import test, { describe } from 'node:test';

type PostDto = RealmModel<'PostDto'>;

import {
  prepareHomeFeedItems,
  resolveMediaThumbnailUrl,
  resolveMediaUrl,
} from '../src/shell/renderer/features/home/utils.js';

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
      handle: input.isAgent ? input.authorId : `@${input.authorId}`,
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

describe('media url resolution', () => {
  test('expands relative media urls against the configured realm base url', () => {
    const media = {
      type: 'IMAGE',
      url: '/api/media/images/example',
    } as PostDto['media'][number];

    assert.equal(
      resolveMediaUrl(media, 'https://realm.example'),
      'https://realm.example/api/media/images/example',
    );
  });

  test('expands relative media thumbnails against the configured realm base url', () => {
    const media = {
      type: 'VIDEO',
      url: 'https://cdn.example/video.m3u8',
      thumbnail: '/api/media/video-thumbs/example',
    } as PostDto['media'][number];

    assert.equal(
      resolveMediaThumbnailUrl(media, 'https://realm.example/'),
      'https://realm.example/api/media/video-thumbs/example',
    );
  });

  test('does not fall back to legacy uid-only media references', () => {
    const media = {
      type: 'VIDEO',
      uid: 'legacy-video-uid',
    } as PostDto['media'][number];

    assert.equal(resolveMediaUrl(media, 'https://realm.example'), undefined);
  });
});
