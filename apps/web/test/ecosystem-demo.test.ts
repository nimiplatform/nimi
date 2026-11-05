import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadLandingContent } from '../src/landing/content/landing-content.js';
import { demoChapters, COURTYARD_PARTNER } from '../src/landing/content/demo-tour.js';
import { createDemoAgentClients } from '../src/landing/content/demo-agent-clients.js';
import { createDemoZhiyuAgentClient, createDemoZhiyuAgentCenterSession } from '../src/landing/components/demo-zhiyu-agent-center.js';
import { createChatAgentClient } from '../src/landing/components/demo-chat-agent-center.js';
import { DemoAppPreview } from '../src/landing/components/demo-app-preview.js';
import { HeroDemoSessionProvider } from '../src/landing/components/hero-demo-session.js';

test('ecosystem chapters use multiple actual App replicas with matching localized choices', async () => {
  for (const locale of ['zh', 'en'] as const) {
    const content = await loadLandingContent(locale);
    const variety = demoChapters.find(chapter => chapter.copy === 'create')!;
    assert.equal(variety.embeddedApps, true);
    assert.equal(new Set(variety.stops.map(stop => stop.preview?.appId)).size, 3);
    assert.equal(content.create.choices?.length, variety.stops.length);
    const continuity = demoChapters.find(chapter => chapter.copy === 'continuity')!;
    assert.equal(continuity.stops[0]?.preview?.appId, 'nimi.zhiyu');
    assert.equal(content.continuity.choices?.length, continuity.stops.length);
    assert.ok(content.continuity.intro.includes('Local Agent'));
  }
});

test('an embedded Zhiyu preview identifies the actual app and is not a Home chat or modal', async () => {
  const { hero: { demo } } = await loadLandingContent('zh');
  const html = renderToStaticMarkup(createElement(HeroDemoSessionProvider, { demo,
    children: createElement(DemoAppPreview, { inline: true, guiding: true,
      opened: { appId: 'nimi.zhiyu', screen: 'companion' }, apps: demo.apps, preview: demo.appPreview, onClose() {},
    }),
  }));
  assert.ok(html.includes('data-testid="demo-embedded-app"'));
  assert.ok(html.includes('data-demo-app-id="nimi.zhiyu"'));
  assert.ok(html.includes('织羽'));
  assert.ok(!html.includes('demo-home-frame'));
  assert.ok(!html.includes('role="dialog"'));
});

test('memory corrections and deletion follow the same agent between Zhiyu and Home', async () => {
  const { hero: { demo } } = await loadLandingContent('zh');
  const partner = demo.appPreview.zhiyu.partners.find(agent => agent.id === COURTYARD_PARTNER)!;
  const homeAgent = demo.chat.agents.find(agent => agent.id === COURTYARD_PARTNER)!;
  const clients = createDemoAgentClients();
  const zhiyu = createDemoZhiyuAgentCenterSession(clients.get(partner.id, () => createDemoZhiyuAgentClient(partner, demo.appPreview.zhiyu)));
  await zhiyu.session.refresh();
  const item = zhiyu.session.getSnapshot().state.cognition.memory?.items[0]!;
  assert.equal(item.content, partner.memories[0]?.content);
  await zhiyu.session.correctMemory({ memoryId: item.memoryId, correctedContent: '演示记忆：下次继续聊矿物颜料。' });
  zhiyu.session.dispose();
  const home = createDemoZhiyuAgentCenterSession(clients.get(homeAgent.id, () => createChatAgentClient(homeAgent, demo)));
  await home.session.refresh();
  assert.equal(home.session.getSnapshot().state.cognition.memory?.items[0]?.content, '演示记忆：下次继续聊矿物颜料。');
  await home.session.forgetMemory({ memoryIds: [item.memoryId], confirmed: true });
  home.session.dispose();
  const reopened = createDemoZhiyuAgentCenterSession(clients.get(partner.id, () => createDemoZhiyuAgentClient(partner, demo.appPreview.zhiyu)));
  await reopened.session.refresh();
  assert.equal(reopened.session.getSnapshot().state.cognition.memory?.items.length, 0);
  reopened.session.dispose();
  clients.clear();
  const fresh = createDemoZhiyuAgentCenterSession(clients.get(partner.id, () => createDemoZhiyuAgentClient(partner, demo.appPreview.zhiyu)));
  await fresh.session.refresh();
  assert.equal(fresh.session.getSnapshot().state.cognition.memory?.items[0]?.content, item.content);
  fresh.session.dispose();
});
