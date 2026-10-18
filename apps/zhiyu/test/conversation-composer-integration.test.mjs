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
    Node: dom.window.Node, DocumentFragment: dom.window.DocumentFragment,
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
    const calls = { send: [], interrupt: [] };
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
          return { ...initial, runtime: { ...initial.runtime, ready: true }, auth: { ...initial.auth, ready: true, accountId: 'account' },
            source: { ...initial.source, ready: true }, inventory, localAgent: { ...initial.localAgent, ready: true, agentHandle },
            conversation: { ...initial.conversation, ready: true, agentHandle, conversationAnchorId: anchor(agentHandle), threadId: anchor(agentHandle) } };
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
        async openDesktopRuntimeSettings() {}, async openDesktopSelectPartner() {}, async launchAvatar() {},
      },
      events: {
        subscribeConversation({ agentHandle, conversationAnchorId, onChat, onStatus }) {
          const chat = { ...initial.chat, agentHandle, conversationAnchorId, state: 'completed', ready: true, textTurnId: null, ...options.chat };
          onChat(chat); onStatus('ready');
          return { async refresh() { onChat(chat); onStatus('ready'); }, close() {} };
        },
      },
    } };
    let navigation;
    function App() {
      navigation = useZhiyuNavigationOwner().navigation;
      return React.createElement(ZhiyuCanonicalApp, { bindings });
    }
    const node = document.createElement('div'); document.body.appendChild(node);
    const root = createRoot(node);
    await act(async () => root.render(React.createElement(ZhiyuNavigationOwner, null, React.createElement(App))));
    await settle(() => node.querySelector('textarea') && (options.pending || !node.querySelector('textarea').disabled));
    return { node, calls, records, navigation, async close() { await act(async () => root.unmount()); node.remove(); } };
  };
  try {
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
