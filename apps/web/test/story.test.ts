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
import { findCenteredShowcaseIndex, wrapShowcaseIndex } from '../src/landing/content/app-showcase.js';
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
    for (const id of ['home-demo', 'apps', 'worlds', 'app-showcase', 'integrations', 'devices', 'developers']) assert.ok(html.includes(`id="${id}"`), id);
    assert.ok(!html.includes('story-power'));
    assert.ok(!html.includes('href="#models"'));
    assert.ok(html.indexOf('id="app-showcase"') < html.indexOf('id="integrations"'));
    const hero = html.match(/<section class="story-hero"[\s\S]*?<\/section>/)?.[0];
    assert.ok(hero);
    assert.ok(hero.includes('id="home-demo"'));
    assert.match(hero, /<a class="story-hero-continue" href="#home-demo">/);
    assert.ok(hero.includes(getStoryCopy(locale)['hero.title']));
    assert.ok(!/href="[^"]*\/download/.test(hero));
    const ownership = html.match(/<section class="story-section story-experience"[\s\S]*?(?=<section class="story-section story-worlds")/)?.[0];
    assert.ok(ownership);
    const ownershipIntro = ownership.match(/<div class="story-experience-intro">[\s\S]*?<\/div>/)?.[0];
    assert.ok(ownershipIntro);
    assert.match(ownershipIntro, /<h2 id="experience-heading">/);
    assert.doesNotMatch(ownershipIntro, /<(?:p|small)\b|class="story-eyebrow"/);
    // Each chapter links its scrolling copy to the corresponding app preview.
    for (const key of ['models', 'memory', 'continuity'] as const) {
      assert.ok(ownership.includes(getStoryCopy(locale)[`experience.${key}Title`]));
      assert.ok(ownership.includes(getStoryCopy(locale)[`experience.${key}Body`]));
      assert.ok(ownership.includes(getStoryCopy(locale)[`experience.${key}Window`]));
      assert.ok(ownership.includes(`href="#ownership-${key}"`));
      assert.ok(ownership.includes(`id="ownership-${key}-copy"`));
      assert.ok(ownership.includes(`id="ownership-${key}"`));
      assert.ok(ownership.includes(`data-ownership-chapter="${key}" data-active="${key === 'models'}"`));
    }
    assert.match(ownership, /href="#ownership-models" aria-current="location"/);

    assert.ok(!/交互示例|演示记忆|Interactive example|example memor/i.test(html));
    const worlds = html.match(/<section class="story-section story-worlds"[\s\S]*?(?=<section id="app-showcase")/)?.[0];
    assert.ok(worlds);
    assert.ok(worlds.includes('story-world-print'));
    assert.equal(worlds.match(/story-app-showcase-arrow story-app-showcase-arrow--(?:previous|next)/g)?.length, 2);
    assert.ok(!worlds.includes('story-gallery-controls'));
    assert.ok(!html.includes('screen-section'));
    for (const id of STORY_APPS) assert.ok((DEMO_PREVIEW_APP_IDS as readonly string[]).includes(id));
    const showcase = html.match(/<section id="app-showcase"[\s\S]*?(?=<section id="integrations")/)?.[0];
    assert.ok(showcase);
    assert.equal(content.hero.demo.apps.items.length, 23);
    for (const item of content.hero.demo.apps.items) {
      assert.ok((DEMO_PREVIEW_APP_IDS as readonly string[]).includes(item.id), item.id);
    }
    for (const item of content.hero.demo.apps.items) {
      assert.ok(item.iconSrc, `${item.id} has a source App icon`);
      assert.ok(showcase.includes(`data-app-id="${item.id}"`), item.id);
    }
    assert.equal(showcase.match(/data-app-id=/g)?.length, 46);
    assert.equal(showcase.match(/story-app-showcase-logo-name/g)?.length, 46);
    assert.ok(showcase.includes(getStoryCopy(locale)['showcase.explore']));
    assert.ok(!showcase.includes('story-app-showcase-controls'));
    assert.ok(!showcase.includes('story-app-showcase-window'));
    const integrations = html.match(/<section id="integrations"[\s\S]*?(?=<section id="devices")/)?.[0];
    assert.ok(integrations);
    assert.equal(integrations.match(/class="story-use-case"/g)?.length, 3);
    assert.ok(integrations.includes(getStoryCopy(locale)['integrations.title']));
    assert.ok(!integrations.includes('story-content-check'));
    const devices = html.match(/<section id="devices"[\s\S]*?(?=<section id="developers")/)?.[0];
    assert.ok(devices);
    assert.match(html, /href="#devices"/);
    const devicesText = devices.replace(/<[^>]*>/g, '');
    for (const key of ['devices.title', 'devices.androidNote', 'devices.requirements', 'devices.vision', 'devices.futureNote'] as const) {
      assert.ok(devicesText.includes(getStoryCopy(locale)[key]), key);
    }
    assert.doesNotMatch(devices, /<details\b/);
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

test('the App carousel identifies the visible logo nearest the center, including its duplicate', () => {
  const bounds = { left: 0, right: 390 };
  const logos = [
    { left: -100, right: -20 },
    { left: 20, right: 80 },
    { left: 160, right: 220 },
    { left: 410, right: 470 },
    { left: 154, right: 214 },
  ];
  assert.equal(findCenteredShowcaseIndex(logos, bounds, 4), 2);
  assert.equal(findCenteredShowcaseIndex([logos[0]!, logos[1]!, { left: -200, right: -160 }, logos[3]!, logos[4]!], bounds, 4), 0);
  assert.equal(findCenteredShowcaseIndex([{ left: 500, right: 560 }], bounds, 4), null);
});

test('the ownership preview follows the copy across the reading line in both directions', async () => {
  const { findActiveOwnershipChapter } = await import('../src/landing/components/story/story-experience.js');
  const centers = [180, 620, 1100];
  assert.equal(findActiveOwnershipChapter(centers, 100), 0);
  assert.equal(findActiveOwnershipChapter(centers, 620), 1);
  assert.equal(findActiveOwnershipChapter(centers, 900), 1);
  assert.equal(findActiveOwnershipChapter(centers, 1200), 2);
  assert.equal(findActiveOwnershipChapter(centers, 500), 0);
});

test('the Home to ownership transition follows scroll in both directions and hands off near the destination', async () => {
  const { storyHomeTransitionState } = await import('../src/landing/components/story/story-motion.js');
  const start = 1200, end = 2400;
  assert.deepEqual(storyHomeTransitionState(start, start, end), { progress: 0, travel: 0, targetOpacity: 0 });
  assert.deepEqual(storyHomeTransitionState((start + end) / 2, start, end), { progress: 0.5, travel: 0.5, targetOpacity: 0 });
  assert.deepEqual(storyHomeTransitionState(end, start, end), { progress: 1, travel: 1, targetOpacity: 1 });
  assert.equal(storyHomeTransitionState(start - 300, start, end).progress, 0);
  assert.equal(storyHomeTransitionState(end + 300, start, end).progress, 1);
  assert.equal(storyHomeTransitionState(start + 300, start, end).travel, storyHomeTransitionState(end - 900, start, end).travel);
  const handoff = storyHomeTransitionState(start + (end - start) * 0.86, start, end);
  assert.ok(Math.abs(handoff.targetOpacity - 0.5) < 1e-10);
});
