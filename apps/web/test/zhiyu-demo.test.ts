import { exploreCharacters } from '../src/landing/content/explore-demo-data.js';
import { createPreviewTranslate } from '../src/landing/i18n/preview-messages.js';
import { appPreviewMessagesZh } from '../src/landing/content/app-preview-messages.zh.js';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderAppPreview as renderToStaticMarkup } from './helpers/render-app-preview.js';
import {
  createDemoZhiyuAgentCenterSession,
  createDemoZhiyuAgentClient,
  demoZhiyuPartnerHandle,
} from '../src/landing/components/demo-zhiyu-agent-center.js';
import { DemoZhiyuPreview } from '../src/landing/components/demo-zhiyu-preview.js';
import { HeroDemoSessionProvider } from '../src/landing/components/hero-demo-session.js';
import { createZhiyuPreviewContent } from '../src/landing/content/landing-content.zhiyu.js';
import { loadLandingContent, type HeroDemoZhiyuPartner } from '../src/landing/content/landing-content.js';

const zhiyuPreviewContent = createZhiyuPreviewContent(createPreviewTranslate(appPreviewMessagesZh), 'zh');

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

test('Zhiyu localizes sample copy while preserving companion identities in both locales', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    const preview = content.hero.demo.appPreview.zhiyu;
    const appName = locale === 'en' ? 'Zhiyu' : '织羽';
    assert.equal(preview.appName, appName);
    assert.equal(content.hero.demo.apps.items.find((entry) => entry.id === 'nimi.zhiyu')?.name, appName);
    assert.deepEqual(preview.partners.map((entry) => entry.id), zhiyuPreviewContent.partners.map((entry) => entry.id));
    assert.equal(preview.copy.sendLabel, locale === 'en' ? 'Send' : '发送');
  }
  assert.equal(zhiyuPreviewContent.partners.length, 5);
  assert.ok(zhiyuPreviewContent.partners.every((entry) => entry.replies.length >= 1));
  const ids = new Set(zhiyuPreviewContent.partners.map((entry) => entry.id));
  assert.equal(ids.size, zhiyuPreviewContent.partners.length);
});

test('Home and Zhiyu share published character identities, introductions and opening exchanges', async () => {
  for (const locale of ['zh', 'en'] as const) {
    const { hero: { demo } } = await loadLandingContent(locale);
    assert.deepEqual(demo.chat.agents.map((agent) => agent.id), demo.appPreview.zhiyu.partners.map((partner) => partner.id));
    for (const partner of demo.appPreview.zhiyu.partners) {
      const character = exploreCharacters.find((entry) => entry.id === partner.id)!;
      const home = demo.chat.agents.find((entry) => entry.id === partner.id)!;
      assert.ok(character, `${partner.name} belongs to the published catalog`);
      assert.equal(partner.name, character.name);
      assert.equal(partner.avatarUrl, character.image);
      assert.equal(partner.introduction?.worldName, character.worldName);
      assert.equal(home.bio, character.bio);
      assert.equal(partner.bio, home.bio);
      assert.deepEqual(partner.introduction, home.introduction);
      assert.deepEqual(partner.messages, home.messages);
      assert.deepEqual(partner.replies, home.replies);
      for (const memory of partner.memories) {
        assert.doesNotMatch(memory.content, /演示记忆|demo memory/);
        assert.match(memory.sourceExplanation, /预置示例记录|Preloaded sample record/);
      }
      assert.ok(partner.introduction?.voicePreviewUrl);
      if (partner.messages.length) {
        assert.equal(partner.messages.length, 2);
        assert.equal(partner.messages[0]?.role, 'user');
        assert.equal(partner.messages[1]?.role, 'assistant');
        assert.equal(partner.messages[1]?.text, partner.introduction?.greeting);
      }
    }
  }
});

test('every referenced demo asset exists under public/', () => {
  const urls = new Set<string>();
  for (const entry of zhiyuPreviewContent.partners) {
    if (entry.avatarUrl) urls.add(entry.avatarUrl);
    if (entry.introduction?.referenceImageUrl) urls.add(entry.introduction.referenceImageUrl);
    if (entry.introduction?.voicePreviewUrl) urls.add(entry.introduction.voicePreviewUrl);
    for (const message of entry.messages) {
      if (message.kind === 'voice') {
        assert.match(message.voiceUrl, /\.mp3$/u);
        assert.ok(message.voiceTranscript.trim().length > 0);
        urls.add(message.voiceUrl);
      }
      if (message.kind === 'image') urls.add(message.mediaUrl);
    }
  }
  assert.ok(urls.size >= 10);
  for (const url of urls) {
    assert.ok(url.startsWith('/demo/'), url);
    assert.ok(existsSync(join(PUBLIC_DIR, url)), `${url} exists`);
  }
});

test('the preview starts with the current selection entry, authentic branding and a disabled composer', async () => {
  const { demo } = (await loadLandingContent('zh')).hero;
  const html = renderToStaticMarkup(createElement(HeroDemoSessionProvider, { demo, children: createElement(DemoZhiyuPreview, { content: zhiyuPreviewContent }) }));
  assert.ok(html.includes('data-demo-zhiyu-root="true"'));
  assert.ok(html.includes('/demo/zhiyu/logo.png'));
  assert.ok(html.includes('选择一位本地伙伴，开始对话'));
  assert.ok(html.includes('先选择本地伙伴'));
  assert.ok(html.includes('data-chat-composer-layout="stacked"'));
  for (const entry of zhiyuPreviewContent.partners) {
    assert.ok(html.includes(`src="${entry.avatarUrl}"`));
    assert.ok(html.includes(`aria-label="${zhiyuPreviewContent.copy.selectPartnerAriaPrefix}${entry.name}"`));
  }
  assert.ok(!html.includes('chat-voice-bar'));
});

test('partner handles are nominal agent references distinct per partner', () => {
  const handles = zhiyuPreviewContent.partners.map((entry) => demoZhiyuPartnerHandle(entry.id));
  assert.equal(new Set(handles).size, handles.length);
  for (const handle of handles) {
    assert.match(handle, /^agent_ref_[a-z0-9_]{43}$/u);
  }
});

test('the kit Agent Center session loads a ready snapshot from the mock client', async () => {
  const { session: current, client } = session('demo:meridian-archipelago:character-0');
  await current.refresh();
  const snapshot = current.getSnapshot();
  assert.equal(snapshot.phase, 'ready');
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.state.runtimeStatus, 'ready');
  // Text intent is configured locally, so the chrome reports the model as set.
  assert.equal(snapshot.state.baseTextConfigured, true);
  assert.equal(snapshot.state.autonomy.mode, 'off');
  assert.equal(snapshot.state.autonomy.enabled, false);
  assert.equal(snapshot.state.cognition.memoryState, 'empty');
  assert.equal(snapshot.state.cognition.memory?.items.length, 0);
  assert.equal(snapshot.state.appearance.backendKind, null);
  assert.equal(snapshot.state.appearance.status, 'not_configured');
  assert.equal(snapshot.state.sourceContext.status, 'ready');
  // The Appearance section can select a
  // Resource Pack because the demo supplies a target controller.
  assert.equal(snapshot.availability.updateAutonomy.state, 'available');
  assert.equal(snapshot.availability.replaceAppearance.state, 'available');
  assert.equal(typeof current.appearance.selectResourcePack, 'function');
  assert.equal(typeof current.appearance.replaceAvatar, 'function');
  assert.equal(snapshot.state.conversationContext, null);
  assert.equal(snapshot.availability.updateConversationContext.state, 'unavailable');
  await assert.rejects(client.client.conversationContext.update({
    agentHandle: client.handle, conversationAnchorId: 'demo-no-runtime-conversation',
    expectedContextRevision: '1', firstTurnSequence: '0', omitSupplementalContext: false,
  }), /unavailable in this preview/u);
  current.dispose();
});

test('partners without source or memory project the blocked and unconfigured states', async () => {
  // Exercise missing source and unconfigured states independently of public excerpts.
  const base = partner('demo:emberware-court:character-0');
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
  const { session: current } = session({
    ...partner('demo:meridian-archipelago:character-1'),
    memories: [
      { id: 'test-memory-1', content: '测试记忆一', epistemicStatus: 'explicit', daysAgo: 1, sourceExplanation: 'Test fixture' },
      { id: 'test-memory-2', content: '测试记忆二', epistemicStatus: 'explicit', daysAgo: 1, sourceExplanation: 'Test fixture' },
    ],
  });
  await current.refresh();
  const before = current.getSnapshot();
  assert.equal(before.state.autonomy.mode, 'off');

  await current.updateAutonomy({
    expectedRevision: before.state.autonomy.revision ?? '',
    enabled: true,
    mode: 'high',
    dailyTokenBudget: 12000,
    maxBackgroundOutputTokens: 900,
    freeContactEnabled: true,
    maxFreeContactsPerDay: 2,
    quietHours: { timezone: 'Asia/Shanghai', startMinute: 1320, endMinute: 420 },
  });
  assert.equal(current.getSnapshot().state.autonomy.mode, 'high');
  assert.equal(current.getSnapshot().state.autonomy.dailyTokenBudget, 12000);
  assert.equal(current.getSnapshot().state.autonomy.maxBackgroundOutputTokens, 900);
  assert.equal(current.getSnapshot().state.autonomy.freeContactEnabled, true);
  assert.equal(current.getSnapshot().state.autonomy.maxFreeContactsPerDay, 2);
  assert.deepEqual(current.getSnapshot().state.autonomy.quietHours, { timezone: 'Asia/Shanghai', startMinute: 1320, endMinute: 420 });

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
  // Published portraits do not imply a configured Live2D/VRM avatar.
  const { session: current, resourcePackController } = session('demo:emberware-court:character-0');
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

test('Zhiyu navigation preserves the selected partner and panel through Back and Forward', async () => {
  const { reduceZhiyuDemoNavigation } = await import('../src/landing/content/zhiyu-demo-navigation.js');
  let state = { entries: [{ partnerId: null }] as readonly import('../src/landing/content/zhiyu-demo-navigation.js').ZhiyuDemoDestination[], index: 0 };
  state = reduceZhiyuDemoNavigation(state, { type: 'push', destination: { partnerId: 'demo:meridian-archipelago:character-0' } });
  state = reduceZhiyuDemoNavigation(state, { type: 'push', destination: { partnerId: 'demo:cbdb-ming-lettered-networks-world:character-1', panel: 'cognition' } });
  state = reduceZhiyuDemoNavigation(state, { type: 'go', delta: -1 });
  assert.deepEqual(state.entries[state.index], { partnerId: 'demo:meridian-archipelago:character-0' });
  state = reduceZhiyuDemoNavigation(state, { type: 'go', delta: 1 });
  assert.deepEqual(state.entries[state.index], { partnerId: 'demo:cbdb-ming-lettered-networks-world:character-1', panel: 'cognition' });
  const unchanged = reduceZhiyuDemoNavigation(state, { type: 'push', destination: { partnerId: 'demo:cbdb-ming-lettered-networks-world:character-1', panel: 'cognition' } });
  assert.equal(unchanged, state);
});
