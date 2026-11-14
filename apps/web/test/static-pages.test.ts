import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StaticPage } from '../src/pages/static-page.js';
import { PlatformPage } from '../src/pages/platform-page.js';
import { DevelopersPage } from '../src/pages/developers-page.js';
import { PublicNotFoundPage } from '../src/pages/public-site-shell.js';
import { getStoryCopy } from '../src/landing/content/story-copy.js';
import { resolveLandingLinks, resolveLocalizedLinks } from '../src/landing/config/landing-links.js';

function renderRoute(path: string, routePath: string, element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(
        Routes,
        {},
        createElement(Route, { path: routePath, element }),
      ),
    ),
  );
}

test('apps page lists admitted apps as informational entries without install actions', () => {
  const html = renderRoute('/apps', '/apps', createElement(StaticPage, { kind: 'apps' }));
  assert.match(html, /ParentOS/);
  assert.match(html, /OpenMontage/);
  assert.match(html, /macOS arm64/);
  assert.match(html, /Windows x86_64/);
  assert.match(html, /href="\/apps\/nimi\.parentos\?lang=(en|zh)"/);
  assert.doesNotMatch(html, /Install now|立即安装/i);
});

test('unknown app slug renders a not-found state instead of the catalog intro', () => {
  const html = renderRoute('/apps/definitely-not-an-app', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(html, /App not found|未找到这个应用/);
  assert.doesNotMatch(html, /Explore apps|探索应用/);
});

test('app detail renders the catalog or bundled platform, license, and source', () => {
  const catalogHtml = renderRoute('/apps/nimi.parentos', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(catalogHtml, /ParentOS/);
  assert.match(catalogHtml, /Transcription|语音转写/);
  assert.match(catalogHtml, /MIT/);
  assert.match(catalogHtml, /github\.com\/nimiplatform\/nimiapp-parentos/);

  const bundledHtml = renderRoute('/apps/nimi.zhiyu?lang=zh', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(bundledHtml, /织羽/);
  assert.match(bundledHtml, /随桌面端内置/);
  assert.match(bundledHtml, /MIT（随 Nimi 发行）/);
  assert.doesNotMatch(bundledHtml, /Apache-2\.0/);
  assert.match(bundledHtml, /github\.com\/nimiplatform\/nimi/);
  assert.doesNotMatch(bundledHtml, /未找到这个应用/);

  const sillyTavern = renderRoute('/apps/org.nimiplatform.sillytavern?lang=en', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(sillyTavern, /In Desktop Catalog/);
  assert.match(sillyTavern, /github\.com\/nimiplatform\/SillyTavern/);
  assert.match(sillyTavern, /<dd>macOS arm64 · Windows x86_64<\/dd>/);

  const openWhispr = renderRoute('/apps/ai.nimi.openwhispr?lang=en', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(openWhispr, /In Desktop Catalog/);
  assert.match(openWhispr, /<dd>Windows x86_64<\/dd>/);
});

test('home page exposes the worlds anchor and honest availability', () => {
  const html = renderRoute('/home', '/home', createElement(StaticPage, { kind: 'home' }));
  assert.match(html, /id="worlds"/);
  assert.match(html, /Beta/);
  assert.match(html, /no Stable release|尚无 Stable 正式版/);
  assert.doesNotMatch(html, /development installation|开发实例/);
  assert.match(html, /href="\/download\?lang=(en|zh)"/);
});

test('home page renders StoryWorlds gallery in both locales without Han leakage in English', () => {
  for (const locale of ['zh', 'en'] as const) {
    const html = renderRoute(`/home?lang=${locale}`, '/home', createElement(StaticPage, { kind: 'home' }));
    const worlds = html.match(/<section[^>]*class="story-section story-worlds"[\s\S]*?<\/section>/)?.[0];
    assert.ok(worlds);
    assert.ok(worlds.includes(locale === 'zh' ? '瓷炭院' : 'Emberware Court'));
    assert.ok(worlds.includes('story-world-print'));
    assert.equal(worlds.match(/story-app-showcase-arrow story-app-showcase-arrow--(?:previous|next)/g)?.length, 2);
    assert.ok(!worlds.includes('story-gallery-controls'));
    if (locale === 'en') {
      assert.doesNotMatch(worlds, /\p{Script=Han}/u);
    }
  }
});

test('apps page distinguishes Nimi Official vs Open-Source Nimi Adapted apps across 23 entries and renders StoryIntegrations', () => {
  for (const locale of ['zh', 'en'] as const) {
    const html = renderRoute(`/apps?lang=${locale}`, '/apps', createElement(StaticPage, { kind: 'apps' }));
    const copy = getStoryCopy(locale);
    const localizedLinks = resolveLocalizedLinks(resolveLandingLinks({}), locale);
    const officialCards = html.match(/<li class="public-app-card" data-origin="nimi-official">/g) ?? [];
    const adaptedCards = html.match(/<li class="public-app-card" data-origin="open-source-adapted">/g) ?? [];
    assert.equal(officialCards.length, 10);
    assert.equal(adaptedCards.length, 13);
    assert.equal(officialCards.length + adaptedCards.length, 23);
    assert.equal((html.match(/public-app-badge is-posture" data-posture="catalog-admitted"/g) ?? []).length, 23);
    assert.doesNotMatch(html, /data-posture="interactive-preview"/);
    assert.match(html, /Vane/);
    assert.match(html, /SillyTavern/);

    const integrations = html.match(/<section id="integrations"[\s\S]*?<\/section>/)?.[0];
    assert.ok(integrations);
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
    assert.ok(integrations.includes(`href="${localizedLinks.integrationsUrl}"`));
  }
});

test('platform page renders three-domain boundaries, selected capability routes, and StoryContentCheck without deferred or vendor claims', () => {
  const activeCapabilities = [
    'text.generate',
    'text.embed',
    'image.generate',
    'video.generate',
    'vision.locate',
    'realtime.interact',
    'audio.synthesize',
    'audio.transcribe',
    'music.generate',
    'voice.create',
    'audio.separate',
  ];
  for (const locale of ['zh', 'en'] as const) {
    const html = renderRoute(`/platform?lang=${locale}`, '/platform', createElement(PlatformPage));
    for (const domain of ['runtime', 'cognition', 'realm']) {
      assert.ok(html.includes(`data-domain="${domain}"`), domain);
    }
    for (const capability of activeCapabilities) {
      assert.ok(html.includes(`<code>${capability}</code>`), capability);
    }
    assert.ok(html.includes('class="story-content-check"'));
    assert.ok(html.includes('id="content-check-demo-note"'));
    assert.doesNotMatch(html, /world\.generate|agent\.autonomy|memory\.manage/);
    assert.doesNotMatch(html, /\b(OpenAI|Anthropic|Claude|Gemini|DeepSeek|Ollama)\b/i);
  }
});

test('developers page renders 4-tab StoryBuilder including Vercel AI SDK 7 adapter and honest in-repo source bindings', () => {
  for (const locale of ['zh', 'en'] as const) {
    const html = renderRoute(`/developers?lang=${locale}`, '/developers', createElement(DevelopersPage));
    assert.ok(html.includes('id="developers"'));
    assert.ok(html.includes('Vercel AI'));
    assert.ok(html.includes('@nimiplatform/sdk'));
    assert.ok(html.includes('@nimiplatform/sdk-adapter-vercel-ai'));
    assert.ok(html.includes('@nimiplatform/kit'));
    assert.ok(html.includes('@nimiplatform/app-tools'));
    assert.ok(html.includes('sdks/rust · sdks/go · sdks/python'));
    assert.doesNotMatch(html, /Mastra/i);
  }
});

test('unknown wildcard route renders PublicNotFoundPage without exposing router developer errors', () => {
  for (const locale of ['zh', 'en'] as const) {
    const html = renderRoute(`/does-not-exist?lang=${locale}`, '*', createElement(PublicNotFoundPage));
    assert.match(html, /404/);
    assert.match(html, /href="\/\?lang=(en|zh)"/);
    assert.match(html, /href="\/apps\?lang=(en|zh)"/);
    assert.doesNotMatch(html, /Unexpected Application Error|Hey developer/i);
  }
});
