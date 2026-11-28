import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.png') || specifier.endsWith('.css')) {
      const asset = new URL(specifier, context.parentURL).href;
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(`export default ${JSON.stringify(asset)};`)}`,
      };
    }
    return nextResolve(specifier, context);
  },
});

const appRoot = path.resolve(import.meta.dirname, '..');

test('Zhiyu gates zero-partner composer tools and distinguishes no-partner from owner-unavailable in RightAgentPanel', async (t) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  const { createRoot } = await import('react-dom/client');
  const { NimiMotionProvider } = await import('@nimiplatform/kit/ui/motion');
  const { ZhiyuCanonicalApp } = await import('../src/shell/app/App.tsx');
  const { ZhiyuNavigationOwner, useZhiyuNavigationOwner } = await import('../src/shell/app/navigation.tsx');
  const { createInitialZhiyuEvidence } = await import('../src/shell/app/evidence.ts');
  const { RightAgentPanel } = await import('../src/shell/agent-chat/ZhiyuAgentRightPanel.tsx');

  const settle = async (predicate) => {
    for (let i = 0; i < 60 && !predicate(); i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
    assert.ok(predicate(), 'expected UI state did not settle');
  };

  const mountApp = async ({ localAgents = [], inventoryReady = true } = {}) => {
    const initial = createInitialZhiyuEvidence();
    const inventory = {
      ...initial.inventory,
      ready: inventoryReady,
      count: localAgents.length,
      localAgents,
      reasonCode: inventoryReady ? 'runtime-agent-references-ready' : 'not-probed',
    };
    const bindings = {
      clock: { now: Date.now },
      app: {
        projection: {
          agentCenterBinding: () => null,
          async loadHome() {
            return {
              ...initial,
              runtime: { ...initial.runtime, ready: true },
              auth: { ...initial.auth, ready: true, accountId: 'halliday-account' },
              source: { ...initial.source, ready: true },
              inventory,
              localAgent: {
                ...initial.localAgent,
                ready: false,
                agentHandle: null,
                reasonCode: localAgents.length === 0
                  ? 'zhiyu-runtime-local-agent-inventory-empty'
                  : 'zhiyu-runtime-local-agent-selection-required',
              },
              conversation: {
                ...initial.conversation,
                ready: false,
                agentHandle: null,
                conversationAnchorId: null,
                threadId: null,
                reasonCode: 'zhiyu-local-agent-required',
              },
            };
          },
          async loadAgentInventory() {
            return inventory;
          },
          projectTurnReadiness(conversation) {
            return { ...initial.turn, ...conversation, ready: false };
          },
        },
        commands: {
          characters: () => ({
            async list() {
              return { items: [], nextCursor: null };
            },
            async get() {
              throw new Error('unused in test');
            },
            async acquire() {
              throw new Error('unused in test');
            },
          }),
          async allocateTurnRequestId() {
            return 'request-unused';
          },
          conversation: () => ({
            async send() { throw new Error('unused'); },
            async uploadAttachment() { throw new Error('unused'); },
            async interruptTurn() { throw new Error('unused'); },
            async snapshot() { return { turns: [] }; },
          }),
          draftClient: () => ({
            agents: { async listReferences() { return localAgents; } },
            storage: {
              async readJson() { throw Object.assign(new Error('No draft'), { code: 'not-found' }); },
              async writeJson() {},
            },
          }),
          async openDesktopRuntimeSettings() {},
          async openDesktopSelectPartner() {},
          async launchAvatar() { throw new Error('avatar launch must not run without a partner'); },
        },
        events: {
          subscribeConversation() {
            return { async refresh() {}, retryMedia() {}, invalidateAccess() {}, close() {} };
          },
        },
      },
    };

    let navigation;
    function Harness() {
      navigation = useZhiyuNavigationOwner().navigation;
      return React.createElement(
        NimiMotionProvider,
        { reducedMotion: 'always' },
        React.createElement(ZhiyuCanonicalApp, { bindings }),
      );
    }

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(ZhiyuNavigationOwner, null, React.createElement(Harness)));
    });
    return {
      container,
      navigation,
      async close() {
        await act(async () => root.unmount());
        container.remove();
      },
    };
  };

  try {
    await t.test('0-partner empty state disables avatar/proactive/agent tools with tooltips and routes composer avatar to discovery', async () => {
      const view = await mountApp({ localAgents: [], inventoryReady: true });
      try {
        await settle(() => Boolean(view.container.querySelector('[data-zhiyu-no-local-partner-empty="true"]')));

        const transcriptContainer = view.container.querySelector('.zhiyu-chat-canvas__transcript');
        const transcriptRoot = transcriptContainer?.querySelector('[data-canonical-transcript-root="true"]');
        const transcriptPaddingWrapper = transcriptRoot?.parentElement;
        const intermediateWrapper = transcriptPaddingWrapper?.parentElement;
        assert.ok(transcriptContainer && transcriptRoot && transcriptPaddingWrapper && intermediateWrapper);
        assert.equal(intermediateWrapper.parentElement, transcriptContainer);
        assert.ok(intermediateWrapper.classList.contains('contents'), 'CanonicalMessageActionsProvider renders an intermediate .contents wrapper');
        assert.ok(
          transcriptPaddingWrapper.classList.contains('pl-6') && transcriptPaddingWrapper.classList.contains('pr-2'),
          'CanonicalTranscriptView outer wrapper carries asymmetric pl-6 pr-2 that descendant CSS must normalize',
        );

        const avatarTool = view.container.querySelector('[data-zhiyu-composer-tool="avatar"]');
        const proactiveTool = view.container.querySelector('[data-zhiyu-composer-tool="proactive"]');
        const agentTool = view.container.querySelector('[data-zhiyu-composer-tool="agent"]');
        const composerAvatar = view.container.querySelector('.zhiyu-home__composer-avatar');

        assert.ok(avatarTool && proactiveTool && agentTool && composerAvatar);
        assert.equal(avatarTool.disabled, true);
        assert.equal(proactiveTool.disabled, true);
        assert.equal(agentTool.disabled, true);
        assert.match(avatarTool.title, /添加本地伙伴/);
        assert.match(proactiveTool.title, /添加本地伙伴/);
        assert.match(agentTool.title, /添加本地伙伴/);

        for (const button of [avatarTool, proactiveTool, agentTool]) {
          await act(async () => button.click());
        }
        assert.equal(view.container.querySelector('[data-zhiyu-region="agent-panel"]'), null);
        assert.doesNotMatch(view.container.textContent, /设置暂时不可用|伙伴设置暂时没有响应/);

        assert.equal(composerAvatar.disabled, false);
        assert.equal(composerAvatar.getAttribute('data-zhiyu-composer-avatar-action'), 'discover');
        assert.match(composerAvatar.title, /发现角色/);

        await act(async () => composerAvatar.click());
        await settle(() => view.navigation.getSnapshot().current.destination.id === 'discover');
        assert.equal(view.container.querySelector('[data-zhiyu-region="agent-panel"]'), null);
        assert.doesNotMatch(view.container.textContent, /设置暂时不可用|伙伴设置暂时没有响应/);
      } finally {
        await view.close();
      }
    });

    await t.test('multi-partner unselected state disables all 4 partner-scoped composer controls with selection tooltips', async () => {
      const localAgents = [
        { agentHandle: 'agent_ref_a', displayName: '伙伴 A', avatarUrl: null },
        { agentHandle: 'agent_ref_b', displayName: '伙伴 B', avatarUrl: null },
      ];
      const view = await mountApp({ localAgents, inventoryReady: true });
      try {
        await settle(() => view.container.querySelectorAll('[data-zhiyu-local-agent-row="true"]').length === 2);

        const avatarTool = view.container.querySelector('[data-zhiyu-composer-tool="avatar"]');
        const proactiveTool = view.container.querySelector('[data-zhiyu-composer-tool="proactive"]');
        const agentTool = view.container.querySelector('[data-zhiyu-composer-tool="agent"]');
        const composerAvatar = view.container.querySelector('.zhiyu-home__composer-avatar');

        assert.equal(composerAvatar.disabled, true);
        assert.equal(composerAvatar.getAttribute('data-zhiyu-composer-avatar-action'), 'disabled');
        assert.match(composerAvatar.title, /选择/);
        assert.equal(avatarTool.disabled, true);
        assert.equal(proactiveTool.disabled, true);
        assert.equal(agentTool.disabled, true);
        assert.match(avatarTool.title, /选择本地伙伴/);
        assert.match(proactiveTool.title, /选择本地伙伴/);
        assert.match(agentTool.title, /选择本地伙伴/);

        for (const button of [composerAvatar, avatarTool, proactiveTool, agentTool]) {
          await act(async () => button.click());
        }
        assert.equal(view.container.querySelector('[data-zhiyu-region="agent-panel"]'), null);
        assert.doesNotMatch(view.container.textContent, /设置暂时不可用|伙伴设置暂时没有响应/);
      } finally {
        await view.close();
      }
    });

    await t.test('programmatically opening the right panel with 0 partners renders no-partner guidance instead of owner-unavailable', async () => {
      const view = await mountApp({ localAgents: [], inventoryReady: true });
      try {
        await settle(() => Boolean(view.container.querySelector('[data-zhiyu-no-local-partner-empty="true"]')));

        await act(async () => {
          await view.navigation.push({ id: 'partner', panel: 'overview' });
        });
        await settle(() => Boolean(view.container.querySelector('[data-zhiyu-region="agent-panel"]')));

        const panel = view.container.querySelector('[data-zhiyu-region="agent-panel"]');
        assert.ok(panel.querySelector('[data-zhiyu-agent-center-unavailable="no-partner"]'));
        assert.equal(panel.querySelector('[data-zhiyu-agent-center-unavailable="owner-unavailable"]'), null);
        assert.match(panel.textContent, /还没有本地伙伴/);
        assert.doesNotMatch(panel.textContent, /设置暂时不可用|伙伴设置暂时没有响应|重新加载伙伴设置/);

        const discoverBtn = panel.querySelector('[data-zhiyu-agent-center-unavailable-action="discover"]');
        assert.ok(discoverBtn);
        await act(async () => discoverBtn.click());
        await settle(() => view.navigation.getSnapshot().current.destination.id === 'discover');
        await settle(() => !view.container.querySelector('[data-zhiyu-region="agent-panel"]:not([aria-hidden="true"])'));
        assert.equal(view.container.querySelector('[data-zhiyu-region="agent-panel"]:not([aria-hidden="true"])'), null);
      } finally {
        await view.close();
      }
    });

    await t.test('RightAgentPanel distinguishes 0-partner, unselected-partner, and genuine owner-unavailable states', async () => {
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      let discoverClicks = 0;
      let closeClicks = 0;
      let retryClicks = 0;

      const renderPanel = (evidence) => act(async () => {
        root.render(
          React.createElement(
            NimiMotionProvider,
            { reducedMotion: 'always' },
            React.createElement(RightAgentPanel, {
              mode: 'agent',
              evidence,
              currentPartnerName: '本地伙伴',
              activeTab: 'overview',
              onActiveTabChange: () => {},
              onDiscover: () => { discoverClicks += 1; },
              onClose: () => { closeClicks += 1; },
              onOpenDesktopRuntimeSettings: () => {},
              onRetryAgentCenter: () => { retryClicks += 1; },
              session: null,
            }),
          ),
        );
      });

      try {
        const base = createInitialZhiyuEvidence();

        await renderPanel({
          ...base,
          localAgent: { ...base.localAgent, ready: false, agentHandle: null },
          inventory: { ...base.inventory, ready: true, count: 0, localAgents: [] },
        });
        assert.ok(container.querySelector('[data-zhiyu-agent-center-unavailable="no-partner"]'));
        assert.doesNotMatch(container.textContent, /设置暂时不可用|伙伴设置暂时没有响应/);
        await act(async () => container.querySelector('[data-zhiyu-agent-center-unavailable-action="discover"]').click());
        assert.equal(discoverClicks, 1);

        await renderPanel({
          ...base,
          localAgent: { ...base.localAgent, ready: false, agentHandle: null },
          inventory: {
            ...base.inventory,
            ready: true,
            count: 1,
            localAgents: [{ agentHandle: 'agent_1', displayName: '伙伴 1', avatarUrl: null }],
          },
        });
        assert.ok(container.querySelector('[data-zhiyu-agent-center-unavailable="no-partner"]'));
        assert.match(container.textContent, /请先选择本地伙伴/);
        assert.doesNotMatch(container.textContent, /设置暂时不可用|伙伴设置暂时没有响应/);
        await act(async () => container.querySelector('[data-zhiyu-agent-center-unavailable-action="close"]').click());
        assert.equal(closeClicks, 1);

        await renderPanel({
          ...base,
          localAgent: { ...base.localAgent, ready: true, agentHandle: 'agent_1' },
          inventory: {
            ...base.inventory,
            ready: true,
            count: 1,
            localAgents: [{ agentHandle: 'agent_1', displayName: '伙伴 1', avatarUrl: null }],
          },
        });
        assert.ok(container.querySelector('[data-zhiyu-agent-center-unavailable="owner-unavailable"]'));
        assert.match(container.textContent, /设置暂时不可用/);
        assert.match(container.textContent, /伙伴设置暂时没有响应，请稍后重试。/);
        await act(async () => container.querySelector('[data-zhiyu-agent-center-unavailable-action="retry"]').click());
        assert.equal(retryClicks, 1);
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    });
  } finally {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('home-surface.css uses symmetric horizontal canvas and transcript insets across desktop and narrow widths', async () => {
  const css = await readFile(path.join(appRoot, 'src/shell/app/home-surface.css'), 'utf8');

  assert.doesNotMatch(css, /padding:\s*12px\s+12px\s+12px\s+60px/u, 'asymmetric 60px left canvas padding must be removed');
  assert.doesNotMatch(css, /\.zhiyu-agent-chat__layout\.is-side-closed\s+\.zhiyu-chat-canvas\s*\{/u, 'higher-specificity .is-side-closed canvas padding override must not shadow narrow breakpoints');
  assert.doesNotMatch(css, /\.zhiyu-chat-canvas\s*\{[^}]*!important/su, '.zhiyu-chat-canvas must not use !important padding overrides');

  assert.doesNotMatch(
    css,
    /\.zhiyu-chat-canvas__transcript\s*>\s*div:has\(/u,
    'transcript padding override must use a descendant selector so intermediate <div class="contents"> wrapper does not bypass it',
  );

  assert.match(css, /\.zhiyu-chat-canvas\s*\{[^}]*padding:\s*12px;/su);
  const desktopTranscriptMatch = css.match(
    /\.zhiyu-chat-canvas__transcript\s+div:has\(>\s*\[data-canonical-transcript-root="true"\]\)\s*\{\s*padding-left:\s*(\d+px);\s*padding-right:\s*(\d+px);\s*\}/u,
  );
  assert.ok(desktopTranscriptMatch, 'desktop descendant transcript selector must normalize horizontal padding');
  assert.equal(desktopTranscriptMatch[1], '16px');
  assert.equal(desktopTranscriptMatch[2], desktopTranscriptMatch[1], 'desktop transcript horizontal padding must be symmetric');
  assert.match(
    css,
    /\.zhiyu-chat-canvas__overlay\s*\{[^}]*left:\s*12px;\s*right:\s*12px;[^}]*padding-left:\s*0;/su,
  );

  const narrowSectionStart = css.indexOf('@container nimi-ui-module-zhiyu-surface (max-width: 640px)');
  assert.ok(narrowSectionStart >= 0, 'narrow <=640px container query must exist');
  const narrowSection = css.slice(narrowSectionStart, css.indexOf('@media (pointer: coarse)', narrowSectionStart));
  assert.match(narrowSection, /\.zhiyu-chat-canvas\s*\{[^}]*padding:\s*4px;/su);
  const narrowTranscriptMatch = narrowSection.match(
    /\.zhiyu-chat-canvas__transcript\s+div:has\(>\s*\[data-canonical-transcript-root="true"\]\)\s*\{\s*padding-left:\s*(\d+px);\s*padding-right:\s*(\d+px);\s*\}/u,
  );
  assert.ok(narrowTranscriptMatch, 'narrow <=640px descendant transcript selector must normalize horizontal padding');
  assert.equal(narrowTranscriptMatch[1], '8px');
  assert.equal(narrowTranscriptMatch[2], narrowTranscriptMatch[1], 'narrow <=640px transcript horizontal padding must be symmetric');
  assert.match(narrowSection, /\.zhiyu-chat-canvas__overlay\s*\{[^}]*left:\s*8px;\s*right:\s*8px;\s*padding-left:\s*0;/su);
});
