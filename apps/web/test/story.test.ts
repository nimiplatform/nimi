import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getStoryCopy } from '../src/landing/content/story-copy.js';
import { DEFAULT_STORY_AGENT, galleryDragSelection, wrapGalleryIndex, STORY_APPS } from '../src/landing/content/story-model.js';
import { createCoreHeroDemo } from '../src/landing/content/core-hero-demo.js';
import { loadLandingContent } from '../src/landing/content/landing-content.js';
import { StoryPage } from '../src/landing/components/story/story-page.js';
import { HeroDemoSessionProvider } from '../src/landing/components/hero-demo-session.js';
import { resolveLandingLinks, resolveLocalizedLinks, withLocaleQuery } from '../src/landing/config/landing-links.js';
import { createDemoZhiyuAgentClient, createDemoZhiyuAgentCenterSession } from '../src/landing/components/demo-zhiyu-agent-center.js';
import { DEMO_PREVIEW_APP_IDS } from '../src/landing/components/demo-app-preview.js';
import { PUBLIC_SITE_NAV_ITEMS } from '../src/pages/public-site-shell.js';

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

test('the overview homepage centers on the personal AI foundation, cross-app continuity, and product layer portals', async () => {
  for (const locale of ['zh', 'en'] as const) {
    const demo = createCoreHeroDemo(locale);
    const localizedLinks = resolveLocalizedLinks(resolveLandingLinks({}), locale);
    const copy = getStoryCopy(locale);
    const html = renderToStaticMarkup(createElement(HeroDemoSessionProvider, {
      demo,
      children: createElement(StoryPage, { locale, links: localizedLinks, onLocale() {} }),
    }));
    for (const id of ['hero-demo', 'foundation-pillars', 'apps', 'home-demo', 'explore-layers']) {
      assert.ok(html.includes(`id="${id}"`), id);
    }
    assert.ok(!html.includes('story-power'));
    assert.ok(!html.includes('href="#models"'));
    assert.ok(!html.includes('screen-section'));
    assert.doesNotMatch(html, /(?:id="devices"|href="#devices")/);

    const sections = [...html.matchAll(/<section [^>]*class="(?:story-section )?(story-[\w-]+)"/g)].map(match => match[1]);
    assert.deepEqual(sections, [
      'story-hero',
      'story-pillars',
      'story-experience',
      'story-runtime',
      'story-portals',
      'story-ending',
    ]);

    const hero = html.match(/<section class="story-hero"[\s\S]*?<\/section>/)?.[0];
    assert.ok(hero);
    assert.ok(hero.includes(copy['hero.eyebrow']));
    assert.ok(hero.includes(copy['hero.title']));
    assert.ok(hero.includes(copy['hero.lead']));
    assert.ok(hero.includes(`href="${localizedLinks.downloadUrl}"`));
    assert.match(hero, /<a class="story-hero-continue" href="#hero-demo">/);
    assert.match(hero, /<div id="hero-demo"[^>]*><div class="story-home-dock"><div class="story-home-slot"><\/div>/);
    assert.doesNotMatch(hero, /story-home-laptop|runtime-heading/);

    const runtime = html.match(/<section id="home-demo"[\s\S]*?<\/section>/)?.[0];
    assert.ok(runtime);
    assert.ok(runtime.includes(`<h2 id="runtime-heading">${copy['runtime.title']}</h2>`));
    assert.ok(runtime.includes(copy['runtime.caption']));
    assert.match(runtime, /<div class="story-home-window"><\/div>/);
    assert.match(runtime, /<div class="story-home-slot"><div class="story-home-companions" aria-hidden="true">/);
    assert.ok(runtime.includes('class="story-home-phone"'));
    assert.ok(runtime.includes('class="story-home-web"'));
    assert.ok(runtime.includes('zhiyu.app · Nimi Remote'));
    assert.ok(!runtime.includes('>nimi.ai<'));
    for (const frame of ['story-home-laptop', 'story-home-laptop-base', 'story-home-phone-speaker', 'story-home-web-screen', 'story-home-mac-menu', 'story-home-mac-dock', 'story-home-mac-app']) {
      assert.ok(runtime.includes(`class="${frame}"`), frame);
    }
    await access(new URL('../public/story/mac-desktop.svg', import.meta.url));
    const [phone, web] = runtime.split('<div class="story-home-web">');
    assert.ok(phone && web);
    const zhiyu = demo.appPreview.zhiyu;
    const partner = zhiyu.partners.find(candidate => candidate.id === DEFAULT_STORY_AGENT)!;
    assert.ok(phone.includes(`<strong>${partner.name}</strong>`));
    assert.ok(web.includes(`<strong>${partner.name}</strong><span>${zhiyu.appName}</span>`));
    assert.ok(phone.includes(`src="${partner.avatarUrl}"`));
    assert.ok(web.includes(`src="${partner.avatarUrl}"`));
    const expectedMessages = partner.messages.map(message => [message.role, message.text]);
    assert.ok(expectedMessages.length > 0);
    assert.deepEqual([...phone.matchAll(/class="story-home-phone-message is-(\w+)">([^<]+)<\/p>/g)].map(match => match.slice(1)), expectedMessages);
    assert.deepEqual([...web.matchAll(/class="story-home-web-message is-(\w+)">([^<]+)<\/p>/g)].map(match => match.slice(1)), expectedMessages);
    if (locale === 'en') {
      assert.doesNotMatch(phone, /\p{Script=Han}/u);
      assert.doesNotMatch(web, /\p{Script=Han}/u);
    }

    const navigation = html.match(/<nav id="story-navigation"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(navigation);
    const navLinks = [...navigation.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => [
      match[1],
      (match[2] ?? '').replace(/<[^>]+>/g, '').trim(),
    ]);
    assert.deepEqual(
      navLinks,
      [
        ...PUBLIC_SITE_NAV_ITEMS.map((item) => [
          withLocaleQuery(item.path, locale),
          item.label[locale].replace('&', '&amp;'),
        ]),
        [withLocaleQuery('/account', locale), copy['common.account']],
      ],
    );

    const ownership = html.match(/<section class="story-section story-experience"[\s\S]*?(?=<section id="home-demo")/)?.[0];
    assert.ok(ownership);
    const ownershipIntro = ownership.match(/<div class="story-experience-intro">[\s\S]*?<\/div>/)?.[0];
    assert.ok(ownershipIntro);
    assert.match(ownershipIntro, /<h2 id="experience-heading">/);
    assert.doesNotMatch(ownershipIntro, /<(?:p|small)\b|class="story-eyebrow"/);
    assert.ok(ownership.includes('class="story-ownership-preview-trigger"'));
    for (const key of ['models', 'memory', 'continuity'] as const) {
      assert.ok(ownership.includes(copy[`experience.${key}Title`]));
      assert.ok(ownership.includes(copy[`experience.${key}Body`]));
      assert.ok(ownership.includes(copy[`experience.${key}Window`]));
      assert.ok(ownership.includes(`href="#ownership-${key}"`));
      assert.ok(ownership.includes(`id="ownership-${key}-copy"`));
      assert.ok(ownership.includes(`id="ownership-${key}"`));
      assert.ok(ownership.includes(`data-ownership-chapter="${key}" data-active="${key === 'models'}"`));
    }
    assert.match(ownership, /href="#ownership-models" aria-current="location"/);
    assert.ok(!/交互示例|演示记忆|Interactive example|example memor/i.test(html));

    const portals = html.match(/<section id="explore-layers"[\s\S]*?<\/section>/)?.[0];
    assert.ok(portals);
    for (const targetPath of ['/home', '/apps', '/platform', '/developers'] as const) {
      assert.ok(portals.includes(`href="${withLocaleQuery(targetPath, locale)}"`), targetPath);
    }

    for (const id of STORY_APPS) assert.ok((DEMO_PREVIEW_APP_IDS as readonly string[]).includes(id));
    assert.equal(demo.apps.items.length, 23);
    for (const item of demo.apps.items) {
      assert.ok((DEMO_PREVIEW_APP_IDS as readonly string[]).includes(item.id), item.id);
      assert.ok(item.iconSrc, `${item.id} has a source App icon`);
      await access(new URL(`../public/story/app-previews/${locale}/${item.id}.webp`, import.meta.url));
    }
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
