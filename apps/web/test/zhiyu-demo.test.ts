import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createDemoZhiyuAgentCenterSession,
  createDemoZhiyuAgentClient,
  demoZhiyuPartnerHandle,
} from '../src/landing/components/demo-zhiyu-agent-center.js';
import { DemoZhiyuPreview } from '../src/landing/components/demo-zhiyu-preview.js';
import { zhiyuPreviewContent } from '../src/landing/content/landing-content.zhiyu.js';
import { loadLandingContent, type HeroDemoZhiyuPartner } from '../src/landing/content/landing-content.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

function partner(id: string) {
  const found = zhiyuPreviewContent.partners.find((candidate) => candidate.id === id);
  assert.ok(found, `partner ${id} is seeded`);
  return found;
}

function session(seed: string | HeroDemoZhiyuPartner) {
  const target = typeof seed === 'string' ? partner(seed) : seed;
  const client = createDemoZhiyuAgentClient(target, zhiyuPreviewContent, { pickerDelayMs: 0 });
  return { client, ...createDemoZhiyuAgentCenterSession(client) };
}

test('both locales share the zh Zhiyu preview content', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    assert.equal(content.hero.demo.appPreview.zhiyu, zhiyuPreviewContent);
  }
  assert.equal(zhiyuPreviewContent.partners.length, 4);
  assert.ok(zhiyuPreviewContent.partners.every((entry) => entry.replies.length >= 1));
  const ids = new Set(zhiyuPreviewContent.partners.map((entry) => entry.id));
  assert.equal(ids.size, zhiyuPreviewContent.partners.length);
});

test('every partner has a story in progress with a voice turn, an image turn, and an avatar', () => {
  for (const entry of zhiyuPreviewContent.partners) {
    // No empty transcripts: each companion is met mid-story.
    assert.ok(entry.messages.length >= 4, `${entry.name} has a transcript`);
    assert.ok(entry.messages.some((message) => message.kind === 'voice'), `${entry.name} has a voice turn`);
    assert.ok(entry.messages.some((message) => message.kind === 'image'), `${entry.name} has an image turn`);
    assert.ok(entry.memories.length >= 2, `${entry.name} remembers the story`);
    assert.ok(entry.manager.sourceReady, `${entry.name} has a materialized source`);
    assert.ok(entry.avatarUrl?.startsWith('/demo/zhiyu/'), `${entry.name} has a demo avatar`);
    const messageIds = new Set(entry.messages.map((message) => message.id));
    assert.equal(messageIds.size, entry.messages.length);
  }
});

test('every referenced demo asset exists under public/', () => {
  const urls = new Set<string>();
  for (const entry of zhiyuPreviewContent.partners) {
    if (entry.avatarUrl) urls.add(entry.avatarUrl);
    for (const message of entry.messages) {
      if (message.kind === 'voice') {
        assert.match(message.voiceUrl, /\.mp3$/u);
        assert.ok(message.voiceTranscript.trim().length > 0);
        urls.add(message.voiceUrl);
      }
      if (message.kind === 'image') urls.add(message.mediaUrl);
    }
  }
  assert.ok(urls.size >= 12);
  for (const url of urls) {
    assert.ok(url.startsWith('/demo/zhiyu/'), url);
    assert.ok(existsSync(join(PUBLIC_DIR, url)), `${url} exists`);
  }
});

test('the preview renders the first partner with avatars, its image card, and a playable voice bubble', () => {
  const html = renderToStaticMarkup(createElement(DemoZhiyuPreview, { content: zhiyuPreviewContent }));
  const first = zhiyuPreviewContent.partners[0]!;
  assert.ok(html.includes('data-demo-zhiyu-root="true"'));
  for (const entry of zhiyuPreviewContent.partners) {
    assert.ok(html.includes(`src="${entry.avatarUrl}"`), `${entry.name} avatar in the rail`);
  }
  const image = first.messages.find((message) => message.kind === 'image');
  assert.ok(image && image.kind === 'image');
  assert.ok(html.includes(`src="${image.mediaUrl}"`));
  if (image.caption) assert.ok(html.includes(image.caption));
  assert.ok(html.includes('chat-voice-bar'));
  // The zh shell copy replaces the kit's English bubble defaults.
  assert.ok(html.includes(zhiyuPreviewContent.copy.chat.bubbleVoiceMessageLabel ?? '__none__'));
  assert.ok(!html.includes('Voice message'));
  // Other partners' transcripts stay unmounted until selected.
  const second = zhiyuPreviewContent.partners[1]!;
  const secondImage = second.messages.find((message) => message.kind === 'image');
  assert.ok(secondImage && secondImage.kind === 'image');
  assert.ok(!html.includes(`src="${secondImage.mediaUrl}"`));
});

test('partner handles are nominal agent references distinct per partner', () => {
  const handles = zhiyuPreviewContent.partners.map((entry) => demoZhiyuPartnerHandle(entry.id));
  assert.equal(new Set(handles).size, handles.length);
  for (const handle of handles) {
    assert.match(handle, /^agent_ref_[a-z0-9_]{43}$/u);
  }
});

test('the kit Agent Center session loads a ready snapshot from the mock client', async () => {
  const { session: current } = session('p-qingzhao');
  await current.refresh();
  const snapshot = current.getSnapshot();
  assert.equal(snapshot.phase, 'ready');
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.state.runtimeStatus, 'ready');
  // Text intent is configured locally, so the chrome reports the model as set.
  assert.equal(snapshot.state.baseTextConfigured, true);
  assert.equal(snapshot.state.autonomy.mode, 'medium');
  assert.equal(snapshot.state.autonomy.enabled, true);
  assert.equal(snapshot.state.cognition.memoryState, 'ready');
  assert.equal(snapshot.state.cognition.memory?.items.length, 3);
  assert.equal(snapshot.state.appearance.backendKind, 'live2d');
  assert.equal(snapshot.state.appearance.status, 'ready');
  assert.equal(snapshot.state.sourceContext.status, 'ready');
  // Every product action is available; the Appearance section can select a
  // Resource Pack because the demo supplies a target controller.
  assert.equal(snapshot.availability.updateAutonomy.state, 'available');
  assert.equal(snapshot.availability.replaceAppearance.state, 'available');
  assert.equal(typeof current.appearance.selectResourcePack, 'function');
  assert.equal(typeof current.appearance.replaceAvatar, 'function');
  current.dispose();
});

test('partners without source or memory project the blocked and unconfigured states', async () => {
  // The seeded partners are all mid-story; these states are reached by
  // constructing partners the way a freshly created companion would look.
  const base = partner('p-chao');
  const blocked = session({
    ...base,
    id: 'p-test-blocked',
    memories: [],
    manager: { ...base.manager, sourceReady: false, transcriptTurnCount: 0, memoryItemCount: 0 },
  });
  await blocked.session.refresh();
  assert.equal(blocked.session.getSnapshot().state.sourceContext.status, 'blocked');
  assert.equal(blocked.session.getSnapshot().state.cognition.memoryState, 'empty');
  assert.equal(blocked.session.getSnapshot().state.appearance.status, 'not_configured');
  blocked.session.dispose();

  const fresh = session({
    ...base,
    id: 'p-test-fresh',
    messages: [],
    memories: [],
    aiConfig: [],
    manager: { ...base.manager, lifecycleStatus: 'initializing', transcriptTurnCount: 0, memoryItemCount: 0 },
  });
  await fresh.session.refresh();
  assert.equal(fresh.session.getSnapshot().state.cognition.memoryState, 'unconfigured');
  assert.equal(fresh.session.getSnapshot().state.baseTextConfigured, false);
  assert.equal(fresh.session.getSnapshot().state.sourceContext.status, 'unknown');
  fresh.session.dispose();
});

test('mutations write back to the mock client and re-project', async () => {
  const { session: current } = session('p-xiake');
  await current.refresh();
  const before = current.getSnapshot();
  assert.equal(before.state.autonomy.mode, 'low');

  await current.updateAutonomy({
    expectedRevision: before.state.autonomy.revision ?? '',
    enabled: true,
    mode: 'high',
    dailyTokenBudget: 12000,
    maxTokensPerHook: 900,
  });
  assert.equal(current.getSnapshot().state.autonomy.mode, 'high');
  assert.equal(current.getSnapshot().state.autonomy.dailyTokenBudget, 12000);

  const memoryId = before.state.cognition.memory?.items[0]?.memoryId;
  assert.ok(memoryId);
  await current.correctMemory({ memoryId, correctedContent: '你计划周六走黄山后山。' });
  assert.equal(current.getSnapshot().state.cognition.memory?.items[0]?.content, '你计划周六走黄山后山。');
  await current.forgetMemory({ memoryIds: [memoryId], confirmed: true });
  assert.equal(current.getSnapshot().state.cognition.memory?.items.length, 1);

  await current.overwriteSharedAIConfig({
    expectedRevision: before.state.sharedAIConfig?.revision ?? '',
    capabilities: [{
      capabilityContract: 'text.generate',
      requiredFeatures: [],
      route: { oneofKind: 'local', local: {} },
    }],
  });
  const text = current.getSnapshot().state.capabilities.find((capability) => capability.capability === 'text.generate');
  assert.equal(text?.intent?.route, 'local');
  current.dispose();
});

test('appearance replacement and the Resource Pack flow run through the mock host', async () => {
  // 潮 has no avatar backend, so it starts from the not-configured state.
  const { session: current, resourcePackController } = session('p-chao');
  await current.refresh();
  assert.equal(current.getSnapshot().state.appearance.status, 'not_configured');

  await current.appearance.replaceAvatar?.('live2d');
  const appearance = current.getSnapshot().state.appearance;
  assert.equal(appearance.status, 'ready');
  assert.equal(appearance.backendKind, 'live2d');
  // No renderer behind the preview: the committed view is reported unavailable, never faked.
  assert.equal(appearance.renderState, 'unavailable');

  await current.appearance.selectResourcePack?.();
  assert.equal(resourcePackController.getSnapshot().phase, 'preview');
  assert.equal(resourcePackController.getSnapshot().effectiveSource, 'preview');
  assert.equal(resourcePackController.getSnapshot().reviewFileName, zhiyuPreviewContent.demo.resourcePackFileName);

  await current.appearance.applyResourcePack?.();
  assert.equal(resourcePackController.getSnapshot().phase, 'selected');
  assert.equal(resourcePackController.getSnapshot().effectiveSource, 'selected');
  assert.ok(current.getSnapshot().state.appearance.resourcePackSelection?.assetRef);

  await current.appearance.clearResourcePack();
  assert.equal(resourcePackController.getSnapshot().phase, 'default');
  assert.equal(current.getSnapshot().state.appearance.resourcePackSelection, null);
  current.dispose();
});
