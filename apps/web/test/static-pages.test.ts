import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PublicProduct } from '../src/pages/hosted-directory.js';
import { StaticPage } from '../src/pages/static-page.js';
import { PlatformPage } from '../src/pages/platform-page.js';
import { PlatformCapabilityPreview } from '../src/pages/platform-capability-preview.js';
import type { CapabilityId } from '../src/pages/platform-capability-samples.js';
import { DevelopersPage } from '../src/pages/developers-page.js';
import { PublicNotFoundPage } from '../src/pages/public-site-shell.js';
import { getStoryCopy } from '../src/landing/content/story-copy.js';
import { CREATE_APP_COMMAND } from '../src/landing/content/story-model.js';
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
  assert.match(html, /href="\/apps\/parentos\?lang=(en|zh)"/);
  assert.doesNotMatch(html, /Install now|立即安装/i);
});

test('a valid unfamiliar slug waits for the live directory before showing not found', () => {
  const html = renderRoute('/apps/definitely-not-an-app', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(html, /Loading app details|正在读取应用介绍/);
  assert.doesNotMatch(html, /App not found|未找到这个应用/);
  const retired = renderRoute('/apps/nimi.parentos', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(retired, /App not found|未找到这个应用/);
  assert.doesNotMatch(html, /Explore apps|探索应用/);
});

test('app detail renders the catalog or bundled platform, license, and source', () => {
  const catalogHtml = renderRoute('/apps/parentos', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(catalogHtml, /ParentOS/);
  assert.match(catalogHtml, /Transcription|语音转写/);
  assert.match(catalogHtml, /MIT/);
  assert.match(catalogHtml, /github\.com\/nimiplatform\/nimiapp-parentos/);

  const bundledHtml = renderRoute('/apps/zhiyu?lang=zh', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(bundledHtml, /织羽/);
  assert.match(bundledHtml, /随桌面端内置/);
  assert.match(bundledHtml, /MIT（随 Nimi 发行）/);
  assert.doesNotMatch(bundledHtml, /Apache-2\.0/);
  assert.match(bundledHtml, /github\.com\/nimiplatform\/nimi/);
  assert.doesNotMatch(bundledHtml, /未找到这个应用/);

  const sillyTavern = renderRoute('/apps/sillytavern?lang=en', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(sillyTavern, /In Desktop Catalog/);
  assert.match(sillyTavern, /github\.com\/nimiplatform\/SillyTavern/);
  assert.match(sillyTavern, /<dd>macOS arm64 · Windows x86_64<\/dd>/);

  const openWhispr = renderRoute('/apps/openwhispr?lang=en', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(openWhispr, /In Desktop Catalog/);
  assert.match(openWhispr, /<dd>Windows x86_64<\/dd>/);
});

test('an external product without a demo shows the verified publisher and an eligible Web launch', () => {
  const item = {app_id:'example.notes',slug:'notes',display_name:'Paper Notes',publisher:'paper-team',repository:'https://github.com/paper-team/notes',license:'MIT',summary:{en:'Take notes',zh:'笔记'},pc_targets:[],capabilities:[],blocked:false,web:{url:'https://notes.nimi.xyz/',version:'1.0.0'}};
  const render = (product: typeof item | Omit<typeof item,'web'> & {web:null}) => renderRoute('/apps/notes','/apps/:slug',createElement(PublicProduct,{item:product,locale:'en',detail:true}));
  const html = render(item);
  assert.match(html,/paper-team/);
  assert.match(html,/href="https:\/\/notes\.nimi\.xyz\/"/);
  assert.doesNotMatch(html,/Nimi Adapted|interactive preview/i);
  assert.doesNotMatch(render({...item,web:null}),/Open in browser/);
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
  for (const locale of ['zh', 'en'] as const) {
    const html = renderRoute(`/platform?lang=${locale}`, '/platform', createElement(PlatformPage));
    for (const domain of ['runtime', 'cognition', 'realm']) {
      assert.ok(html.includes(`data-domain="${domain}"`), domain);
    }
    assert.match(html, /data-capability="text.generate" class="is-active" aria-pressed="true" aria-controls="platform-capability-sample"/);
    assert.match(html, /data-capability="text.embed" aria-pressed="false"/);
    assert.match(html, /data-sample="text.generate"/);
    assert.match(html, /The main object is a bright orange ceramic mug/);
    assert.match(html, /class="public-capability-route-counts">[\s\S]*?<strong>\d+<\/strong>[\s\S]*?<strong>\d+<\/strong>/);
    assert.match(html, /<details class="story-content-check">/);
    assert.ok(html.includes('id="content-check-demo-note"'));
    assert.ok(html.includes('<label for="security-draft">'));
    assert.ok(html.includes('aria-describedby="content-check-demo-note"'));
    assert.doesNotMatch(html, /world\.generate|agent\.autonomy|memory\.manage/);
    assert.doesNotMatch(html, /\b(OpenAI|Anthropic|Claude|Gemini|DeepSeek|Ollama)\b/i);
  }
});

test('all eleven Lab previews render a recorded observation and mark missing media', () => {
  const results = {
    'text.generate': 'bright orange ceramic mug',
    'text.embed': '0.7590',
    'image.generate': '1024 × 1024',
    'video.generate': '512 × 288',
    'vision.locate': '0.655',
    'realtime.interact': 'and the next train leaves at ten',
    'audio.synthesize': '5.68 s',
    'audio.transcribe': 'A green notebook is on the table. The next train leaves at ten.',
    'music.generate': '30.77 s',
    'voice.create': 'The next train leaves at 10.',
    'audio.separate': '2 / 4',
  } satisfies Record<CapabilityId, string>;

  for (const capability of Object.keys(results) as CapabilityId[]) {
    for (const locale of ['zh', 'en'] as const) {
      const html = renderToStaticMarkup(createElement(PlatformCapabilityPreview, { capability, locale }));
      assert.ok(html.includes(results[capability]), `${capability} (${locale})`);
    }
  }

  const speech = renderToStaticMarkup(createElement(PlatformCapabilityPreview, { capability: 'audio.synthesize', locale: 'zh' }));
  assert.match(speech, /<blockquote lang="zh">橙色的杯子放在窗边，下一班火车十点出发。/);
  assert.match(speech, /原始音频未收录/);
  assert.doesNotMatch(speech, /<audio\b/);
});

test('developers page renders the StoryBuilder and a command-first toolchain with separate repository references', () => {
  for (const locale of ['zh', 'en'] as const) {
    const html = renderRoute(`/developers?lang=${locale}`, '/developers', createElement(DevelopersPage));
    assert.ok(html.includes('id="developers"'));
    assert.ok(html.includes('Vercel AI'));
    assert.ok(html.includes('@nimiplatform/sdk'));
    assert.ok(html.includes('@nimiplatform/sdk-adapter-vercel-ai'));
    assert.ok(html.includes('@nimiplatform/kit'));
    assert.ok(html.includes('@nimiplatform/app-tools'));
    const toolchain = html.slice(html.indexOf('<section id="surfaces"'), html.indexOf('<aside class="public-info-card public-adaptation-cta"'));
    const commands = [...toolchain.matchAll(/<pre tabindex="0"><code>([^<]+)<\/code><\/pre>/gi)]
      .map(([, command]) => command?.replaceAll('&quot;', '"'));
    assert.deepEqual(commands, [
      CREATE_APP_COMMAND,
      'pnpm add @nimiplatform/sdk',
      'pnpm add @nimiplatform/sdk-adapter-vercel-ai @nimiplatform/sdk "ai@^7" "@ai-sdk/provider@^4"',
      'pnpm add @nimiplatform/kit @nimiplatform/sdk',
    ]);
    const references = toolchain.slice(toolchain.indexOf('<div class="public-toolchain-references">'));
    assert.match(toolchain, /<h3>Kit<\/h3>[^]*?<small>MIT<\/small>/);
    assert.match(references, /href="https:\/\/github\.com\/nimiplatform\/nimi\/tree\/main\/sdks"/);
    assert.match(references, /href="https:\/\/github\.com\/nimiplatform\/nimi\/tree\/main\/\.nimi\/spec"/);
    assert.doesNotMatch(references, /<code>/);
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
