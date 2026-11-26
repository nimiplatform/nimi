import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.png') || url.endsWith('.css')) {
      return { format: 'module', shortCircuit: true, source: 'export default "";' };
    }
    return nextLoad(url, context);
  },
});

test('Zhiyu dark-mode system scheme sync, unified remote chrome, and floating RightAgentPanel drawer', async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  let matchesDark = true;
  const listeners = new Set();
  const mediaQuery = {
    media: '(prefers-color-scheme: dark)',
    get matches() { return matchesDark; },
    addEventListener(type, listener) { if (type === 'change') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'change') listeners.delete(listener); },
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
  };
  dom.window.matchMedia = () => mediaQuery;

  const setDark = (next) => {
    matchesDark = next;
    for (const listener of [...listeners]) listener({ matches: next });
  };

  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, KeyboardEvent: dom.window.KeyboardEvent,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const original = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

  const { createRoot } = await import('react-dom/client');
  const { NimiThemeProvider, TooltipProvider } = await import('@nimiplatform/kit/ui');
  const { NimiMotionProvider } = await import('@nimiplatform/kit/ui/motion');
  const { NimiAppSessionProvider } = await import('@nimiplatform/kit/auth/app');
  const { createNimiRendererHostBinding, createNimiRendererThemeController, NimiRendererHostProvider } = await import('@nimiplatform/kit/shell/renderer/host');
  const { resolveSystemScheme, useSystemScheme } = await import('../src/production/system-scheme.ts');
  const { ZhiyuRemoteShell } = await import('../src/production/remote-shell.tsx');
  const { RightAgentPanel } = await import('../src/shell/agent-chat/ZhiyuAgentRightPanel.tsx');

  const rootEl = document.getElementById('root');
  const overlayEl = document.createElement('div');
  document.body.append(overlayEl);
  const reactRoot = createRoot(rootEl);

  try {
    await t.test('system scheme tracks OS prefers-color-scheme live across NimiThemeProvider and renderer host theme controller', async () => {
      const themeController = createNimiRendererThemeController({
        scheme: resolveSystemScheme(),
        accentPack: 'nimi-accent',
        density: 'regular',
      });
      const rendererHost = createNimiRendererHostBinding({
        opaqueScopePrefix: 'zhiyu-theme-test',
        declaredMethods: [],
        capabilities: [],
        localization: { locale: 'zh-CN', language: 'zh', direction: 'ltr' },
        targets: { renderer: rootEl, overlay: overlayEl },
        theme: themeController,
        operations: { invoke: async () => ({ ok: false, error: { disposition: 'unsupported' } }) },
        overlays: { target: overlayEl, acquire: async () => ({ ok: false, error: { disposition: 'unsupported' } }) },
        surfaceLifecycle: { reportReadyCandidate: () => undefined },
      });

      function Harness() {
        const scheme = useSystemScheme(themeController);
        return React.createElement(
          NimiRendererHostProvider,
          { binding: rendererHost },
          React.createElement(
            NimiThemeProvider,
            { accentPack: 'nimi-accent', scheme },
            React.createElement('div', { 'data-testid': 'scheme-readout' }, scheme),
          ),
        );
      }

      assert.equal(resolveSystemScheme(), 'dark');
      await act(async () => {
        reactRoot.render(React.createElement(Harness));
      });
      assert.equal(document.documentElement.dataset.nimiScheme, 'dark');
      assert.equal(document.documentElement.classList.contains('dark'), true);
      assert.equal(rootEl.dataset.nimiScheme, 'dark');
      assert.equal(rootEl.classList.contains('dark'), true);
      assert.equal(overlayEl.dataset.nimiScheme, 'dark');
      assert.equal(themeController.getSnapshot().scheme, 'dark');
      assert.equal(listeners.size, 1);

      await act(async () => {
        setDark(false);
      });
      assert.equal(document.documentElement.dataset.nimiScheme, 'light');
      assert.equal(document.documentElement.classList.contains('dark'), false);
      assert.equal(rootEl.dataset.nimiScheme, 'light');
      assert.equal(rootEl.classList.contains('dark'), false);
      assert.equal(overlayEl.dataset.nimiScheme, 'light');
      assert.equal(themeController.getSnapshot().scheme, 'light');

      await act(async () => {
        setDark(true);
      });
      assert.equal(document.documentElement.dataset.nimiScheme, 'dark');
      assert.equal(rootEl.dataset.nimiScheme, 'dark');
      assert.equal(themeController.getSnapshot().scheme, 'dark');

      await act(async () => {
        reactRoot.render(null);
      });
      assert.equal(listeners.size, 0, 'media query change listener is cleaned up on unmount');
    });

    await t.test('ZhiyuRemoteShell consolidates Web/Android header into a single unified top chrome bar when connected', async () => {
      const rendererHost = createNimiRendererHostBinding({
        opaqueScopePrefix: 'zhiyu-remote-chrome-test',
        declaredMethods: [],
        capabilities: [],
        localization: { locale: 'zh-CN', language: 'zh', direction: 'ltr' },
        targets: { renderer: rootEl, overlay: overlayEl },
        theme: createNimiRendererThemeController({ scheme: 'light', accentPack: 'nimi-accent', density: 'regular' }),
        operations: { invoke: async () => ({ ok: false, error: { disposition: 'unsupported' } }) },
        overlays: { target: overlayEl, acquire: async () => ({ ok: false, error: { disposition: 'unsupported' } }) },
        surfaceLifecycle: { reportReadyCandidate: () => undefined },
      });

      const sessionListeners = new Set();
      let snapshot = {
        identity: { status: 'signed-out', user: null, viewKey: 'out' },
        runtime: { status: 'disconnected', scope: null, displayName: null },
        busy: 'none',
        pendingRevocation: false,
        issue: null,
      };
      const session = {
        account: { kind: 'app-session', signIn: async () => {}, signOut: async () => {} },
        start: async () => {},
        dispose: () => {},
        recheck: async () => {},
        connectRuntime: async () => {},
        disconnectRuntime: () => {},
        cancelSignIn: () => {},
        subscribe(listener) {
          sessionListeners.add(listener);
          return () => sessionListeners.delete(listener);
        },
        getSnapshot: () => snapshot,
      };

      await act(async () => {
        reactRoot.render(
          React.createElement(
            NimiMotionProvider,
            { reducedMotion: 'always' },
            React.createElement(
              TooltipProvider,
              null,
              React.createElement(
                NimiAppSessionProvider,
                { session },
                React.createElement(ZhiyuRemoteShell, {
                  host: rendererHost.facade,
                  title: '织羽网页版',
                  renderSurface: React.createElement('div', { 'data-testid': 'stub-zhiyu-surface' }, 'Surface'),
                }),
              ),
            ),
          ),
        );
      });

      assert.equal(document.querySelectorAll('header').length, 1, 'disconnected gate renders exactly one top header');
      assert.ok(document.querySelector('.zhiyu-remote-gate-header'), 'pre-connect gate header is shown before connection');
      assert.equal(document.querySelector('[data-zhiyu-unified-chrome="true"]'), null);

      await act(async () => {
        snapshot = {
          identity: { status: 'signed-in', user: { displayName: 'Tester' }, viewKey: 'in-1' },
          runtime: { status: 'connected', scope: { client: {}, signal: new AbortController().signal, viewKey: 'rt-1' }, displayName: 'My PC' },
          busy: 'none',
          pendingRevocation: false,
          issue: null,
        };
        for (const listener of [...sessionListeners]) listener();
      });

      assert.equal(document.querySelector('.zhiyu-remote-gate-header'), null, 'duplicate gate header is removed once connected');
      assert.ok(document.querySelector('[data-zhiyu-unified-chrome="true"]'), 'connected view renders unified top chrome');
      assert.equal(document.querySelectorAll('header').length, 1, 'connected remote view never stacks duplicate <header> bars');
      assert.ok(document.querySelector('.zhiyu-top-chrome__trailing')?.textContent?.includes('Tester'), 'account control lives inside unified chrome trailing slot');
    });

    await t.test('RightAgentPanel floating drawer dismisses on Escape unless an inner modal dialog is open', async () => {
      let closed = 0;
      await act(async () => {
        reactRoot.render(
          React.createElement(
            NimiMotionProvider,
            { reducedMotion: 'always' },
            React.createElement(RightAgentPanel, {
              mode: 'agent',
              evidence: {
                companion: { currentEmotion: null, executionState: null },
                localAgent: { agentHandle: 'opaque-agent' },
                inventory: { localAgents: [] },
                chat: { state: 'idle', reasonCode: '', message: '' },
              },
              currentPartnerName: '伙伴',
              activeTab: 'overview',
              onActiveTabChange: () => {},
              onClose: () => { closed += 1; },
              onOpenDesktopRuntimeSettings: () => {},
              onRetryAgentCenter: () => {},
              session: null,
            }),
          ),
        );
      });

      const aside = document.querySelector('aside.zhiyu-agent-center');
      assert.ok(aside, 'RightAgentPanel renders as floating aside');
      assert.equal(aside.getAttribute('role'), 'dialog');
      assert.equal(aside.getAttribute('aria-modal'), 'true');
      assert.ok(aside.contains(document.activeElement), 'opening RightAgentPanel moves keyboard focus inside the drawer');

      // Sibling background control outside the drawer must never receive Tab / Shift+Tab focus
      const behindButton = document.createElement('button');
      behindButton.type = 'button';
      behindButton.textContent = '转交电脑工作台';
      document.body.prepend(behindButton);
      try {
        await act(async () => {
          window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
        });
        assert.ok(aside.contains(document.activeElement), 'Shift+Tab stays trapped inside RightAgentPanel');
        assert.notEqual(document.activeElement, behindButton, 'background Handoff button is unreachable while drawer is open');

        await act(async () => {
          window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        });
        assert.ok(aside.contains(document.activeElement), 'Tab stays trapped inside RightAgentPanel');
      } finally {
        behindButton.remove();
      }

      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('data-state', 'open');
      document.body.append(modal);
      await act(async () => {
        window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      });
      assert.equal(closed, 0, 'inner open dialog suppresses outer drawer Escape dismiss');
      modal.remove();

      await act(async () => {
        window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      });
      assert.equal(closed, 1, 'Escape dismisses RightAgentPanel');
    });

    await t.test('system scheme re-syncs on window focus if media query changed while hidden', async () => {
      const themeController = createNimiRendererThemeController({
        scheme: 'light',
        accentPack: 'nimi-accent',
        density: 'regular',
      });
      matchesDark = false;
      function FocusSyncHarness() {
        const scheme = useSystemScheme(themeController);
        return React.createElement(NimiThemeProvider, { accentPack: 'nimi-accent', scheme }, React.createElement('span', null, scheme));
      }
      await act(async () => {
        reactRoot.render(React.createElement(FocusSyncHarness));
      });
      assert.equal(document.documentElement.dataset.nimiScheme, 'light');
      // Simulate hidden Chromium window where media query matches changes without firing 'change'
      matchesDark = true;
      await act(async () => {
        window.dispatchEvent(new dom.window.Event('focus'));
      });
      assert.equal(document.documentElement.dataset.nimiScheme, 'dark');
      assert.equal(themeController.getSnapshot().scheme, 'dark');
    });

    await t.test('RightAgentPanel restores focus to its trigger when Escape closes and retains focus across inner tab changes', async () => {
      const { AnimatePresence } = await import('@nimiplatform/kit/ui/motion');
      function DrawerFocusHost() {
        const [open, setOpen] = React.useState(false);
        const [tab, setTab] = React.useState('overview');
        return React.createElement(
          NimiMotionProvider,
          { reducedMotion: 'always' },
          React.createElement(
            'div',
            null,
            React.createElement('button', {
              type: 'button',
              'data-testid': 'partner-trigger',
              onClick: () => setOpen(true),
            }, '伙伴中心'),
            React.createElement(
              AnimatePresence,
              null,
              open ? React.createElement(RightAgentPanel, {
                key: 'drawer',
                mode: 'agent',
                evidence: {
                  companion: { currentEmotion: null, executionState: null },
                  localAgent: { agentHandle: 'opaque-agent' },
                  inventory: { localAgents: [] },
                  chat: { state: 'idle', reasonCode: '', message: '' },
                },
                currentPartnerName: '伙伴',
                activeTab: tab,
                onActiveTabChange: setTab,
                onClose: () => setOpen(false),
                onOpenDesktopRuntimeSettings: () => {},
                onRetryAgentCenter: () => {},
                session: null,
              }) : null,
            ),
          ),
        );
      }

      await act(async () => {
        reactRoot.render(React.createElement(DrawerFocusHost));
      });
      const trigger = document.querySelector('[data-testid="partner-trigger"]');
      assert.ok(trigger);
      trigger.focus();
      assert.equal(document.activeElement, trigger);

      await act(async () => {
        trigger.click();
      });
      const aside = document.querySelector('aside.zhiyu-agent-center');
      assert.ok(aside && aside.contains(document.activeElement), 'opening drawer focuses inside aside');

      // A visible Radix Tooltip popper wrapper must NOT disable drawer Escape / focus trap
      const tooltipWrapper = document.createElement('div');
      tooltipWrapper.setAttribute('data-radix-popper-content-wrapper', '');
      const tooltipRole = document.createElement('span');
      tooltipRole.setAttribute('role', 'tooltip');
      tooltipRole.textContent = '关闭织羽伙伴中心';
      tooltipWrapper.append(tooltipRole);
      document.body.append(tooltipWrapper);
      try {
        await act(async () => {
          window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        });
        assert.equal(document.activeElement, trigger, 'Escape immediately restores focus to the exact trigger button even when a tooltip is mounted');
      } finally {
        tooltipWrapper.remove();
      }
    });
  } finally {
    await act(async () => {
      reactRoot.unmount();
    });
    overlayEl.remove();
    dom.window.close();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
