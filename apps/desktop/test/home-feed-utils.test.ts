import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import type { RealmModel } from '@nimiplatform/sdk/realm/generated';

import {
  prepareHomeFeedItems,
  resolveRenderableMediaAttachment,
  resolveMediaThumbnailUrl,
  resolveMediaUrl,
} from '../src/shell/renderer/features/home/utils.js';

type PostDto = RealmModel<'PostDto'>;

function makePost(input: {
  id: string;
  createdAt: string;
  authorId: string;
}): PostDto {
  return {
    id: input.id,
    authorId: input.authorId,
    author: {
      id: input.authorId,
      handle: `@${input.authorId}`,
      displayName: 'Human Author',
      createdAt: '2026-03-10T00:00:00.000Z',
    },
    authorKind: 'human',
    attachments: [],
    visibility: 'PUBLIC',
    createdAt: input.createdAt,
    worldId: 'world-1',
  };
}

describe('prepareHomeFeedItems', () => {
  test('preserves all service-returned account-authored posts', () => {
    const posts = [
      makePost({
        id: 'human-post',
        authorId: 'human-1',
        createdAt: '2026-03-10T09:00:00.000Z',
      }),
      makePost({
        id: 'second-post',
        authorId: 'user-2',
        createdAt: '2026-03-10T10:00:00.000Z',
      }),
    ] as const satisfies readonly PostDto[];

    const result = prepareHomeFeedItems(posts);

    assert.notStrictEqual(result, posts);
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((post) => post.id),
      ['second-post', 'human-post'],
    );
  });
});

describe('media url resolution', () => {
  test('expands relative media urls against the configured realm base url', () => {
    const media = {
      targetType: 'RESOURCE',
      targetId: 'resource-image-1',
      displayKind: 'IMAGE',
      url: '/api/resources/images/example',
    } as PostDto['attachments'][number];

    assert.equal(
      resolveMediaUrl(media, 'https://realm.example'),
      'https://realm.example/api/resources/images/example',
    );
  });

  test('expands relative media thumbnails against the configured realm base url', () => {
    const media = {
      targetType: 'RESOURCE',
      targetId: 'resource-video-1',
      displayKind: 'VIDEO',
      url: 'https://cdn.example/video.m3u8',
      thumbnail: '/api/resources/video-thumbs/example',
    } as PostDto['attachments'][number];

    assert.equal(
      resolveMediaThumbnailUrl(media, 'https://realm.example/'),
      'https://realm.example/api/resources/video-thumbs/example',
    );
  });

  test('does not fall back to legacy uid-only media references', () => {
    const media = {
      targetType: 'RESOURCE',
      targetId: 'resource-video-legacy',
      displayKind: 'VIDEO',
      uid: 'legacy-video-uid',
    } as PostDto['attachments'][number];

    assert.equal(resolveMediaUrl(media, 'https://realm.example'), undefined);
  });

  test('resolves nested attachment previews for card-backed attachments', () => {
    const media = {
      targetType: 'ASSET',
      targetId: 'asset-1',
      displayKind: 'CARD',
      title: 'Original Song',
      preview: {
        targetType: 'RESOURCE',
        targetId: 'resource-preview-1',
        displayKind: 'IMAGE',
        url: '/api/resources/images/preview',
      },
    } as PostDto['attachments'][number];

    assert.deepEqual(resolveRenderableMediaAttachment(media), media.preview);
    assert.equal(
      resolveMediaUrl(media, 'https://realm.example'),
      'https://realm.example/api/resources/images/preview',
    );
  });
});
