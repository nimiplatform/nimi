import { PublicProduct } from '../src/pages/hosted-directory.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HOME_PAGE_INITIAL_DEMO, projectDirectoryApps, resolveAppsDetailDecision, StaticPage } from '../src/pages/static-page.js';
import { HeroDemoSessionProvider } from '../src/landing/components/hero-demo-session.js';
import { HeroDemoView } from '../src/landing/components/hero-demo.js';
import { createCoreHeroDemo } from '../src/landing/content/core-hero-demo.js';
import { getEcosystemApps, INITIAL_VISIBLE_APP_COUNT } from '../src/pages/app-ecosystem-data.js';
import { PlatformPage } from '../src/pages/platform-page.js';
import { PlatformCapabilityPreview } from '../src/pages/platform-capability-preview.js';
import {
  getCapabilityRouteDetails,
  PlatformCapabilityRouteCounts,
} from '../src/pages/platform-capability-routes.js';
import type { CapabilityId } from '../src/pages/platform-capability-samples.js';
import { DevelopersPage } from '../src/pages/developers-page.js';
import { DownloadPageView, PUBLIC_PAGE_CONTENT } from '../src/pages/release-pages.js';
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

  const utopiaHtml = renderRoute('/apps/utopia?lang=zh', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(utopiaHtml, /NimiUtopia/);
  assert.match(utopiaHtml, /交互预览 · 开发者预览/);
  assert.match(utopiaHtml, /MIT/);
  assert.match(utopiaHtml, /github\.com\/nimiplatform\/nimi/);
  assert.doesNotMatch(utopiaHtml, /立即安装/i);

  const sillyTavern = renderRoute('/apps/sillytavern?lang=en', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(sillyTavern, /In Desktop Catalog/);
  assert.match(sillyTavern, /github\.com\/nimiplatform\/SillyTavern/);
  assert.match(sillyTavern, /<dd>macOS arm64 · Windows x86_64<\/dd>/);

  const openWhispr = renderRoute('/apps/openwhispr?lang=en', '/apps/:slug', createElement(StaticPage, { kind: 'apps' }));
  assert.match(openWhispr, /In Desktop Catalog/);
  assert.match(openWhispr, /<dd>Windows x86_64<\/dd>/);
});

test('home page exposes the worlds anchor and download link without release disclaimer copy', () => {
  const html = renderRoute('/home', '/home', createElement(StaticPage, { kind: 'home' }));
  assert.match(html, /id="worlds"/);
  assert.match(html, /Beta/);
  assert.doesNotMatch(html, /no Stable release|尚无 Stable 正式版/);
  assert.doesNotMatch(html, /development installation|开发实例/);
  assert.match(html, /href="\/download\?lang=(en|zh)"/);
});

test('home page demo defaults to the My companions view in both locales', () => {
  assert.deepEqual(HOME_PAGE_INITIAL_DEMO, { surface: 'explore', target: 'partners' });

  for (const locale of ['zh', 'en'] as const) {
    const demo = createCoreHeroDemo(locale);
    const html = renderToStaticMarkup(
      createElement(HeroDemoSessionProvider, {
        demo,
        initialSurface: HOME_PAGE_INITIAL_DEMO.surface,
        initialTarget: HOME_PAGE_INITIAL_DEMO.target,
        children: createElement(HeroDemoView, { expanded: true }),
      }),
    );
    const partnersTabLabel = locale === 'zh' ? '我的伙伴' : 'My companions';
    assert.ok(html.includes('demo-explore-partner-directory'), locale);
    assert.ok(!html.includes('demo-world-atlas'), locale);
    assert.match(
      html,
      new RegExp(`<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>[\\s\\S]*?${partnersTabLabel}</button>`),
    );
  }
});

test('home page renders StoryWorlds gallery and LocalAgent architecture in both locales without Han leakage in English', () => {
  for (const locale of ['zh', 'en'] as const) {
    const html = renderRoute(`/home?lang=${locale}`, '/home', createElement(StaticPage, { kind: 'home' }));
    const worlds = html.match(/<section[^>]*class="story-section story-worlds"[\s\S]*?<\/section>/)?.[0];
    assert.ok(worlds);
    assert.ok(worlds.includes(locale === 'zh' ? '瓷炭院' : 'Emberware Court'));
    assert.ok(worlds.includes('story-world-print'));
    assert.equal(worlds.match(/story-app-showcase-arrow story-app-showcase-arrow--(?:previous|next)/g)?.length, 2);
    assert.ok(!worlds.includes('story-gallery-controls'));

    const localAgent = html.match(/<section id="local-agent"[\s\S]*?<\/section>/)?.[0];
    assert.ok(localAgent);
    for (const mechanism of ['utopia', 'memory', 'continuity'] as const) {
      assert.ok(localAgent.includes(`data-agent-mechanism="${mechanism}"`), mechanism);
    }
    assert.ok(localAgent.includes('Utopia'));
    assert.doesNotMatch(localAgent, /agentHandle|Machine Loadout|Atomic Job Capture/);

    if (locale === 'en') {
      assert.doesNotMatch(worlds, /\p{Script=Han}/u);
      assert.doesNotMatch(localAgent, /\p{Script=Han}/u);
      assert.doesNotMatch(html, /\p{Script=Han}/u);
    }
  }
});

test('apps page orders integrations before a collapsible featured catalog across 24 curated entries and renders scoped StoryIntegrations', () => {
  for (const locale of ['zh', 'en'] as const) {
    const ecosystemApps = getEcosystemApps(locale);
    assert.equal(ecosystemApps.length, 24);
    assert.equal(ecosystemApps.filter((app) => app.origin === 'nimi-official').length, 11);
    assert.equal(ecosystemApps.filter((app) => app.origin === 'open-source-adapted').length, 13);
    assert.equal(ecosystemApps.filter((app) => app.posture === 'catalog-admitted').length, 22);
    assert.equal(
      ecosystemApps.filter((app) => app.catalog?.platforms.length === 1 && app.catalog.platforms[0] === 'Windows x86_64').length,
      6,
    );
    assert.equal(ecosystemApps.filter((app) => app.posture === 'interactive-preview').length, 1);
    assert.equal(ecosystemApps.find((app) => app.id === 'nimi.utopia')?.posture, 'interactive-preview');

    const html = renderRoute(`/apps?lang=${locale}`, '/apps', createElement(StaticPage, { kind: 'apps' }));
    const copy = getStoryCopy(locale);
    const localizedLinks = resolveLocalizedLinks(resolveLandingLinks({}), locale);
    const stageIdx = html.indexOf('class="public-apps-foundation-stage"');
    const integrationsIdx = html.indexOf('<section id="integrations"');
    const catalogIdx = html.indexOf('id="apps-catalog"');
    const createIdx = html.indexOf('id="create-your-own"');
    assert.ok(stageIdx > -1 && integrationsIdx > stageIdx, 'StoryIntegrations appears after hero foundation stage');
    assert.ok(catalogIdx > integrationsIdx, '#apps-catalog appears after StoryIntegrations');
    assert.ok(createIdx > catalogIdx, '#create-your-own closes the page after #apps-catalog');
    assert.doesNotMatch(html, /public-apps-hero-showcase|public-apps-compare-section|public-compare-foundation-bar/);
    assert.ok(html.includes('data-mode="shared"'));
    if (locale === 'en') {
      assert.doesNotMatch(html, /\p{Script=Han}/u);
    }

    const officialCards = html.match(/<li class="public-app-card" data-origin="nimi-official" data-posture="[^"]+">/g) ?? [];
    const adaptedCards = html.match(/<li class="public-app-card" data-origin="open-source-adapted" data-posture="[^"]+">/g) ?? [];
    const filterButtons = html.match(/class="public-filter-pills"[\s\S]*?<\/div>/)?.[0].match(/<button\b/g) ?? [];
    assert.equal(officialCards.length, 3);
    assert.equal(adaptedCards.length, 3);
    assert.equal(officialCards.length + adaptedCards.length, INITIAL_VISIBLE_APP_COUNT);
    assert.equal(filterButtons.length, 3);
    assert.ok(html.includes('data-collapsed="true"'));
    assert.ok(html.includes('class="public-apps-expand-btn"'));
    assert.ok(html.includes('class="public-apps-expand-icons"'));
    assert.doesNotMatch(html, /public-apps-expand-status|public-apps-expand-count|public-apps-expand-divider/);
    assert.ok(html.includes('class="public-apps-notes-disclosure"'));
    assert.ok(html.includes('type="search"'));
    assert.doesNotMatch(html, /public-app-card-play|public-app-card-origin/);
    assert.match(html, /data-posture="interactive-preview"/);
    assert.match(html, /NimiUtopia/);
    assert.match(html, /Vane/);
    assert.match(html, /OpenMontage/);

    const integrations = html.match(/<section id="integrations"[\s\S]*?<\/section>/)?.[0];
    assert.ok(integrations);
    const integrationHeading = integrations.match(/<h2 id="integrations-heading">(.*?)<\/h2>/)?.[1];
    assert.equal(integrationHeading?.replaceAll(/<\/?span>/g, ''), copy['integrations.title']);
    const cards = integrations.match(/<article\b[^>]*>[\s\S]*?<\/article>/g) ?? [];
    assert.equal(cards.length, 3);
    const [scopes, sources, messaging] = cards;
    assert.ok(scopes && sources && messaging);
    assert.ok(scopes.includes(copy['integrations.app']));
    assert.ok(scopes.includes('story-integration-perm-badges'));
    assert.ok(scopes.includes('Vane') && scopes.includes('ParentOS'));
    assert.doesNotMatch(integrations, /NimiGo|NimiDay/);
    assert.ok(sources.includes(copy['integrations.mcp']) && sources.includes('Microsoft Learn'));
    assert.ok(sources.includes('story-integration-source-picker'));
    assert.ok(messaging.includes(copy['integrations.wechat']) && messaging.includes(copy['integrations.feishu']));
    assert.ok(messaging.includes(copy['integrations.connected']) && messaging.includes(copy['integrations.connect']));
    assert.doesNotMatch(integrations, /<(?:button|input|select)\b/);
    assert.ok(integrations.includes(`href="${localizedLinks.integrationsUrl}"`));
    if (locale === 'en') {
      assert.doesNotMatch(integrations, /\p{Script=Han}/u);
      assert.doesNotMatch(html, /\p{Script=Han}/u);
    }
  }
});

test('platform page renders three-domain boundaries, visual architecture map, selected capability routes, and sovereign ledger without content-check form or vendor claims', () => {
  for (const locale of ['zh', 'en'] as const) {
    const html = renderRoute(`/platform?lang=${locale}`, '/platform', createElement(PlatformPage));
    assert.ok(html.includes('class="public-arch-diagram platform-blueprint-stage"'));
    assert.ok(html.includes('class="platform-stack-schematic"'));
    assert.ok(html.includes('class="platform-legacy-schematic"'));
    assert.ok(html.includes('class="platform-scrolly-inversion is-full-cinema"'));
    assert.ok(html.includes('class="platform-capability-atlas platform-sensory-console"'));
    assert.ok(html.includes('class="platform-domain-sim-panel platform-mind-workbench"'));
    for (const pillar of ['context', 'projection', 'memory', 'delegation', 'utopia']) {
      assert.ok(html.includes(`data-mind-pillar="${pillar}"`), pillar);
    }
    assert.ok(html.includes('class="platform-projection-hub"'));
    assert.ok(html.includes('class="platform-trust-ledger platform-sovereign-console"'));
    assert.ok(html.includes('class="public-domain-grid platform-horizon-grid"'));
    for (const domain of ['runtime', 'cognition', 'realm']) {
      assert.ok(html.includes(`data-domain="${domain}"`), domain);
    }
    assert.ok(html.includes('class="platform-integration-broker-stage"'));
    for (const channel of ['weixin', 'qq', 'telegram', 'feishu', 'onebot', 'mcp', 'nimi-app']) {
      assert.ok(html.includes(`data-integration="${channel}"`), channel);
    }
    const renderedCapButtons = [...html.matchAll(/data-capability="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(renderedCapButtons.length, 20, 'all 20 standard AI capabilities render together in the panoramic atlas');
    assert.match(html, /data-capability="text.generate" class="is-active" aria-pressed="true" aria-controls="platform-capability-sample"/);
    assert.match(html, /data-capability="text.embed" aria-pressed="false"/);
    assert.match(html, /data-capability="music.transcribe" aria-pressed="false"/);
    assert.match(html, /data-capability="video.upscale" aria-pressed="false"/);
    assert.match(html, /data-sample="text.generate"/);
    assert.match(html, /The main object is a bright orange ceramic mug/);
    assert.match(html, /class="public-capability-route-counts">[\s\S]*?<strong>\d+<\/strong>[\s\S]*?<strong>\d+<\/strong>/);
    assert.ok(html.includes(locale === 'zh' ? '本地模型' : 'Local models'));
    assert.ok(html.includes(locale === 'zh' ? '云端服务' : 'Cloud services'));
    assert.doesNotMatch(html, /story-content-check|content-check-demo-note|security-draft/);
    assert.doesNotMatch(html, /CapabilityContract|Machine Loadout|Atomic Job Capture/);
    assert.doesNotMatch(html, /world\.generate|agent\.autonomy|memory\.manage/);
    assert.doesNotMatch(html, /\b(OpenAI|Anthropic|Claude|Gemini|DeepSeek|Ollama)\b/i);
    if (locale === 'en') {
      assert.doesNotMatch(html, /\p{Script=Han}/u);
    }
  }
});

test('all twenty capability previews render rich interactive stages, valid media assets, and observations', () => {
  const results = {
    'text.generate': 'bright orange ceramic mug',
    'text.embed': '0.7590',
    'text.decide': '74.2%',
    'text.annotate': '64 docs',
    'image.generate': '1024 × 1024',
    'image.upscale': '4096 × 4096',
    'image.face_swap': 'PNG',
    'video.generate': '512 × 288',
    'video.upscale': '300 frames',
    'video.face_swap': '1280 × 720 RGB8',
    'vision.locate': '0.655',
    'realtime.interact': 'TTFB 190 ms',
    'audio.synthesize': '5.68 s',
    'audio.transcribe': '00:04.1',
    'voice.create': 'The next train leaves at 10.',
    'audio.speaker.embed': 'space_id',
    'audio.separate': '2 / 4',
    'audio.voice.convert': '600 s',
    'music.generate': '30.77 s',
    'music.transcribe': 'MIDI',
  } satisfies Record<CapabilityId, string>;

  const publicRoot = path.resolve(import.meta.dirname, '..', 'public');

  for (const capability of Object.keys(results) as CapabilityId[]) {
    for (const locale of ['zh', 'en'] as const) {
      const html = renderToStaticMarkup(createElement(PlatformCapabilityPreview, { capability, locale }));
      assert.ok(html.includes(results[capability]), `${capability} (${locale})`);
      assert.ok(html.includes('platform-lab-hero-stage'), `Rich stage missing for ${capability}`);
      assert.doesNotMatch(
        html,
        /原图未收录|原始视频未收录|原始音频未收录|Original image unavailable|Original video unavailable|Original audio unavailable/,
      );
      if (locale === 'en' && capability !== 'audio.synthesize') {
        assert.doesNotMatch(html, /\p{Script=Han}/u, `Unexpected Han character in English preview for ${capability}`);
      }
      for (const match of html.matchAll(/(?:src|poster)="(\/(?:platform\/capabilities|demo)\/[^"]+)"/g)) {
        const assetPath = match[1];
        assert.ok(assetPath && fs.existsSync(path.join(publicRoot, assetPath)), `Missing asset on disk: ${assetPath ?? ''}`);
      }
    }
  }

  const speech = renderToStaticMarkup(createElement(PlatformCapabilityPreview, { capability: 'audio.synthesize', locale: 'zh' }));
  assert.match(speech, /<blockquote lang="zh">橙色的杯子放在窗边，下一班火车十点出发。/);
  assert.doesNotMatch(speech, /<audio\b/);

  const transcribeZh = renderToStaticMarkup(createElement(PlatformCapabilityPreview, { capability: 'audio.transcribe', locale: 'zh' }));
  assert.ok(transcribeZh.includes('新厦门，今晚九点后东北风转强，'));
  assert.ok(transcribeZh.includes('四十七层的阳台会有六级阵风。'));
  assert.ok(transcribeZh.includes('番茄，记得收进来。'));
  assert.ok(transcribeZh.includes('00:10.1'));

  const realtimeZh = renderToStaticMarkup(createElement(PlatformCapabilityPreview, { capability: 'realtime.interact', locale: 'zh' }));
  assert.ok(realtimeZh.includes('借光，劳驾往旁边侧半步，别挡了照在方凳上的天光。'));
  assert.doesNotMatch(realtimeZh, /green notebook|ten o’clock train/i);

  const realtimeEn = renderToStaticMarkup(createElement(PlatformCapabilityPreview, { capability: 'realtime.interact', locale: 'en' }));
  assert.ok(realtimeEn.includes('step half a pace aside'));
  assert.doesNotMatch(realtimeEn, /\p{Script=Han}/u);

  // Verify every Phase 2 audio file referenced by interactive handlers exists on disk
  for (const audioFile of [
    '/demo/explore/heguan-voice.mp3',
    '/demo/zhiyu/chao-voice.mp3',
    '/platform/capabilities/separate-vocals.mp3',
    '/platform/capabilities/separate-drums.mp3',
    '/platform/capabilities/separate-bass.mp3',
    '/platform/capabilities/separate-backing.mp3',
    '/platform/capabilities/music-generate-cue.mp3',
    '/platform/capabilities/music-transcribe-piano.mp3',
    '/platform/capabilities/music-transcribe-midi.mp3',
    '/platform/capabilities/voice-convert-orig.mp3',
    '/platform/capabilities/voice-convert-0st.mp3',
    '/platform/capabilities/voice-convert-up2.mp3',
    '/platform/capabilities/voice-convert-dn2.mp3',
    '/platform/capabilities/voice-create-ref.mp3',
    '/platform/capabilities/voice-create-cloned.mp3',
  ]) {
    assert.ok(fs.existsSync(path.join(publicRoot, audioFile)), `Missing audio asset: ${audioFile}`);
  }
});

test('developers page renders two integration tracks, StoryBuilder, and a command-first toolchain with separate repository references', () => {
  for (const locale of ['zh', 'en'] as const) {
    const html = renderRoute(`/developers?lang=${locale}`, '/developers', createElement(DevelopersPage));
    assert.ok(html.includes('id="tracks"'));
    assert.ok(html.includes('data-track="compute"'));
    assert.ok(html.includes('data-track="agent"'));
    assert.ok(html.includes('nimi.app.yaml'));
    assert.ok(html.includes('NIMI_APP.md'));
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
    const adaptationBanner = html.slice(
      html.indexOf('<aside class="public-info-card public-adaptation-cta">'),
      html.indexOf('</aside>', html.indexOf('<aside class="public-info-card public-adaptation-cta">')),
    );
    assert.match(adaptationBanner, new RegExp(`href="/apps\\?lang=${locale}#apps-catalog"`));
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

test('capability route counts expose local model counts and hover popovers for local models and cloud services', () => {
  const visionLocate = getCapabilityRouteDetails('vision.locate');
  assert.equal(visionLocate.localModels.length, 3);
  assert.deepEqual(
    visionLocate.localModels.map((model) => model.label),
    ['LocateAnything 3B', 'Grounding DINO Tiny', 'Grounding DINO Base'],
  );
  assert.equal(visionLocate.cloudServices.length, 0);

  const textGenerate = getCapabilityRouteDetails('text.generate');
  assert.ok(textGenerate.localModels.length >= 6);
  assert.ok(textGenerate.cloudServices.length >= 20);
  assert.ok(textGenerate.cloudServices.some((service) => service.label === 'OpenAI'));

  const textDecide = getCapabilityRouteDetails('text.decide');
  assert.equal(textDecide.localModels.length, 3);
  assert.deepEqual(textDecide.cloudServices.map((service) => service.label), ['TypeSafe']);

  const realtime = getCapabilityRouteDetails('realtime.interact');
  assert.equal(realtime.localModels.length, 0);
  assert.ok(realtime.cloudServices.length >= 4);

  for (const locale of ['zh', 'en'] as const) {
    const localPopover = renderToStaticMarkup(
      createElement(PlatformCapabilityRouteCounts, { capability: 'vision.locate', locale, initialOpen: 'local' }),
    );
    assert.ok(localPopover.includes('LocateAnything 3B'));
    assert.ok(localPopover.includes('Grounding DINO Tiny'));
    assert.ok(localPopover.includes('Grounding DINO Base'));
    assert.ok(localPopover.includes(locale === 'zh' ? '可用本地模型' : 'Available local models'));

    const remoteEmptyPopover = renderToStaticMarkup(
      createElement(PlatformCapabilityRouteCounts, { capability: 'vision.locate', locale, initialOpen: 'remote' }),
    );
    assert.ok(remoteEmptyPopover.includes(locale === 'zh' ? '可用云端服务' : 'Available cloud services'));
    assert.ok(remoteEmptyPopover.includes('public-capability-route-popover-empty'));

    const remoteListPopover = renderToStaticMarkup(
      createElement(PlatformCapabilityRouteCounts, { capability: 'text.generate', locale, initialOpen: 'remote' }),
    );
    assert.ok(remoteListPopover.includes('OpenAI'));
    assert.ok(remoteListPopover.includes('DeepSeek'));

    if (locale === 'en') {
      assert.doesNotMatch(localPopover, /\p{Script=Han}/u);
      assert.doesNotMatch(remoteEmptyPopover, /\p{Script=Han}/u);
      assert.doesNotMatch(remoteListPopover, /\p{Script=Han}/u);
    }
  }
});

test('public landing page hero headings omit trailing periods and match overview display scale', () => {
  for (const locale of ['zh', 'en'] as const) {
    const overviewTitle = getStoryCopy(locale)['hero.title'];
    assert.doesNotMatch(overviewTitle, /[。.]$/u, `overview hero.title (${locale})`);

    const renderedPages = [
      ['home', renderRoute(`/home?lang=${locale}`, '/home', createElement(StaticPage, { kind: 'home' }))],
      ['apps', renderRoute(`/apps?lang=${locale}`, '/apps', createElement(StaticPage, { kind: 'apps' }))],
      ['platform', renderRoute(`/platform?lang=${locale}`, '/platform', createElement(PlatformPage))],
      ['developers', renderRoute(`/developers?lang=${locale}`, '/developers', createElement(DevelopersPage))],
      ['download', renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(DownloadPageView, { locale, onLocaleChange: () => {} })))],
    ] as const;

    for (const [name, html] of renderedPages) {
      const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
      assert.ok(h1.length > 0, `${name} renders an h1 (${locale})`);
      assert.doesNotMatch(h1, /[。.]$/u, `${name} hero h1 has no trailing period (${locale}): ${h1}`);
    }

    assert.doesNotMatch(PUBLIC_PAGE_CONTENT[locale].policy.title, /[。.]$/u, `code-signing title (${locale})`);
  }

  const storyCss = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'landing', 'story.css'), 'utf8');
  const siteCss = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'site.css'), 'utf8');
  assert.match(storyCss, /\.story-site \.story-hero-copy h1\s*\{[^}]*font-size:\s*clamp\(38px,\s*4\.4vw,\s*60px\)/);
  assert.match(siteCss, /\.public-site-shell \.public-hero-header h1,\s*\.story-site\.release-page-shell \.download-hero-copy h1,\s*\.story-site\.release-page-shell \.release-hero h1\s*\{[^}]*font-size:\s*clamp\(38px,\s*4\.4vw,\s*60px\)/);
  assert.doesNotMatch(siteCss, /\.public-platform-page \.public-platform-vision-header h1\s*\{[^}]*font-size:/);
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

test('PublicProduct renders Storefront media, highlights, platform sizes, and blocked suspension states', () => {
  const published = {
    app_id: 'nimi.shijing',
    slug: 'shijing',
    display_name: 'ShiJing',
    publisher: 'nimiplatform',
    repository: 'https://github.com/nimiplatform/nimiapp-shijing',
    license: 'MIT',
    summary: { zh: '时镜中文摘要', en: 'ShiJing English summary' },
    origin: 'nimi-official' as const,
    upstream: null,
    pc_targets: ['windows-x86_64', 'macos-aarch64'],
    pc_target_releases: {
      'windows-x86_64': { version: '0.2.0', size: 18_874_368 },
      'macos-aarch64': { version: '0.1.9', size: 15_728_640 },
    },
    displayed_version: '0.2.0',
    capabilities: ['text.generate'],
    blocked: false,
    web: { url: 'https://shijing.nimi.xyz/', version: '0.2.0' },
    has_storefront: true,
    category: 'lifestyle',
    default_locale: 'zh',
    tags: { zh: ['命理', '本地隐私'], en: ['Bazi', 'Local-First'] },
    icon_url: `/.well-known/nimi-apps/media/nimi.shijing/${'1'.repeat(64)}.png`,
    cover_urls: {
      default: `/.well-known/nimi-apps/media/nimi.shijing/${'a'.repeat(64)}.webp`,
      locales: { en: `/.well-known/nimi-apps/media/nimi.shijing/${'b'.repeat(64)}.webp` },
    },
    detail_status: 'published' as const,
    detail: {
      version: '0.2.0',
      display_name: '时镜',
      summary: '时镜中文摘要',
      readme_markdown: '# 时镜\n\n通过本地 AI 运行时进行多镜头推演。',
      release_notes_markdown: '新增 Storefront 展示资源。',
      license: { identifier: 'MIT', text: '' },
      author: 'Nimi Team',
      homepage_url: 'https://nimi.ai',
      support_url: 'https://github.com/nimiplatform/nimiapp-shijing/issues',
      app_access: ['text.generate'],
      capability_contract_refs: ['text.generate'],
      required_standardized_feature_refs: [],
      storage_policy: { kind: 'nimi-mediated-default' },
      safety_profile: null,
      admission_trust_tier: 'reviewed',
      icon_url: `/.well-known/nimi-apps/media/nimi.shijing/${'1'.repeat(64)}.png`,
      storefront: {
        category: 'lifestyle',
        default_locale: 'zh',
        locales: {
          zh: {
            tags: ['命理', '本地隐私'],
            highlights: [{ title: '六镜视角', description: '从日镜到年镜多维观察节奏。' }],
          },
          en: {
            display_name: 'ShiJing',
            summary: 'ShiJing English summary',
            tags: ['Bazi', 'Local-First'],
            highlights: [{ title: 'Six Lenses', description: 'Inspect daily to yearly rhythms locally.' }],
            introduction_markdown: '# ShiJing\n\nLocal-first temporal reflection powered by Nimi.',
          },
        },
        media: {
          cover: {
            default: {
              media_type: 'image/webp',
              width: 1280,
              height: 720,
              size: 10000,
              sha256: 'a'.repeat(64),
              url: `/.well-known/nimi-apps/media/nimi.shijing/${'a'.repeat(64)}.webp`,
            },
            locales: {
              en: {
                media_type: 'image/webp',
                width: 1280,
                height: 720,
                size: 10000,
                sha256: 'b'.repeat(64),
                url: `/.well-known/nimi-apps/media/nimi.shijing/${'b'.repeat(64)}.webp`,
              },
            },
          },
          gallery: [
            {
              id: 'overview',
              kind: 'image',
              default: {
                media_type: 'image/webp',
                width: 1280,
                height: 720,
                size: 12000,
                sha256: 'c'.repeat(64),
                url: `/.well-known/nimi-apps/media/nimi.shijing/${'c'.repeat(64)}.webp`,
              },
              caption: { zh: '日镜主视图', en: 'Daily Lens view' },
            },
          ],
        },
      },
    },
  };

  const enHtml = renderRoute('/apps/shijing?lang=en', '/apps/:slug', createElement(PublicProduct, { item: published, locale: 'en', detail: true }));
  assert.match(enHtml, /data-testid="web-storefront-gallery"/);
  assert.match(enHtml, /Six Lenses/);
  assert.match(enHtml, /Daily Lens view/);
  assert.match(enHtml, /18\.0 MB/);
  assert.match(enHtml, /15\.0 MB/);
  assert.match(enHtml, /Local-first temporal reflection powered by Nimi/);
  assert.match(enHtml, /https:\/\/shijing\.nimi\.xyz\//);

  const blockedHtml = renderRoute(
    '/apps/shijing?lang=en',
    '/apps/:slug',
    createElement(PublicProduct, { item: { ...published, blocked: true, detail_status: 'blocked', web: null, detail: null }, locale: 'en', detail: true }),
  );
  assert.match(blockedHtml, /data-testid="web-product-blocked"/);
  assert.match(blockedHtml, /Distribution suspended/);
  assert.doesNotMatch(blockedHtml, /web-storefront-gallery/);
  assert.doesNotMatch(blockedHtml, /Open in browser/);
});

test('apps directory routing and list projection unify live states while preserving special non-native identities', () => {
  const appsEn = getEcosystemApps('en');
  const shijingEditorial = appsEn.find((a) => a.id === 'nimi.shijing')!;
  const zhiyuEditorial = appsEn.find((a) => a.id === 'nimi.zhiyu')!;
  const utopiaEditorial = appsEn.find((a) => a.id === 'nimi.utopia')!;

  const legacyPublished = {
    app_id: 'nimi.shijing',
    slug: 'shijing',
    display_name: '时镜',
    publisher: 'nimiplatform',
    repository: 'https://github.com/nimiplatform/nimiapp-shijing',
    license: 'MIT',
    summary: { zh: '新版直播摘要', en: 'Live updated summary token-xyz' },
    origin: 'nimi-official' as const,
    pc_targets: ['windows-x86_64'],
    capabilities: ['text.generate'],
    blocked: false,
    web: null,
    displayed_version: '0.1.10',
    has_storefront: false,
    tags: { en: ['live-tag-abc'], zh: ['实时标签'] },
    detail_status: 'published' as const,
    detail: null,
  };

  // Ordinary catalog app: published (even without storefront), pending, blocked, and live 404 all follow live catalog truth.
  assert.equal(
    resolveAppsDetailDecision({ slug: 'shijing', directoryStatus: 'ok', liveProduct: legacyPublished, selectedEcosystemEntry: shijingEditorial }),
    'live-detail',
  );
  assert.equal(
    resolveAppsDetailDecision({ slug: 'shijing', directoryStatus: 'ok', liveProduct: { ...legacyPublished, detail_status: 'pending' }, selectedEcosystemEntry: shijingEditorial }),
    'live-detail',
  );
  assert.equal(
    resolveAppsDetailDecision({ slug: 'shijing', directoryStatus: 'missing', liveProduct: undefined, selectedEcosystemEntry: shijingEditorial }),
    'not-found',
  );
  assert.equal(
    resolveAppsDetailDecision({ slug: 'shijing', directoryStatus: 'unavailable', liveProduct: undefined, selectedEcosystemEntry: shijingEditorial }),
    'status-placeholder',
  );
  // Special identities (zhiyu first-party-companion, utopia interactive-preview) never turn into 404 or hide on missing/unavailable catalog rows.
  assert.equal(
    resolveAppsDetailDecision({ slug: 'zhiyu', directoryStatus: 'missing', liveProduct: undefined, selectedEcosystemEntry: zhiyuEditorial }),
    'editorial',
  );
  assert.equal(
    resolveAppsDetailDecision({ slug: 'zhiyu', directoryStatus: 'unavailable', liveProduct: undefined, selectedEcosystemEntry: zhiyuEditorial }),
    'editorial',
  );
  assert.equal(
    resolveAppsDetailDecision({ slug: 'utopia', directoryStatus: 'missing', liveProduct: undefined, selectedEcosystemEntry: utopiaEditorial }),
    'editorial',
  );

  // Unified list projection merges live summary/tags for search/filter, respects community origin, avoids stale cover/tags when storefront is present, and omits hidden apps.
  const projected = projectDirectoryApps(appsEn, [legacyPublished], true, false, 'en');
  assert.equal(projected.mergedApps.some((a) => a.id === 'nimi.shijing'), true);
  assert.equal(projected.mergedApps.some((a) => a.id === 'nimi.zhiyu'), true);
  assert.equal(projected.mergedApps.some((a) => a.id === 'nimi.utopia'), true);
  assert.equal(projected.mergedApps.some((a) => a.id === 'nimi.openmontage'), false);
  const projectedShijing = projected.mergedApps.find((a) => a.id === 'nimi.shijing')!;
  assert.equal(projectedShijing.description, 'Live updated summary token-xyz');
  assert.deepEqual(projectedShijing.tags, ['live-tag-abc']);

  const communityStorefrontWithoutMedia = projectDirectoryApps(
    appsEn,
    [{ ...legacyPublished, origin: 'community' as const, has_storefront: true, tags: {}, cover_urls: null }],
    true,
    false,
    'en',
  );
  const communityEntry = communityStorefrontWithoutMedia.mergedApps.find((a) => a.id === 'nimi.shijing')!;
  assert.equal(communityEntry.origin, 'community');
  assert.deepEqual(communityEntry.tags, []);
  assert.equal(communityEntry.previewImageSrc, '');

  // Pure-PC product detail shows explicit Nimi Home install guidance when web is absent.
  const pcOnlyHtml = renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(PublicProduct, { item: legacyPublished, locale: 'en', detail: true })),
  );
  assert.match(pcOnlyHtml, /web-pc-install-guidance/);
  assert.match(pcOnlyHtml, /Open Nimi Home on your computer/);
});
