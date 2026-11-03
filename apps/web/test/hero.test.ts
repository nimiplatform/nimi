import { renderAppPreview } from './helpers/render-app-preview.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ReactNode } from 'react';
import { HeroDemoSessionProvider } from '../src/landing/components/hero-demo-session.js';
import type { HeroDemo, HeroDemoSurface } from '../src/landing/content/landing-content.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeroSection } from '../src/landing/components/hero-section.js';
import { HeroDemoView } from '../src/landing/components/hero-demo.js';
import { AppsSection } from '../src/landing/components/apps-section.js';
import { DemoAppsSurface } from '../src/landing/components/demo-apps.js';
import { DemoZhiyuPreview } from '../src/landing/components/demo-zhiyu-preview.js';
import { loadLandingContent } from '../src/landing/content/landing-content.js';
import { resolveLandingLinks } from '../src/landing/config/landing-links.js';

function renderDemo(
  demo: HeroDemo,
  surface: HeroDemoSurface = 'home',
  children: ReactNode = createElement(HeroDemoView),
) {
  return renderToStaticMarkup(
    createElement(HeroDemoSessionProvider, { demo, initialSurface: surface, children }),
  );
}

test('hero renders the slogan with the demo preview on the same screen in both locales', async () => {
  const links = resolveLandingLinks();
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    const html = renderDemo(content.hero.demo, 'home', createElement(HeroSection, { content: content.hero, links }));
    assert.ok(!html.includes('HeroDemoView requires'));

    assert.ok(html.includes(`aria-label="${content.hero.slogan}"`));
    // Flat editorial headline: one dark ink, no per-character gradient.
    assert.ok(!html.includes('color:#38d6a3'));
    assert.ok(html.includes('text-ink'));

    // The sub-slogan renders line by line, followed by the lighter note.
    for (const line of content.hero.subSlogan.split('\n')) {
      assert.ok(html.includes(line));
    }
    assert.ok(html.includes(content.hero.subSloganNote));

    // One primary download CTA plus a quiet secondary link that opens the
    // docs folder on GitHub in a new tab.
    assert.ok(html.includes(`href="${links.downloadUrl}"`));
    assert.ok(html.includes(content.hero.downloadCta));
    assert.ok(html.includes(`href="${links.docsSourceUrl}" target="_blank" rel="noreferrer"`));
    assert.ok(html.includes(content.hero.docsCta));
    assert.ok(!html.includes('href="#apps"'));
    // Product presentation: the window uses the shared frame chrome with its
    // brand halo, and the two actions carry distinct weights.
    assert.ok(html.includes('hero-demo-frame'));
    assert.ok(html.includes('hero-glow'));
    assert.ok(html.includes('hero-cta-primary'));
    assert.ok(html.includes('hero-cta-secondary'));

    // Title and demo share the first screen: one hero section, no separate
    // demo section below it.
    assert.ok(html.includes('id="hero"'));
    assert.ok(!html.includes('id="demo"'));

    // The interactive demo loads as its own chunk: static markup carries the
    // size-stable fallback frame, and other surfaces stay hidden until selected.
    assert.ok(html.includes(content.hero.demo.home.greeting));
    assert.ok(!html.includes(content.hero.demo.home.settingsGroups[0]?.label ?? '__none__'));
  }
});

test('Home preview opens the current overview and keeps chat as a separate workspace', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const {
      hero: { demo },
    } = await loadLandingContent(locale);
    const html = renderDemo(demo);
    assert.ok(html.includes(demo.home.greeting));
    assert.ok(html.includes(demo.home.recent));
    assert.ok(html.includes(demo.home.myApps));
    assert.ok(html.includes(demo.home.messages));
    assert.ok(html.includes(demo.home.badge));
    assert.ok(html.includes(demo.home.runtimeOK));
    assert.ok(!html.includes('data-canonical-transcript-root'));
    for (const surface of ['home', 'cloud', 'integrations', 'downloads', 'messages'] as const) {
      assert.ok(html.includes(demo.nav[surface]));
    }
    const chat = renderDemo(demo, 'chat');
    assert.ok(chat.includes('data-canonical-transcript-root'));
    assert.ok(chat.includes(demo.chat.greeting));
    assert.ok(chat.includes(`placeholder="${demo.chat.inputPlaceholder}"`));
    assert.ok(chat.includes(`aria-label="${demo.chat.sendLabel}"`));
    for (const agent of demo.chat.agents) assert.ok(chat.includes(`aria-label="${agent.name}"`));
  }
});

test('hero and expanded windows render the same destination from their shared session', async () => {
  const {
    hero: { demo },
  } = await loadLandingContent('zh');
  for (const surface of ['home', 'chat', 'apps'] as const) {
    const html = renderDemo(demo, surface, [
      createElement(HeroDemoView, { key: 'hero' }),
      createElement(HeroDemoView, { key: 'expanded', expanded: true }),
    ]);
    const expected =
      surface === 'home' ? demo.home.greeting : surface === 'chat' ? demo.chat.greeting : '应用中心';
    assert.equal(html.split(expected).length - 1, 2);
    const absent = surface === 'home' ? demo.chat.greeting : demo.home.greeting;
    assert.ok(!html.includes(absent));
  }
});

test('apps section is a demo window under a centered section header', async () => {
  const content = await loadLandingContent('zh');
  const html = renderDemo(content.hero.demo, 'apps', createElement(AppsSection, { content: content.apps, demo: content.hero.demo }));

  assert.ok(html.includes('id="apps"'));
  // The morph target wrapper the hero window zooms into.
  assert.ok(html.includes('data-apps-morph'));
  // Section header above the window, then the Suspense fallback's static frame.
  assert.ok(html.includes('data-apps-copy'));
  assert.ok(html.includes(content.apps.title));
  assert.ok(html.includes(content.apps.subtitle));
  assert.ok(html.includes(content.hero.demo.chat.greeting));
});

test('apps surface renders the two-pane library and the zhiyu preview mounts kit chat components', async () => {
  const content = await loadLandingContent('zh');
  const demo = content.hero.demo;

  const appsHtml = renderToStaticMarkup(
    createElement(DemoAppsSurface, { apps: demo.apps, preview: demo.appPreview, onLaunch: () => {} }),
  );
  assert.ok(appsHtml.includes(demo.apps.searchPlaceholder));
  assert.ok(appsHtml.includes(`${demo.apps.items.length}${demo.apps.countSuffix}`));
  assert.ok(appsHtml.includes('织羽'));
  assert.ok(appsHtml.includes(demo.apps.launchLabel));
  // Row selection alone must not open the preview modal.
  assert.ok(!appsHtml.includes('data-testid="demo-app-preview"'));

  const zhiyu = demo.appPreview.zhiyu;
  const zhiyuHtml = renderAppPreview(createElement(HeroDemoSessionProvider, { demo, children: createElement(DemoZhiyuPreview, { content: zhiyu }) }));
  // The preview is the Zhiyu shell composition: same regions, class names,
  // and data attributes as apps/zhiyu's agent-chat surface, on kit surfaces.
  assert.ok(zhiyuHtml.includes('data-demo-zhiyu-root="true"'));
  assert.ok(zhiyuHtml.includes('class="zhiyu-agent-chat"'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-region="presence"'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-region="conversation"'));
  assert.ok(zhiyuHtml.includes('data-canonical-transcript-root'));
  assert.ok(zhiyuHtml.includes('data-canonical-composer-root'));
  assert.ok(zhiyuHtml.includes('先选择本地伙伴'));
  assert.ok(zhiyuHtml.includes(`aria-label="${zhiyu.copy.sendLabel}"`));
  assert.ok(zhiyuHtml.includes(`title="${zhiyu.copy.attachLabel}"`));
  // Composer tools mirror the app: avatar, proactive mode, and the Agent
  // Center toggle that opens the kit panel.
  assert.ok(zhiyuHtml.includes('data-zhiyu-composer-tool="avatar"'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-composer-tool="proactive"'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-composer-agent-center-state="closed"'));
  assert.ok(zhiyuHtml.includes(`aria-label="${zhiyu.copy.agentCenterLabel}"`));
  // The rail labels the current partner and the selectable ones the way the
  // app's presence rail does.
  for (const partner of zhiyu.partners) {
    assert.ok(zhiyuHtml.includes(`aria-label="${zhiyu.copy.selectPartnerAriaPrefix}${partner.name}"`));
  }
  // The current product starts with partner selection; selecting one opens its history.
  assert.ok(zhiyuHtml.includes('选择一位本地伙伴，开始对话'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-side-panel-state="closed"'));
  assert.ok(!zhiyuHtml.includes('data-zhiyu-region="agent-panel"'));
});
