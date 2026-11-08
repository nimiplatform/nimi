import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getStoryCopy } from '../src/landing/content/story-copy.js';
import { galleryDragSelection, wrapGalleryIndex, STORY_APPS } from '../src/landing/content/story-model.js';
import { loadLandingContent } from '../src/landing/content/landing-content.js';
import { StoryPage } from '../src/landing/components/story/story-page.js';
import { HeroDemoSessionProvider } from '../src/landing/components/hero-demo-session.js';
import { resolveLandingLinks } from '../src/landing/config/landing-links.js';
import { createDemoZhiyuAgentClient, createDemoZhiyuAgentCenterSession } from '../src/landing/components/demo-zhiyu-agent-center.js';
import { wrapShowcaseIndex } from '../src/landing/content/app-showcase.js';
import { DEMO_PREVIEW_APP_IDS } from '../src/landing/components/demo-app-preview.js';

test('the approved bilingual narrative has complete key and interpolation parity', () => {
  const zh = getStoryCopy('zh'), en = getStoryCopy('en');
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
    assert.ok(zh[key].trim() && en[key].trim(), key);
    const params = (text: string) => [...text.matchAll(/\{([a-zA-Z]\w*)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(params(zh[key]), params(en[key]), key);
  }
  assert.match(zh['security.checkDetail'], /未加密/);
  assert.match(en['security.checkDetail'], /unencrypted/);
  assert.match(zh['security.note'], /开发预览/);
  assert.match(en['security.note'], /developer preview/i);
});

test('gallery selection wraps in either direction and drag direction follows the hand', () => {
  assert.equal(wrapGalleryIndex(-1, 8), 7);
  assert.equal(wrapGalleryIndex(8, 8), 0);
  assert.equal(galleryDragSelection(4, -320, 1200, 8), 5);
  assert.equal(galleryDragSelection(4, 320, 1200, 8), 3);
  assert.equal(galleryDragSelection(0, 100, 390, 8), 7);
  assert.equal(galleryDragSelection(3, 4, 1200, 8), 3);
});

test('the hero contains the full Home entry and leaves the download action to navigation', async () => {
  for (const locale of ['zh', 'en'] as const) {
    const content = await loadLandingContent(locale);
    const html = renderToStaticMarkup(createElement(HeroDemoSessionProvider, { demo: content.hero.demo,
      children: createElement(StoryPage, { content, locale, links: resolveLandingLinks({}), onLocale() {} }),
    }));
    for (const id of ['home-demo', 'apps', 'worlds', 'models', 'app-showcase', 'integrations', 'developers']) assert.ok(html.includes(`id="${id}"`), id);
    assert.ok(html.indexOf('id="models"') < html.indexOf('id="app-showcase"'));
    assert.ok(html.indexOf('id="app-showcase"') < html.indexOf('id="integrations"'));
    const hero = html.match(/<section class="story-hero"[\s\S]*?<\/section>/)?.[0];
    assert.ok(hero);
    assert.ok(hero.includes('id="home-demo"'));
    assert.ok(hero.includes(getStoryCopy(locale)['hero.title']));
    assert.ok(!/href="[^"]*\/download/.test(hero));
    assert.ok(!/交互示例|演示记忆|Interactive example|example memor/i.test(html));
    assert.ok(html.includes('story-world-print'));
    assert.ok(!html.includes('screen-section'));
    for (const id of STORY_APPS) assert.ok((DEMO_PREVIEW_APP_IDS as readonly string[]).includes(id));
    const showcase = html.match(/<section id="app-showcase"[\s\S]*?(?=<section id="integrations")/)?.[0];
    assert.ok(showcase);
    assert.equal(content.hero.demo.apps.items.length, 23);
    for (const item of content.hero.demo.apps.items) {
      assert.ok((DEMO_PREVIEW_APP_IDS as readonly string[]).includes(item.id), item.id);
    }
    for (const item of content.hero.demo.apps.items) {
      assert.ok(showcase.includes(`data-app-id="${item.id}"`), item.id);
    }
    assert.equal(showcase.match(/data-app-id=/g)?.length, 46);
    assert.ok(showcase.includes(getStoryCopy(locale)['showcase.explore']));
    assert.ok(!showcase.includes('story-app-showcase-window'));
    const integrations = html.match(/<section id="integrations"[\s\S]*?(?=<section id="developers")/)?.[0];
    assert.ok(integrations);
    assert.equal(integrations.match(/class="story-use-case"/g)?.length, 3);
    assert.ok(integrations.includes(getStoryCopy(locale)['integrations.title']));
    assert.ok(!integrations.includes('story-content-check'));
  }
});

test('a memory change refreshes an already-open peer view of the same demo agent', { timeout: 3000 }, async () => {
  const { hero: { demo } } = await loadLandingContent('zh');
  const seed = demo.appPreview.zhiyu.partners.find(partner => partner.id === 'demo:emberware-court:character-0')!;
  const client = createDemoZhiyuAgentClient(seed, demo.appPreview.zhiyu);
  const home = createDemoZhiyuAgentCenterSession(client), stage = createDemoZhiyuAgentCenterSession(client);
  await Promise.all([home.session.refresh(), stage.session.refresh()]);
  const memoryId = stage.session.getSnapshot().state.cognition.memory!.items[0]!.memoryId;
  let unsubscribe = () => {};
  const updated = new Promise<void>((resolve, reject) => {
    unsubscribe = client.subscribeChanges(() => { void home.session.refresh().then(resolve, reject); });
  });
  await stage.session.correctMemory({ memoryId, correctedContent: '演示修正：下一次讨论矿物颜料。' });
  await updated;
  assert.equal(home.session.getSnapshot().state.cognition.memory?.items[0]?.content, '演示修正：下一次讨论矿物颜料。');
  assert.equal(seed.memories[0]?.content, getStoryCopy('zh')['experience.memorySeed']);
  unsubscribe(); home.session.dispose(); stage.session.dispose();
});

test('the App carousel wraps in both directions', () => {
  assert.equal(wrapShowcaseIndex(-1, 23), 22);
  assert.equal(wrapShowcaseIndex(23, 23), 0);
  assert.equal(wrapShowcaseIndex(12, 23), 12);
  assert.equal(wrapShowcaseIndex(47, 23), 1);
  assert.equal(wrapShowcaseIndex(1, 0), 0);
});
