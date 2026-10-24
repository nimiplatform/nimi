// Scripted public bindings exercise the real App, Surface and Composer. This is
// deterministic UI regression coverage, not a Runtime/model acceptance run.
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import test from 'node:test';
import React, { act } from 'react';

const requireKitTestDependency = createRequire(new URL('../../../kit/package.json', import.meta.url));
const { JSDOM } = requireKitTestDependency('jsdom');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.png')) {
      const asset = new URL(specifier, context.parentURL).href;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(`export default ${JSON.stringify(asset)};`)}` };
    }
    return nextResolve(specifier, context);
  },
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('Zhiyu keeps original input and scopes its shared conversation controls', async (t) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement, Element: dom.window.Element,
    Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    File: dom.window.File, FileReader: dom.window.FileReader,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { ZhiyuCanonicalApp } = await import('../src/shell/app/App.tsx');
  const { ZhiyuNavigationOwner, useZhiyuNavigationOwner } = await import('../src/shell/app/navigation.tsx');
  const { createInitialZhiyuEvidence } = await import('../src/shell/app/evidence.ts');
  const { createZhiyuProductionBindings } = await import('../src/production/renderer-bindings.ts');
  const { createNimiRendererHostBinding, createNimiRendererThemeController } = await import('@nimiplatform/kit/shell/renderer/host');
  const productionLaunch = hostPort => {
    const overlay = document.createElement('div');
    const rendererHost = createNimiRendererHostBinding({
      opaqueScopePrefix: 'zhiyu-confirmation-regression', declaredMethods: [], capabilities: [],
      localization: { locale: 'zh-CN', language: 'zh', direction: 'ltr' },
      targets: { renderer: document.createElement('div'), overlay },
      theme: createNimiRendererThemeController({ scheme: 'light', accentPack: 'nimi-accent', density: 'regular' }),
      operations: { invoke: async () => { throw new Error('Source confirmation must not invoke a native shell capability'); } },
      overlays: { target: overlay, acquire: async () => ({ ok: false, error: { disposition: 'unsupported' } }) },
      surfaceLifecycle: { reportReadyCandidate() {} },
    });
    return createZhiyuProductionBindings(rendererHost.facade, { avatarHostPort: hostPort }).app.commands.launchAvatar;
  };
  const agents = ['A', 'B'].map(value => ({ agentHandle: `agent_ref_${value.repeat(43)}`, agentBinding: `agent_binding_${value.repeat(43)}`, displayName: `伙伴 ${value}`, avatarUrl: null }));
  const anchor = handle => handle === agents[1].agentHandle ? 'anchor-B' : 'anchor-A';
  const draftPath = agent => `agent-chat/drafts/${agent.agentBinding}.json`;
  const settle = async predicate => {
    for (let i = 0; i < 50 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    assert.ok(predicate(), 'expected UI state did not settle');
  };
  const clickText = async (node, text) => {
    const button = [...node.querySelectorAll('button')].find(value => value.textContent === text);
    assert.ok(button, `missing button: ${text}`);
    await act(async () => button.click());
  };
  const type = async (node, text) => {
    const field = node.querySelector('textarea');
    assert.ok(field);
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(field, text);
      field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  const attachImage = async (node, name = 'original.png') => {
    await act(async () => node.querySelector('[data-chat-composer-attach]').click());
    const picker = document.querySelector('input[type=file]');
    Object.defineProperty(picker, 'files', { configurable: true, value: [new dom.window.File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })] });
    await act(async () => picker.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    await settle(() => node.textContent.includes(name));
  };
  const mount = async (options = {}) => {
    const initial = createInitialZhiyuEvidence();
    const inventory = { ...initial.inventory, ready: true, count: agents.length, localAgents: agents };
    const records = new Map([[draftPath(agents[0]), { version: 1, draft: options.draft ?? '原来的问题', submission: options.pending ?? null }]]);
    const calls = { send: [], interrupt: [], avatar: [], openSettings: 0 };
    const currentAnchor = options.anchor ?? anchor;
    const conversation = {
      async send(request) { calls.send.push(request); return options.send ? options.send(request) : { turnId: 'accepted-turn' }; },
      async uploadAttachment() { return { artifactId: 'original-image' }; },
      async interruptTurn(request) { calls.interrupt.push(request); },
      async snapshot() { return { turns: [] }; },
    };
    const bindings = { clock: { now: Date.now }, app: {
      projection: {
        agentCenterBinding: () => null,
        async loadHome({ selectedAgentHandle }) {
          const agentHandle = selectedAgentHandle ?? agents[0].agentHandle;
          return { ...initial, runtime: { ...initial.runtime, ready: true }, auth: { ...initial.auth, ready: true, accountId: options.accountId?.() ?? 'account' },
            source: { ...initial.source, ready: true }, inventory, localAgent: { ...initial.localAgent, ready: true, agentHandle },
            conversation: { ...initial.conversation, ready: true, agentHandle, conversationAnchorId: currentAnchor(agentHandle), threadId: currentAnchor(agentHandle) },
            avatar: options.avatarReady ? { ...initial.avatar, ready: true, state: 'projected', launchAvailable: true, agentHandle, conversationAnchorId: currentAnchor(agentHandle) } : initial.avatar };
        },
        async loadAgentInventory() { return inventory; },
        projectTurnReadiness(conversation) { return { ...initial.turn, ...conversation, ready: true }; },
      },
      commands: {
        async allocateTurnRequestId() { if (options.allocateError) throw options.allocateError; return 'request-test'; },
        conversation: () => conversation,
        draftClient: () => ({ agents: { async listReferences() { return agents; } }, storage: {
          async readJson(path) { if (!records.has(path)) throw Object.assign(new Error('No draft'), { code: 'not-found' }); return { value: records.get(path) }; },
          async writeJson(path, value) { if (options.write) await options.write(value); records.set(path, structuredClone(value)); },
        } }),
        async openDesktopRuntimeSettings() { calls.openSettings++; }, async openDesktopSelectPartner() {},
        async launchAvatar(input) { calls.avatar.push(input); return options.launchAvatar?.(input); },
      },
      events: {
        subscribeConversation({ agentHandle, conversationAnchorId, onChat, onStatus }) {
          const chat = { ...initial.chat, agentHandle, conversationAnchorId, state: 'completed', ready: true, textTurnId: null, ...options.chat };
          onChat(chat); onStatus('ready');
          return { async refresh() { options.onRefresh?.(); onChat(chat); onStatus('ready'); }, retryMedia() { options.onRetryMedia?.(); }, close() {} };
        },
      },
    } };
    let navigation;
    let currentBindings = bindings;
    function App() {
      navigation = useZhiyuNavigationOwner().navigation;
      return React.createElement(ZhiyuCanonicalApp, { bindings: currentBindings });
    }
    const node = document.createElement('div'); document.body.appendChild(node);
    const root = createRoot(node);
    const render = () => root.render(React.createElement(ZhiyuNavigationOwner, null, React.createElement(App)));
    await act(async () => render());
    await settle(() => node.querySelector('textarea') && (options.pending || !node.querySelector('textarea').disabled));
    return { node, calls, records, navigation,
      async replaceBindings() { currentBindings = { ...bindings }; await act(async () => render()); },
      async close() { await act(async () => root.unmount()); node.remove(); } };
  };
  try {
    const avatarFailure = (reasonCode = 'avatar-host-mechanic-failed') => ({ state: 'blocked', reasonCode,
      actionHint: 'retry_avatar_host_handoff', message: 'Avatar candidate did not complete.' });
    const avatarOpened = { state: 'opened', reasonCode: 'zhiyu-avatar-launch-requested', actionHint: 'inspect_avatar_window',
      message: 'Avatar Host launch completed with present state.', handoff: { command: 'launch', state: 'present' } };
    const clickAvatar = async view => act(async () => view.node.querySelector('[data-zhiyu-composer-tool="avatar"]').click());
    const switchRequired = { command: 'launch', state: 'confirmation-required', avatarInstanceRef: null,
      switchIntentRef: 'avatar_switch_once', committedPresentationRef: null, temporaryCustodyRef: null };
    const switched = { command: 'launch', state: 'present', avatarInstanceRef: 'avatar:switched',
      switchIntentRef: null, committedPresentationRef: null, temporaryCustodyRef: null };
    const activeSwitchDialog = () => document.querySelector('[role="dialog"][data-state="open"]');

    await t.test('the real production command awaits the source ConfirmDialog before submitting the one-time switch', async () => {
      const requests = [];
      const view = await mount({ avatarReady: true, launchAvatar: productionLaunch({ async invoke(request) {
        requests.push(request); return requests.length === 1 ? switchRequired : switched;
      } }) });
      try {
        await clickAvatar(view);
        await settle(() => activeSwitchDialog());
        assert.match(activeSwitchDialog().textContent, /切换桌面伙伴？/u);
        assert.equal(requests.length, 1);
        assert.equal(view.node.querySelector('[data-zhiyu-composer-tool="avatar"]').disabled, true);
        await clickAvatar(view);
        assert.equal(view.calls.avatar.length, 1);
        await clickText(activeSwitchDialog(), '切换伙伴');
        await settle(() => view.node.querySelector('[data-zhiyu-avatar-feedback="opened"]'));
        assert.equal(requests.length, 2);
        assert.equal(requests[0].target.switchIntentRef, null);
        assert.equal(requests[1].target.switchIntentRef, 'avatar_switch_once');
        assert.equal(view.node.querySelector('textarea').value, '原来的问题');
      } finally { await view.close(); }
    });

    await t.test('cancelling the source switch dialog performs no second Host request and permits retry', async () => {
      const requests = [];
      const view = await mount({ avatarReady: true, launchAvatar: productionLaunch({ async invoke(request) {
        requests.push(request); return switchRequired;
      } }) });
      try {
        await clickAvatar(view);
        await settle(() => activeSwitchDialog());
        await clickText(activeSwitchDialog(), '取消');
        await settle(() => view.node.querySelector('[data-zhiyu-avatar-feedback="cancelled"]'));
        assert.equal(requests.length, 1);
        assert.equal(view.node.querySelector('[data-zhiyu-composer-tool="avatar"]').disabled, false);
        await clickAvatar(view);
        await settle(() => activeSwitchDialog());
        assert.equal(requests.length, 2);
        assert.ok(requests.every(request => request.target.switchIntentRef === null));
      } finally { await view.close(); }
    });

    for (const change of ['partner', 'conversation', 'account', 'bindings', 'unmount']) {
      await t.test(`a pending source confirmation is cancelled on ${change} change without switching`, async () => {
        const requests = [];
        let anchorId = 'anchor-A', accountId = 'account', settled = false;
        const launch = productionLaunch({ async invoke(request) { requests.push(request); return switchRequired; } });
        const view = await mount({ avatarReady: true, anchor: () => anchorId, accountId: () => accountId,
          launchAvatar: async input => { const result = await launch(input); settled = true; return result; } });
        let closed = false;
        try {
          await clickAvatar(view);
          await settle(() => activeSwitchDialog());
          if (change === 'unmount') { await view.close(); closed = true; }
          else if (change === 'bindings') await view.replaceBindings();
          else {
            if (change === 'conversation') anchorId = 'anchor-new';
            if (change === 'account') accountId = 'another-account';
            await act(async () => view.navigation.push({ id: 'partner',
              agentHandle: change === 'partner' ? agents[1].agentHandle : agents[0].agentHandle,
              conversationAnchorId: anchorId, panel: 'appearance' }));
          }
          await settle(() => settled);
          assert.equal(requests.length, 1);
          assert.equal(view.node.querySelector('[data-zhiyu-avatar-feedback="cancelled"]'), null, 'old cancellation must not enter the new scope');
          if (!closed) assert.equal(view.node.querySelector('[data-zhiyu-composer-tool="avatar"]').disabled, false);
        } finally { if (!closed) await view.close(); }
      });
    }

    await t.test('Avatar pending suppresses repeat launch, then shows a retryable failure without losing input or partner', async () => {
      const first = deferred();
      let attempts = 0;
      const view = await mount({ avatarReady: true, launchAvatar: () => ++attempts === 1 ? first.promise : avatarOpened });
      try {
        await act(async () => { const button = view.node.querySelector('[data-zhiyu-composer-tool="avatar"]'); button.click(); button.click(); });
        assert.equal(view.calls.avatar.length, 1);
        assert.equal(view.node.querySelector('[data-zhiyu-composer-tool="avatar"]').disabled, true);
        assert.match(view.node.querySelector('[data-zhiyu-avatar-feedback] [role="status"]').textContent, /正在打开伙伴形象/u);
        assert.equal(view.node.querySelector('textarea').disabled, false);
        await type(view.node, '等待形象时写下的草稿');
        await act(async () => first.resolve(avatarFailure()));
        await settle(() => view.node.querySelector('[data-zhiyu-avatar-feedback="failed"]'));
        assert.equal(view.node.querySelector('[data-zhiyu-composer-tool="avatar"]').disabled, false);
        assert.equal(view.node.querySelector('[role="alert"]').textContent, '未能打开伙伴形象');
        assert.doesNotMatch(view.node.textContent, /Runtime 未启动|旧形象已保留|检查 Nimi/u);
        assert.match(view.node.querySelector('details').textContent, /avatar-host-mechanic-failed/u);
        assert.equal(view.node.querySelector('textarea').value, '等待形象时写下的草稿');
        assert.equal(view.navigation.getSnapshot().current.destination.agentHandle, agents[0].agentHandle);
        await clickText(view.node, '形象设置');
        assert.equal(view.navigation.getSnapshot().current.destination.panel, 'appearance');
        assert.ok(view.node.querySelector('[data-zhiyu-avatar-feedback="failed"]'), 'opening the current partner panel retains feedback');
        await clickText(view.node, '重试打开');
        await settle(() => view.node.querySelector('[data-zhiyu-avatar-feedback="opened"]'));
        assert.equal(view.calls.avatar.length, 2);
        assert.equal(view.node.querySelector('textarea').value, '等待形象时写下的草稿');
        assert.equal(view.node.querySelector('[data-zhiyu-avatar-feedback="failed"]'), null);
      } finally { await view.close(); }
    });

    await t.test('Avatar connection failure offers the existing Nimi settings action and catches a rejected command', async () => {
      const view = await mount({ avatarReady: true, launchAvatar: () => { throw Object.assign(new Error('Caller bridge authorization failed'),
        { reasonCode: 'avatar-host-bridge-auth-failed', actionHint: 'restart_desktop_supervised_app' }); } });
      try {
        await clickAvatar(view);
        await settle(() => view.node.querySelector('[data-zhiyu-avatar-feedback="failed"]'));
        await clickText(view.node, '检查 Nimi');
        assert.equal(view.calls.openSettings, 1);
        assert.equal(view.node.querySelector('[data-zhiyu-composer-tool="avatar"]').disabled, false);
        await act(async () => view.node.querySelector('[aria-label="关闭形象提示"]').click());
        assert.equal(view.node.querySelector('[data-zhiyu-avatar-feedback]'), null);
      } finally { await view.close(); }
    });

    await t.test('late Avatar failure from another partner cannot replace the current pending result', async () => {
      const first = deferred(), second = deferred();
      const view = await mount({ avatarReady: true, launchAvatar: input => input.evidence.conversation.agentHandle === agents[0].agentHandle ? first.promise : second.promise });
      try {
        await clickAvatar(view);
        await act(async () => view.navigation.push({ id: 'partner', agentHandle: agents[1].agentHandle }));
        await settle(() => view.node.querySelector('[data-zhiyu-avatar-launch-entry="ready"]'));
        await clickAvatar(view);
        assert.equal(view.calls.avatar.length, 2);
        await act(async () => first.resolve(avatarFailure('old-partner-failure')));
        assert.ok(view.node.querySelector('[data-zhiyu-avatar-feedback="pending"]'));
        assert.doesNotMatch(view.node.textContent, /old-partner-failure/u);
        assert.equal(view.node.querySelector('[data-zhiyu-composer-tool="avatar"]').disabled, true);
        await act(async () => second.resolve(avatarOpened));
        await settle(() => view.node.querySelector('[data-zhiyu-avatar-feedback="opened"]'));
        assert.equal(view.navigation.getSnapshot().current.destination.agentHandle, agents[1].agentHandle);
      } finally { await view.close(); }
    });

    await t.test('changing conversation or unmounting fences an old Avatar response', async () => {
      const old = deferred(), current = deferred();
      let anchorId = 'anchor-A';
      const view = await mount({ avatarReady: true, anchor: () => anchorId, launchAvatar: input => input.evidence.conversation.conversationAnchorId === 'anchor-A' ? old.promise : current.promise });
      await clickAvatar(view);
      anchorId = 'anchor-new';
      await act(async () => view.navigation.push({ id: 'partner', agentHandle: agents[0].agentHandle, conversationAnchorId: anchorId }));
      await settle(() => view.node.querySelector('[data-zhiyu-avatar-launch-entry="ready"]') && !view.node.querySelector('[data-zhiyu-avatar-feedback]'));
      await clickAvatar(view);
      assert.equal(view.calls.avatar[1].evidence.conversation.conversationAnchorId, anchorId);
      await act(async () => old.resolve(avatarOpened));
      assert.ok(view.node.querySelector('[data-zhiyu-avatar-feedback="pending"]'));
      await view.close();
      await act(async () => current.reject(new Error('Late after unmount')));
      const fresh = await mount({ avatarReady: true, launchAvatar: () => avatarOpened });
      try { assert.equal(fresh.node.querySelector('[data-zhiyu-avatar-feedback]'), null); }
      finally { await fresh.close(); }
    });

    for (const change of ['account', 'bindings']) {
      await t.test(`changing ${change} invalidates a pending Avatar result even for the same partner`, async () => {
        const old = deferred(), current = deferred();
        let attempt = 0, accountId = 'account';
        const view = await mount({ avatarReady: true, accountId: () => accountId,
          launchAvatar: () => ++attempt === 1 ? old.promise : current.promise });
        try {
          await clickAvatar(view);
          if (change === 'bindings') await view.replaceBindings();
          else {
            accountId = 'another-account';
            await act(async () => view.navigation.push({ ...view.navigation.getSnapshot().current.destination, panel: 'appearance' }));
          }
          await settle(() => !view.node.querySelector('[data-zhiyu-avatar-feedback]'));
          await clickAvatar(view);
          assert.equal(view.calls.avatar.length, 2);
          assert.equal(view.calls.avatar[1].evidence.auth.accountId, accountId);
          await act(async () => old.resolve(avatarFailure('old-session-failure')));
          assert.ok(view.node.querySelector('[data-zhiyu-avatar-feedback="pending"]'));
          assert.doesNotMatch(view.node.textContent, /old-session-failure/u);
          await act(async () => current.resolve(avatarOpened));
          await settle(() => view.node.querySelector('[data-zhiyu-avatar-feedback="opened"]'));
        } finally { await view.close(); }
      });
    }

    await t.test('declining an Avatar switch is a completed cancellation, not an error or a claim of existing presentation', async () => {
      const view = await mount({ avatarReady: true, launchAvatar: () => ({ state: 'blocked', reasonCode: 'zhiyu-avatar-switch-cancelled',
        actionHint: 'keep_current_companion', message: 'Kept the current desktop companion.' }) });
      try {
        await clickAvatar(view);
        assert.ok(view.node.querySelector('[data-zhiyu-avatar-feedback="cancelled"]'));
        assert.equal(view.node.querySelector('[role="alert"]'), null);
        assert.match(view.node.textContent, /已取消这次切换/u);
        assert.doesNotMatch(view.node.textContent, /已保留|Kept the current/u);
        assert.equal(view.node.querySelector('[data-zhiyu-composer-tool="avatar"]').disabled, false);
        assert.equal(view.node.querySelector('textarea').value, '原来的问题');
      } finally { await view.close(); }
    });

    await t.test('reloading failed images is a read action, separate from conversation refresh or send', async () => {
      let retries = 0;
      let refreshes = 0;
      const view = await mount({ chat: { mediaReadError: 'failed' },
        onRetryMedia: () => { retries++; }, onRefresh: () => { refreshes++; } });
      try {
        await clickText(view.node, '重新加载图片');
        assert.equal(retries, 1);
        assert.equal(refreshes, 0);
        assert.equal(view.calls.send.length, 0);
        assert.equal(view.node.querySelector('textarea').disabled, false);
      } finally { await view.close(); }
    });

    await t.test('a busy rejection preserves text and image, and prepare never exposes recovery actions', async () => {
      const save = deferred();
      const view = await mount({ write: async value => { if (value.submission) await save.promise; },
        send: async () => { throw Object.assign(new Error('Busy'), { reasonCode: 'AGENT_BUSY' }); } });
      try {
        await attachImage(view.node);
        await act(async () => view.node.querySelector('[data-chat-composer-send]').click());
        await settle(() => view.node.querySelector('[data-zhiyu-composer-state="submitting"]'));
        assert.equal(view.calls.send.length, 0);
        assert.doesNotMatch(view.node.textContent, /继续这条消息|上一条消息的受理结果尚未确认/u);
        await act(async () => save.resolve());
        await settle(() => view.calls.send.length === 1 && !view.node.querySelector('textarea').disabled);
        assert.equal(view.node.querySelector('textarea').value, '原来的问题');
        assert.match(view.node.textContent, /original\.png/u);
        assert.match(view.node.textContent, /伙伴正在处理另一条消息，输入已保留/u);
        assert.doesNotMatch(view.node.textContent, /消息尚未发送：暂时无法保存/u);
        assert.equal(view.records.get(draftPath(agents[0])).submission, null);
      } finally { await view.close(); }
    });

    await t.test('an in-flight send stays separate from unknown-admission recovery', async () => {
      const admission = deferred();
      const view = await mount({ send: () => admission.promise });
      try {
        await attachImage(view.node);
        await act(async () => view.node.querySelector('[data-chat-composer-send]').click());
        await settle(() => view.calls.send.length === 1);
        assert.doesNotMatch(view.node.textContent, /继续这条消息|上一条消息的受理结果尚未确认/u);
        await act(async () => admission.reject(new Error('Transport unavailable')));
        await settle(() => view.node.textContent.includes('继续这条消息'));
        assert.match(view.node.textContent, /原来的问题/u);
      } finally { await view.close(); }
    });

    await t.test('taking back a pending message retains a separate newer draft', async () => {
      const view = await mount({ draft: '新的草稿', pending: { requestId: 'old-request', conversationAnchorId: 'anchor-A', text: '尚未确认的问题', artifactIds: [] } });
      try {
        await clickText(view.node, '取回文字作为草稿');
        assert.equal(view.node.querySelector('textarea').value, '新的草稿\n\n尚未确认的问题');
      } finally { await view.close(); }
    });

    await t.test('late completion from a different partner cannot clear the current draft', async () => {
      const admission = deferred();
      const view = await mount({ send: () => admission.promise });
      try {
        await attachImage(view.node);
        await act(async () => view.node.querySelector('[data-chat-composer-send]').click());
        await settle(() => view.calls.send.length === 1);
        await act(async () => { await view.navigation.push({ id: 'partner', agentHandle: agents[1].agentHandle }); });
        await settle(() => !view.node.querySelector('textarea').disabled);
        assert.doesNotMatch(view.node.textContent, /original\.png/u, 'the previous partner image must not enter the new composer');
        await type(view.node, '留给第二位伙伴的草稿');
        await act(async () => admission.resolve({ turnId: 'accepted-turn' }));
        assert.equal(view.node.querySelector('textarea').value, '留给第二位伙伴的草稿');
        assert.equal(view.records.get(draftPath(agents[1])).draft, '留给第二位伙伴的草稿');
      } finally { await view.close(); }
    });

    await t.test('unsent images remain with their original partner when switching back', async () => {
      const view = await mount();
      try {
        await attachImage(view.node);
        await act(async () => { await view.navigation.push({ id: 'partner', agentHandle: agents[1].agentHandle }); });
        await settle(() => !view.node.querySelector('textarea').disabled);
        assert.doesNotMatch(view.node.textContent, /original\.png/u);
        await attachImage(view.node, 'second.png');
        await act(async () => { await view.navigation.push({ id: 'partner', agentHandle: agents[0].agentHandle }); });
        await settle(() => !view.node.querySelector('textarea').disabled);
        assert.match(view.node.textContent, /original\.png/u);
        assert.doesNotMatch(view.node.textContent, /second\.png/u);
      } finally { await view.close(); }
    });

    await t.test('draft save and regeneration failures remain visible', async () => {
      let unavailable = true;
      const view = await mount({ write: async () => { if (unavailable) throw new Error('Storage unavailable'); },
        allocateError: new Error('Request unavailable'), chat: { regenerateTurnId: 'earlier-turn' } });
      try {
        await type(view.node, '需要保存的草稿');
        assert.match(view.node.textContent, /草稿尚未保存/u);
        unavailable = false;
        await clickText(view.node, '重试保存');
        assert.doesNotMatch(view.node.textContent, /草稿尚未保存/u);
        await clickText(view.node, '重新回答原问题');
        assert.match(view.node.textContent, /消息尚未发送，原输入已保留/u);
        assert.equal(view.node.querySelector('textarea').value, '需要保存的草稿');
      } finally { await view.close(); }
    });

    await t.test('media can be stopped by its owner turn while the composer stays available', async () => {
      const view = await mount({ chat: { state: 'media-pending', messageCount: 1, messages: [{
        id: 'answer', sessionId: 'anchor-A', targetId: agents[0].agentHandle, source: 'agent', role: 'agent', kind: 'text',
        text: '文字已完成', status: 'complete', createdAt: '', metadata: { canonicalMediaRunning: true, canonicalTurnId: 'media-turn' },
      }] } });
      try {
        await clickText(view.node, '停止生成媒体');
        assert.deepEqual(view.calls.interrupt, [{ agentHandle: agents[0].agentHandle, conversationAnchorId: 'anchor-A', expectedTurnId: 'media-turn' }]);
        assert.equal(view.node.querySelector('textarea').disabled, false);
      } finally { await view.close(); }
    });
  } finally {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
