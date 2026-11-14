import { renderAppPreview } from './helpers/render-app-preview.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ReactNode } from 'react';
import { HeroDemoSessionProvider } from '../src/landing/components/hero-demo-session.js';
import type { HeroDemo, HeroDemoSurface } from '../src/landing/content/landing-content.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeroDemoView } from '../src/landing/components/hero-demo.js';
import { DemoAppsSurface } from '../src/landing/components/demo-apps.js';
import { DemoZhiyuPreview } from '../src/landing/components/demo-zhiyu-preview.js';
import { loadLandingContent } from '../src/landing/content/landing-content.js';

function renderDemo(
  demo: HeroDemo,
  surface: HeroDemoSurface = 'home',
  children: ReactNode = createElement(HeroDemoView),
) {
  return renderToStaticMarkup(
    createElement(HeroDemoSessionProvider, { demo, initialSurface: surface, children }),
  );
}

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
  assert.ok(!appsHtml.includes('data-testid="demo-app-preview"'));

  const zhiyu = demo.appPreview.zhiyu;
  const zhiyuHtml = renderAppPreview(createElement(HeroDemoSessionProvider, { demo, children: createElement(DemoZhiyuPreview, { content: zhiyu }) }));
  assert.ok(zhiyuHtml.includes('data-demo-zhiyu-root="true"'));
  assert.ok(zhiyuHtml.includes('class="zhiyu-agent-chat"'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-region="presence"'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-region="conversation"'));
  assert.ok(zhiyuHtml.includes('data-canonical-transcript-root'));
  assert.ok(zhiyuHtml.includes('data-canonical-composer-root'));
  assert.ok(zhiyuHtml.includes('先选择本地伙伴'));
  assert.ok(zhiyuHtml.includes(`aria-label="${zhiyu.copy.sendLabel}"`));
  assert.ok(zhiyuHtml.includes(`title="${zhiyu.copy.attachLabel}"`));
  assert.ok(zhiyuHtml.includes('data-zhiyu-composer-tool="avatar"'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-composer-tool="proactive"'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-composer-agent-center-state="closed"'));
  assert.ok(zhiyuHtml.includes(`aria-label="${zhiyu.copy.agentCenterLabel}"`));
  for (const partner of zhiyu.partners) {
    assert.ok(zhiyuHtml.includes(`aria-label="${zhiyu.copy.selectPartnerAriaPrefix}${partner.name}"`));
  }
  assert.ok(zhiyuHtml.includes('选择一位本地伙伴，开始对话'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-side-panel-state="closed"'));
  assert.ok(!zhiyuHtml.includes('data-zhiyu-region="agent-panel"'));
});
