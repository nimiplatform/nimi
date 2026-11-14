import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getStoryCopy } from '../src/landing/content/story-copy.js';
import { DEFAULT_STORY_AGENT, galleryDragSelection, wrapGalleryIndex, STORY_APPS } from '../src/landing/content/story-model.js';
import { loadLandingContent } from '../src/landing/content/landing-content.js';
import { StoryPage } from '../src/landing/components/story/story-page.js';
import { HeroDemoSessionProvider } from '../src/landing/components/hero-demo-session.js';
import { resolveLandingLinks } from '../src/landing/config/landing-links.js';
import { createDemoZhiyuAgentClient, createDemoZhiyuAgentCenterSession } from '../src/landing/components/demo-zhiyu-agent-center.js';
import { DEMO_PREVIEW_APP_IDS } from '../src/landing/components/demo-app-preview.js';

test('the bilingual landing copy has complete key and interpolation parity', () => {
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

test('the landing opens with the Home demo before ownership and keeps the Runtime device demo below it', async () => {
  for (const locale of ['zh', 'en'] as const) {
    const content = await loadLandingContent(locale);
    const html = renderToStaticMarkup(createElement(HeroDemoSessionProvider, { demo: content.hero.demo,
      children: createElement(StoryPage, { content, locale, links: resolveLandingLinks({}), onLocale() {} }),
    }));
    for (const id of ['hero-demo', 'home-demo', 'apps', 'worlds', 'app-showcase', 'integrations', 'developers']) assert.ok(html.includes(`id="${id}"`), id);
    assert.ok(!html.includes('story-power'));
    assert.ok(!html.includes('href="#models"'));
    const sections = [...html.matchAll(/<section [^>]*class="(?:story-section )?(story-[\w-]+)"/g)].map(match => match[1]);
    assert.deepEqual(sections, ['story-hero', 'story-experience', 'story-runtime', 'story-app-showcase', 'story-integrations', 'story-builder', 'story-worlds', 'story-ending']);
    const hero = html.match(/<section class="story-hero"[\s\S]*?<\/section>/)?.[0];
    assert.ok(hero);
    const runtime = html.match(/<section id="home-demo"[\s\S]*?<\/section>/)?.[0];
    assert.ok(runtime);
    assert.ok(runtime.includes(`<h2 id="runtime-heading">${getStoryCopy(locale)['runtime.title']}</h2>`));
    assert.match(hero, /<div id="hero-demo"[^>]*><div class="story-home-dock"><div class="story-home-slot"><\/div>/);
    assert.doesNotMatch(hero, /story-home-laptop|runtime-heading/);
    assert.match(runtime, /<div class="story-home-window"><\/div>/);
    assert.match(runtime, /<div class="story-home-slot"><div class="story-home-companions" aria-hidden="true">/);
    assert.ok(runtime.includes('class="story-home-phone"'));
    assert.ok(runtime.includes('class="story-home-web"'));
    for (const frame of ['story-home-laptop', 'story-home-laptop-base', 'story-home-phone-speaker', 'story-home-web-screen', 'story-home-mac-menu', 'story-home-mac-dock', 'story-home-mac-app']) {
      assert.ok(runtime.includes(`class="${frame}"`), frame);
    }
    await access(new URL('../public/story/mac-desktop.svg', import.meta.url));
    const [phone, web] = runtime.split('<div class="story-home-web">');
    assert.ok(phone && web);
    const zhiyu = content.hero.demo.appPreview.zhiyu;
    const partner = zhiyu.partners.find(candidate => candidate.id === DEFAULT_STORY_AGENT)!;
    assert.ok(phone.includes(`<strong>${partner.name}</strong>`));
    assert.ok(web.includes(`<strong>${partner.name}</strong><span>${zhiyu.appName}</span>`));
    assert.ok(phone.includes(`src="${partner.avatarUrl}"`));
    assert.ok(web.includes(`src="${partner.avatarUrl}"`));
    const expectedMessages = partner.messages.map(message => [message.role, message.text]);
    assert.ok(expectedMessages.length > 0);
    assert.deepEqual([...phone.matchAll(/class="story-home-phone-message is-(\w+)">([^<]+)<\/p>/g)].map(match => match.slice(1)), expectedMessages);
    assert.deepEqual([...web.matchAll(/class="story-home-web-message is-(\w+)">([^<]+)<\/p>/g)].map(match => match.slice(1)), expectedMessages);
    assert.match(hero, /<a class="story-hero-continue" href="#hero-demo">/);
    assert.ok(hero.includes(getStoryCopy(locale)['hero.title']));
    assert.ok(!/href="[^"]*\/download/.test(hero));
    const navigation = html.match(/<nav id="story-navigation"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(navigation);
    const links = (markup: string) => [...markup.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map(match => match.slice(1));
    assert.deepEqual(links(navigation), [
      ['#hero-demo', getStoryCopy(locale)['nav.experience']],
      ['#apps', getStoryCopy(locale)['nav.capabilities']],
      ['#app-showcase', getStoryCopy(locale)['nav.apps']],
      ['#integrations', getStoryCopy(locale)['nav.integrations'].replace('&', '&amp;')],
      ['#developers', getStoryCopy(locale)['nav.developers']],
      ['#worlds', getStoryCopy(locale)['nav.worlds'].replace('&', '&amp;')],
    ]);
    const ownership = html.match(/<section class="story-section story-experience"[\s\S]*?(?=<section id="home-demo")/)?.[0];
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
    const worlds = html.match(/<section class="story-section story-worlds"[\s\S]*?<\/section>/)?.[0];
    assert.ok(worlds);
    assert.ok(worlds.includes(locale === 'zh' ? '瓷炭院' : 'Emberware Court'));
    if (locale === 'en') {
      assert.doesNotMatch(worlds, /\p{Script=Han}/u);
      assert.doesNotMatch(phone, /\p{Script=Han}/u);
      assert.doesNotMatch(web, /\p{Script=Han}/u);
    }
    assert.ok(worlds.includes('story-world-print'));
    assert.equal(worlds.match(/story-app-showcase-arrow story-app-showcase-arrow--(?:previous|next)/g)?.length, 2);
    assert.ok(!worlds.includes('story-gallery-controls'));
    assert.ok(!html.includes('screen-section'));
    for (const id of STORY_APPS) assert.ok((DEMO_PREVIEW_APP_IDS as readonly string[]).includes(id));
    const showcase = html.match(/<section id="app-showcase"[\s\S]*?<\/section>/)?.[0];
    assert.ok(showcase);
    assert.equal(content.hero.demo.apps.items.length, 23);
    for (const item of content.hero.demo.apps.items) {
      assert.ok((DEMO_PREVIEW_APP_IDS as readonly string[]).includes(item.id), item.id);
      assert.ok(item.iconSrc, `${item.id} has a source App icon`);
      await access(new URL(`../public/story/app-previews/${locale}/${item.id}.webp`, import.meta.url));
    }
    const initialApps = content.hero.demo.apps.items.slice(0, 4);
    for (const item of initialApps) {
      assert.ok(showcase.includes(`data-app-id="${item.id}"`), item.id);
      assert.ok(showcase.includes(`src="/story/app-previews/${locale}/${item.id}.webp"`), item.id);
      assert.ok(showcase.includes(`aria-label="${getStoryCopy(locale)['showcase.explore']} · ${item.name}"`), item.id);
    }
    assert.equal(showcase.match(/data-app-id=/g)?.length, initialApps.length * 2);
    assert.equal(showcase.match(/story-app-showcase-card-logo/g)?.length, initialApps.length * 2);
    assert.equal(showcase.match(/class="story-app-showcase-track-copy"/g)?.length, 2);
    assert.ok(showcase.includes('data-track-copy="duplicate"'));
    assert.ok(showcase.includes('data-card-width="wide"'));
    assert.ok(showcase.includes('data-card-width="narrow"'));
    assert.ok(!showcase.includes('story-app-showcase-card-details'));
    const integrations = html.match(/<section id="integrations"[\s\S]*?<\/section>/)?.[0];
    assert.ok(integrations);
    const copy = getStoryCopy(locale);
    const integrationHeading = integrations.match(/<h2 id="integrations-heading">(.*?)<\/h2>/)?.[1];
    assert.equal(integrationHeading?.replaceAll(/<\/?span>/g, ''), copy['integrations.title']);
    const cards = integrations.match(/<article\b[^>]*>[\s\S]*?<\/article>/g) ?? [];
    assert.equal(cards.length, 3);
    const [handoff, sources, messaging] = cards;
    assert.ok(handoff && sources && messaging);
    assert.ok(handoff.includes(copy['integrations.app']));
    for (const key of ['integrations.checklistFood', 'integrations.checklistMeetup'] as const) {
      assert.equal(handoff.split(copy[key]).length - 1, 2);
    }
    assert.ok(handoff.includes(copy['integrations.save']));
    assert.ok(sources.includes(copy['integrations.mcp']) && sources.includes('Microsoft Learn'));
    assert.ok(sources.includes('story-integration-source-picker'));
    assert.ok(messaging.includes(copy['integrations.wechat']) && messaging.includes(copy['integrations.feishu']));
    assert.ok(messaging.includes(copy['integrations.connected']) && messaging.includes(copy['integrations.connect']));
    assert.doesNotMatch(integrations, /<(?:button|input|select)\b/);
    assert.ok(integrations.includes(`href="${resolveLandingLinks({}).integrationsUrl}"`));
    assert.doesNotMatch(html, /(?:id="devices"|href="#devices")/);
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

test('the ownership preview follows the copy across the reading line in both directions', async () => {
  const { findActiveOwnershipChapter } = await import('../src/landing/components/story/story-experience.js');
  const centers = [180, 620, 1100];
  assert.equal(findActiveOwnershipChapter(centers, 100), 0);
  assert.equal(findActiveOwnershipChapter(centers, 620), 1);
  assert.equal(findActiveOwnershipChapter(centers, 900), 1);
  assert.equal(findActiveOwnershipChapter(centers, 1200), 2);
  assert.equal(findActiveOwnershipChapter(centers, 500), 0);
});
