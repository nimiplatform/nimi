import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('Home composer preserves a newer same-Agent draft after an old component settles, while live failures remain editable', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Element: dom.window.Element, Node: dom.window.Node, DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { AgentCanonicalComposer } = await import('../src/shell/renderer/features/chat/chat-agent-canonical-composer.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { createAgentComposerDraftRef } = await import('../src/shell/renderer/features/chat/chat-agent-composer-draft.js');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  await initI18n(); await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  const draft = createAgentComposerDraftRef(store, 'account-test', 'same-agent');
  const mounts: ReturnType<typeof createRoot>[] = [];
  const mount = async (onSubmit: () => Promise<void>) => {
    const node = dom.window.document.createElement('div'); dom.window.document.body.append(node);
    const root = createRoot(node); mounts.push(root);
    await act(async () => root.render(<AgentCanonicalComposer composerKey="same-agent" initialText={draft.current}
      disabled={false} placeholder="Draft" pendingAttachments={[]} onAttachmentsChange={() => {}}
      onInputCaptureText={text => { draft.current = text; }} onSubmit={onSubmit} />));
    return { root, node };
  };
  try {
    for (const failed of [true, false]) {
      draft.current = 'Submitted earlier';
      let finishOld!: () => void;
      const pending = new Promise<void>((resolve, reject) => { finishOld = () => failed
        ? reject(Object.assign(new Error('Content blocked'), { reasonCode: 'AI_CONTENT_FILTER_BLOCKED' })) : resolve(); });
      const first = await mount(() => pending);
      await act(async () => (first.node.querySelector('[data-chat-composer-send]') as HTMLButtonElement).click());
      assert.equal(draft.current, 'Submitted earlier', 'input must stay available until the submission copy and admission settle');
      await act(async () => first.root.unmount()); mounts.splice(mounts.indexOf(first.root), 1);
      const second = await mount(async () => { throw new Error('Input refused'); });
      const field = second.node.querySelector('textarea')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'New unsent draft');
        field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
      assert.equal(draft.current, 'New unsent draft');
      await act(async () => finishOld());
      assert.equal(draft.current, 'New unsent draft');
      await act(async () => second.root.unmount()); mounts.splice(mounts.indexOf(second.root), 1);
    }
    const third = await mount(async () => { throw new Error('Input refused'); });
    assert.equal((third.node.querySelector('textarea') as HTMLTextAreaElement).value, 'New unsent draft');
    await act(async () => (third.node.querySelector('[data-chat-composer-send]') as HTMLButtonElement).click());
    assert.equal(draft.current, 'New unsent draft');
    assert.equal((third.node.querySelector('textarea') as HTMLTextAreaElement).value, 'New unsent draft');
  } finally {
    for (const root of mounts) await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
