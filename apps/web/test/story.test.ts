import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
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
import { PLATFORM_CAPABILITIES } from '../src/pages/platform-capability-samples.js';

test('the bilingual landing copy has complete key and interpolation parity', () => {
  const zh = getStoryCopy('zh'), en = getStoryCopy('en');
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
    assert.ok(zh[key].trim() && en[key].trim(), key);
    const params = (text: string) => [...text.matchAll(/\{([a-zA-Z]\w*)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(params(zh[key]), params(en[key]), key);
  }
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
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [`/?lang=${locale}`] },
      createElement(HeroDemoSessionProvider, {
        demo,
        children: createElement(StoryPage, { locale, links: localizedLinks, onLocale() {} }),
      }),
    ));
    for (const id of ['hero-demo', 'apps', 'local-agents', 'home-demo', 'explore-layers']) {
      assert.ok(html.includes(`id="${id}"`), id);
    }
    assert.ok(!html.includes('story-power'));
    assert.ok(!html.includes('href="#models"'));
    assert.ok(!html.includes('screen-section'));
    assert.doesNotMatch(html, /(?:id="devices"|href="#devices")/);

    const sections = [...html.matchAll(/<section [^>]*class="(?:story-section )?(story-[\w-]+)"/g)].map(match => match[1]);
    assert.deepEqual(sections, [
      'story-hero',
      'story-experience',
      'story-agents',
      'story-runtime',
      'story-portals',
      'story-ending',
    ]);

    const hero = html.match(/<section class="story-hero"[\s\S]*?<\/section>/)?.[0];
    assert.ok(hero);
    assert.ok(!hero.includes('class="story-hero-eyebrow"'));
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
    const navLinks = [...navigation.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => [
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

    const ownership = html.match(/<section class="story-section story-experience"[\s\S]*?(?=<section id="local-agents")/)?.[0];
    assert.ok(ownership);

    const localAgents = html.match(/<section id="local-agents"[\s\S]*?<\/section>/)?.[0];
    assert.ok(localAgents);
    assert.ok(localAgents.includes(copy['agents.title']));
    const renderedPillars = [...localAgents.matchAll(/data-agent-pillar="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(renderedPillars, ['utopia', 'origin', 'embodiment']);
    assert.ok(localAgents.includes('data-active-scene="utopia"'));
    assert.ok(localAgents.includes('/demo/utopia/seaside-island.webp'));
    assert.ok(localAgents.includes('class="story-companion-showcase"'));
    assert.doesNotMatch(localAgents, /agentHandle|Machine Loadout|Atomic Job Capture/);
    assert.ok(localAgents.includes(`href="${withLocaleQuery('/home', locale)}"`));
    if (locale === 'en') {
      assert.doesNotMatch(localAgents, /\p{Script=Han}/u);
    }
    const ownershipIntro = ownership.match(/<div class="story-experience-intro">[\s\S]*?<\/div>/)?.[0];
    assert.ok(ownershipIntro);
    assert.match(ownershipIntro, /<h2 id="experience-heading">/);
    assert.doesNotMatch(ownershipIntro, /<(?:p|small)\b|class="story-eyebrow"/);
    assert.ok(!ownership.includes('class="story-ownership-preview-trigger"'));
    assert.ok(!ownership.includes('inert'));
    assert.ok(ownership.includes('class="story-ownership-open"'));
    assert.ok(ownership.includes(copy['experience.localModelsTab']));
    assert.ok(ownership.includes(copy['experience.cloudModelsTab']));
    assert.ok(ownership.includes(copy['experience.continuityTabPermissions']));
    assert.ok(ownership.includes(copy['experience.continuityTabVane']));
    assert.ok(ownership.includes(copy['experience.continuityTabParentos']));
    assert.deepEqual(
      demo.home.capabilities.map((item) => item.id),
      Object.values(PLATFORM_CAPABILITIES).flat(),
    );
    for (const key of ['models', 'memory', 'continuity'] as const) {
      assert.ok(ownership.includes(copy[`experience.${key}Title`]));
      assert.ok(ownership.includes(copy[`experience.${key}Body`]));
      assert.ok(ownership.includes(copy[`experience.${key}Window`]));
      assert.ok(ownership.includes(`href="/?lang=${locale}#ownership-${key}"`));
      assert.ok(ownership.includes(`id="ownership-${key}-step"`));
      assert.ok(ownership.includes(`id="ownership-${key}"`));
      assert.ok(ownership.includes(`data-ownership-chapter="${key}" data-active="${key === 'models'}"`));
      assert.ok(ownership.includes(`data-hash-target="ownership-${key}-step"`));
    }
    assert.match(ownership, /<a\b(?=[^>]*aria-current="location")(?=[^>]*href="[^"#]*#ownership-models")/);
    assert.ok(!/交互示例|演示记忆|Interactive example|example memor/i.test(html));

    const portals = html.match(/<section id="explore-layers"[\s\S]*?<\/section>/)?.[0];
    assert.ok(portals);
    assert.ok(!portals.includes('class="story-portal-badge"'));
    assert.ok(!portals.includes('跨端连续体'));
    for (const targetPath of ['/home', '/apps', '/platform', '/developers'] as const) {
      assert.ok(portals.includes(`href="${withLocaleQuery(targetPath, locale)}"`), targetPath);
    }

    const ending = html.match(/<section class="story-ending"[\s\S]*?<\/section>/)?.[0];
    assert.ok(ending);
    assert.ok(ending.includes(`href="${localizedLinks.downloadUrl}"`));
    assert.ok(!ending.includes(`href="${withLocaleQuery('/platform', locale)}"`));

    for (const id of STORY_APPS) assert.ok((DEMO_PREVIEW_APP_IDS as readonly string[]).includes(id));
    assert.equal(demo.apps.items.length, 24);
    assert.ok(demo.apps.items.some((item) => item.id === 'nimi.utopia'));
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

test('the ownership preview switches when a chapter reaches the sticky stage, in both directions', async () => {
  const { findActiveOwnershipChapter } = await import('../src/landing/components/story/story-experience.js');
  const starts = [180, 620, 1100];
  assert.equal(findActiveOwnershipChapter(starts, 100), 0);
  assert.equal(findActiveOwnershipChapter(starts, 620), 1);
  assert.equal(findActiveOwnershipChapter(starts, 900), 1);
  assert.equal(findActiveOwnershipChapter(starts, 1100), 2);
  assert.equal(findActiveOwnershipChapter(starts, 619), 0);
});

test('the ownership bar fills across a chapter and rewinds with scroll', async () => {
  const { getOwnershipChapterProgress } = await import('../src/landing/components/story/story-experience.js');
  assert.equal(getOwnershipChapterProgress(80, 480), 0);
  assert.equal(getOwnershipChapterProgress(-100, 300), 0.25);
  assert.equal(getOwnershipChapterProgress(-300, 100), 0.75);
  assert.equal(getOwnershipChapterProgress(-400, 0), 1);
  assert.equal(getOwnershipChapterProgress(-460, -60), 1);
  assert.equal(getOwnershipChapterProgress(-200, 200), 0.5);
});

test('hero screen paging moves cleanly between the hero, full-screen demo stage, and next section', async () => {
  const { resolveHeroScreenTarget } = await import('../src/landing/components/story/story-motion.js');
  const anchors = { heroTop: 0, demoScreen: 420, nextScreen: 1260 };

  // Downward: first screen -> full-screen demo -> next section -> native free scroll
  assert.equal(resolveHeroScreenTarget(0, 100, anchors), 420);
  assert.equal(resolveHeroScreenTarget(200, 100, anchors), 420);
  assert.equal(resolveHeroScreenTarget(420, 100, anchors), 1260);
  assert.equal(resolveHeroScreenTarget(800, 100, anchors), 1260);
  assert.equal(resolveHeroScreenTarget(1260, 100, anchors), null);
  assert.equal(resolveHeroScreenTarget(1800, 100, anchors), null);

  // Upward: deep in page stays native; top of next section -> full-screen demo -> first screen
  assert.equal(resolveHeroScreenTarget(1800, -100, anchors), null);
  assert.equal(resolveHeroScreenTarget(1260, -100, anchors), 420);
  assert.equal(resolveHeroScreenTarget(800, -100, anchors), 420);
  assert.equal(resolveHeroScreenTarget(420, -100, anchors), 0);
  assert.equal(resolveHeroScreenTarget(200, -100, anchors), 0);
  assert.equal(resolveHeroScreenTarget(0, -100, anchors), null);
});

test('hero full-screen guide advances naturally from Nimi Home overview through Zhiyu sync and Nimi Home chat', async () => {
  const { resolveHeroGuideStep } = await import('../src/landing/components/hero-demo.js');
  assert.equal(
    resolveHeroGuideStep({ activeTab: 'home-overview', syncedTurnCount: 0, completedHandoff: false }),
    'open-zhiyu',
  );
  assert.equal(
    resolveHeroGuideStep({ activeTab: 'zhiyu', syncedTurnCount: 0, completedHandoff: false }),
    'send',
  );
  assert.equal(
    resolveHeroGuideStep({ activeTab: 'zhiyu', syncedTurnCount: 2, completedHandoff: false }),
    'home-chat',
  );
  assert.equal(
    resolveHeroGuideStep({ activeTab: 'home-overview', syncedTurnCount: 2, completedHandoff: false }),
    'home-chat',
  );
  assert.equal(
    resolveHeroGuideStep({ activeTab: 'home-chat', syncedTurnCount: 2, completedHandoff: false }),
    'done',
  );
  assert.equal(
    resolveHeroGuideStep({ activeTab: 'home-overview', syncedTurnCount: 2, completedHandoff: true }),
    'done',
  );
});

test('in-context hero guide anchors to canvas targets and never overlaps the window titlebar', async () => {
  const { computeGuidePopoverLayout } = await import('../src/landing/components/hero-demo.js');

  // Step 1: anchors below the Zhiyu app icon inside Nimi Home canvas
  const step1 = computeGuidePopoverLayout({
    container: { width: 1000, height: 640 },
    card: { width: 300, height: 44 },
    target: { left: 96, top: 280, width: 68, height: 74 },
    preferredPlacement: 'below',
    safeTop: 52,
    pad: 14,
    gap: 12,
  });
  assert.equal(step1.placement, 'below');
  assert.equal(step1.top, 366);
  assert.equal(step1.left, 14);
  assert.equal(step1.caretX, 116);

  // Step 2: anchors above the Zhiyu composer surface inside Zhiyu canvas
  const step2 = computeGuidePopoverLayout({
    container: { width: 1000, height: 640 },
    card: { width: 320, height: 44 },
    target: { left: 200, top: 530, width: 600, height: 84 },
    preferredPlacement: 'above',
    safeTop: 52,
    pad: 14,
    gap: 12,
  });
  assert.equal(step2.placement, 'above');
  assert.equal(step2.top, 474);
  assert.equal(step2.left, 340);
  assert.equal(step2.caretX, 160);

  // Step 3 inside Zhiyu: sits above the composer without a downward caret
  const step3 = computeGuidePopoverLayout({
    container: { width: 1000, height: 640 },
    card: { width: 300, height: 44 },
    target: { left: 200, top: 530, width: 600, height: 84 },
    preferredPlacement: 'above-floating',
    safeTop: 52,
    pad: 14,
    gap: 12,
  });
  assert.equal(step3.placement, 'floating');
  assert.equal(step3.top, 474);

  // Fallback when target is unmounted or scrolled out of view: bottom-center floating, below safeTop
  const fallback = computeGuidePopoverLayout({
    container: { width: 1000, height: 640 },
    card: { width: 300, height: 44 },
    target: null,
    preferredPlacement: 'below',
    safeTop: 52,
    pad: 14,
    gap: 12,
  });
  assert.equal(fallback.placement, 'floating');
  assert.equal(fallback.left, 350);
  assert.equal(fallback.top, 576);

  // Target near top cannot push the guide up over the window titlebar
  const nearTop = computeGuidePopoverLayout({
    container: { width: 1000, height: 640 },
    card: { width: 300, height: 44 },
    target: { left: 120, top: 56, width: 80, height: 40 },
    preferredPlacement: 'above',
    safeTop: 52,
    pad: 14,
    gap: 12,
  });
  assert.equal(nearTop.placement, 'below');
  assert.ok(nearTop.top >= 52);
});
