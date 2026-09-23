import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n';
import {
  HomeActivityColumnView,
  pickAgentPosts,
  summarizeActivityPost,
  type HomeActivityColumnViewProps,
  type HomeActivityPost,
} from '../src/shell/renderer/features/home/home-activity-column.js';

(globalThis as { React?: typeof React }).React = React;

const noop = () => undefined;

function post(overrides: Partial<HomeActivityPost> = {}): HomeActivityPost {
  return {
    id: 'p1',
    authorName: 'Lumi',
    authorAvatarUrl: null,
    caption: 'Went to the gallery this afternoon.',
    createdAtLabel: '25m ago',
    thumbnails: [],
    hiddenMediaCount: 0,
    ...overrides,
  };
}

function render(overrides: Partial<HomeActivityColumnViewProps> = {}): string {
  const props: HomeActivityColumnViewProps = {
    attention: [],
    posts: { status: 'ready', items: [post()] },
    onViewActivity: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<HomeActivityColumnView {...props} />);
}

test('column shows agent posts with author, verb, time, and the view-all entry', async () => {
  await initI18n(); await changeLocale('en');
  const html = render();
  assert.match(html, /data-testid="home-activity-column"/);
  assert.match(html, /data-testid="home-activity-posts" data-state="ready"/);
  assert.match(html, /data-testid="home-activity-post:p1"/);
  assert.match(html, /Lumi<\/span> <span[^>]*>posted</);
  assert.match(html, /25m ago/);
  assert.match(html, /Went to the gallery this afternoon\./);
  assert.match(html, /data-testid="home-activity-all"/);
  assert.doesNotMatch(html, /data-testid="home-attention"/);
  assert.doesNotMatch(html, /runtimeConfig\.overview\./);
});

test('attention section renders only when there is something to handle', async () => {
  await initI18n(); await changeLocale('zh');
  const html = render({
    attention: [{
      key: 'task:1',
      icon: <span>!</span>,
      title: '语音合成 · 设置需要处理',
      detail: '模型文件校验未通过',
      progress: null,
      action: '查看',
      onAction: noop,
      tone: 'warning',
    }],
  });
  assert.match(html, /data-testid="home-attention"/);
  assert.match(html, /需要处理/);
  assert.match(html, /data-tone="warning"/);
  assert.match(html, /语音合成 · 设置需要处理/);
  assert.match(html, /模型文件校验未通过/);
});

test('thumbnails cap at three tiles and fold the rest into a +N tile', async () => {
  await initI18n(); await changeLocale('en');
  const html = render({
    posts: {
      status: 'ready',
      items: [post({
        caption: '',
        thumbnails: [
          { url: 'https://cdn/a.jpg', kind: 'IMAGE' },
          { url: 'https://cdn/b.mp4', kind: 'VIDEO' },
        ],
        hiddenMediaCount: 2,
      })],
    },
  });
  assert.equal((html.match(/<img /g) ?? []).length, 2);
  assert.match(html, />\+2</);
  assert.doesNotMatch(html, /\(no text\)/);
});

test('post states degrade explicitly without hiding the entry', async () => {
  await initI18n(); await changeLocale('zh');
  const empty = render({ posts: { status: 'ready', items: [] } });
  assert.match(empty, /还没有动态/);
  assert.match(empty, /查看全部动态/);
  const failed = render({ posts: { status: 'unavailable', items: [] } });
  assert.match(failed, /暂时无法读取动态/);
  const loading = render({ posts: { status: 'loading', items: [] } });
  assert.match(loading, /data-state="loading"/);
});

test('pickAgentPosts drops human posts, keeps newest first, and respects the limit', () => {
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

test('summarizeActivityPost resolves author, media thumbnails, and the overflow count', () => {
  const attachment = (displayKind: string, url: string, thumbnail?: string) => ({
    targetType: 'RESOURCE', targetId: url, displayKind, url, thumbnail,
  });
  const summary = summarizeActivityPost({
    id: 'p9',
    createdAt: '2026-09-21T08:00:00Z',
    authorKind: 'personaCharacter',
    caption: '  hello  ',
    sourceAuthor: { displayName: 'Lumi', avatarUrl: 'https://cdn/lumi.png' },
    attachments: [
      attachment('IMAGE', '/media/a.jpg'),
      attachment('VIDEO', '/media/b.mp4', '/media/b.jpg'),
      attachment('VIDEO', '/media/c.mp4'),
      attachment('IMAGE', '/media/d.jpg'),
      attachment('IMAGE', '/media/e.jpg'),
    ],
  } as never, {
    realmBaseUrl: 'https://realm.test',
    i18n: { formatRelativeTime: () => '1h ago' },
    unknownAuthor: 'Your agent',
  });
  assert.equal(summary.authorName, 'Lumi');
  assert.equal(summary.authorAvatarUrl, 'https://cdn/lumi.png');
  assert.equal(summary.caption, 'hello');
  assert.equal(summary.createdAtLabel, '1h ago');
  // A video without a thumbnail is not renderable as a tile; 4 tiles remain → 2 shown + 2 folded.
  assert.deepEqual(summary.thumbnails.map((item) => item.kind), ['IMAGE', 'VIDEO']);
  assert.equal(summary.hiddenMediaCount, 2);

  const fallback = summarizeActivityPost({
    id: 'p10', createdAt: '2026-09-21T08:00:00Z', authorKind: 'worldCharacter', attachments: [],
  } as never, { realmBaseUrl: '', i18n: { formatRelativeTime: () => 'now' }, unknownAuthor: 'Your agent' });
  assert.equal(fallback.authorName, 'Your agent');
  assert.equal(fallback.caption, '');
  assert.equal(fallback.hiddenMediaCount, 0);
});
