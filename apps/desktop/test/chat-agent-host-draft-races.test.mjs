// Isolated scheduling probe. Runtime ports below are scripted; this is not product acceptance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
test('Home host failures preserve newer drafts and roll back image-only optimistic messages', async () => {
const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react');
const { act, useState } = React;
const { JSDOM } = require('jsdom');
const { QueryClient } = require('@tanstack/react-query');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  Element: dom.window.Element, Node: dom.window.Node, DocumentFragment: dom.window.DocumentFragment,
  MutationObserver: dom.window.MutationObserver, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
  getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), React, IS_REACT_ACT_ENVIRONMENT: true };
const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { createRoot } = require('react-dom/client');
const { AgentCanonicalComposer } = await import('../src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx');
const { useAgentConversationHostActions } = await import('../src/shell/renderer/features/chat/chat-agent-shell-host-actions.ts');
const { useAgentConversationEffects } = await import('../src/shell/renderer/features/chat/chat-agent-shell-effects.ts');
const { createAgentVisibleProjectionStore } = await import('../src/shell/renderer/features/chat/chat-agent-visible-projection-store.ts');
const { AgentVisibleProjectionProvider } = await import('../src/shell/renderer/features/chat/chat-agent-visible-projection-context.tsx');
const { StreamControllerProvider } = await import('../src/shell/renderer/features/turns/stream-controller-context.tsx');
const { createTestStreamController } = await import('./helpers/test-stream-controller.ts');
const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.ts');
const { createAgentComposerDraftRef } = await import('../src/shell/renderer/features/chat/chat-agent-composer-draft.ts');
const { bundleQueryKey } = await import('../src/shell/renderer/features/chat/chat-agent-shell-core.ts');
const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.ts');
await initI18n(); await changeLocale('en');
const target = { agentHandle: 'agent-a', conversationAnchorId: 'anchor-1', displayName: 'Agent A', handle: '', avatarUrl: null,
  worldId: null, worldName: null, bio: null, ownershipType: null, greeting: null, builtinDocsContext: null };
const thread = { id: 'agent-thread:anchor-1', title: 'Agent A', createdAtMs: 1, updatedAtMs: 1, lastMessageAtMs: null, targetSnapshot: target };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const nextTick = () => new Promise(resolve => setImmediate(resolve));
const t = (key, options) => options?.defaultValue ?? key;
const png = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], 'image.png', { type: 'image/png' });
const attachment = () => ({ kind: 'image', name: png.name, file: png, previewUrl: URL.createObjectURL(png) });

try {
for (const direct of [false, true]) for (const scenario of ['open_then_success', 'upload_then_failure', 'terminal_failure_with_new_attachment', 'image_only_upload_failure', 'image_only_projection_failure', 'image_retry_success', 'image_retry_failure', 'image_retry_attachment_failure']) {
  const imageRetry = scenario.startsWith('image_retry_');
  const attachmentDraft = scenario === 'image_retry_attachment_failure';
  if (imageRetry && !direct) continue;
  const imageOnly = scenario.startsWith('image_only_');
  const projectionFailure = scenario === 'image_only_projection_failure';
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  const draft = createAgentComposerDraftRef(store, 'account-1', 'agent-a');
  draft.current = imageOnly || attachmentDraft ? '' : imageRetry ? 'Keep my unsent draft' : 'Submitted earlier';
  const controller = createTestStreamController();
  const projections = createAgentVisibleProjectionStore();
  const queryClient = new QueryClient();
  const originalMessages = imageOnly ? [{ id: 'prior-message', threadId: thread.id, role: 'assistant', kind: 'text', status: 'complete', contentText: 'Already committed' }] : [];
  const bundle = imageOnly ? { thread, messages: originalMessages } : null;
  if (bundle) queryClient.setQueryData(bundleQueryKey(thread.id), bundle);
  const open = deferred(), upload = deferred(), projection = deferred(), terminal = deferred();
  let reachedUpload = false, reachedRead = false, reachedTurn = false, retrySubmit, sentText;
  const conversation = {
    open: async () => { if (scenario === 'open_then_success') await open.promise; return { conversationAnchorId: 'anchor-1' }; },
    uploadAttachment: async () => { reachedUpload = true; return projectionFailure ? { artifactId: 'uploaded-image' } : await upload.promise; },
    readArtifact: async () => { reachedRead = true; return await projection.promise; },
  };
  const runAgentTurn = async function* (input) {
    sentText = input.userMessage.text;
    reachedTurn = true;
    await terminal.promise;
    yield { type: 'turn-completed', turnId: 't1', outputText: 'Scripted terminal event', reasoningText: '' };
  };
  function Harness({ initialAttachments }) {
    const [submittingThreadId, setSubmittingThreadId] = useState(null);
    const [, setFooterHostStateByThreadId] = useState({});
    const [attachments, setAttachments] = useState(initialAttachments);
    const effects = useAgentConversationEffects({ currentComposerTextRef: draft, queryClient, setFooterHostStateByThreadId, setSelection() {} });
    const { handleSubmit } = useAgentConversationHostActions({ now: Date.now, sdk: { conversation: () => conversation }, subjectUserId: 'account-1',
      streamController: controller, activeTarget: target, activeThreadId: thread.id, ...effects,
      bundle, currentComposerTextRef: draft, pendingAttachments: attachments, queryClient, reportHostError() {}, runAgentTurn,
      selectedAgentHandle: target.agentHandle, selectedThreadRecord: scenario === 'open_then_success' ? null : thread,
      setSelectionForAgentHandle() {}, setSubmittingThreadId, clearSelectedTarget() {}, submittingThreadId,
      t, textModelContextTokens: null, textMaxOutputTokensRequested: null,
      targetByAgentHandle: new Map([[target.agentHandle, target]]), targetsReady: true, threads: [thread], threadsReady: true });
    retrySubmit = handleSubmit;
    return React.createElement(AgentCanonicalComposer, { composerKey: 'same-agent', initialText: draft.current,
      disabled: Boolean(submittingThreadId), placeholder: 'Draft', pendingAttachments: attachments,
      onAttachmentsChange: setAttachments, onInputCaptureText: text => { draft.current = text; }, onSubmit: direct ? ({ text, attachments }) => handleSubmit({ text, attachments }) : handleSubmit });
  }
  const mount = async (attachments) => {
    const node = document.createElement('div'); document.body.append(node);
    const root = createRoot(node);
    await act(async () => root.render(React.createElement(StreamControllerProvider, { controller },
      React.createElement(AgentVisibleProjectionProvider, { store: projections }, React.createElement(Harness, { initialAttachments: attachments })))));
    return { root, node };
  };
  const first = await mount(scenario === 'upload_then_failure' || imageOnly || attachmentDraft ? [attachment()] : []);
  if (imageRetry) {
    let completion;
    await act(async () => { completion = retrySubmit({ text: 'Earlier image prompt', attachments: [] }).catch(() => {}); await nextTick(); });
    assert.equal(sentText, 'Earlier image prompt', 'retry must not send the unsent draft');
    assert.equal(draft.current, attachmentDraft ? '' : 'Keep my unsent draft');
    await act(async () => {
      if (scenario.endsWith('_failure')) terminal.reject(new Error('scripted retry failure'));
      else terminal.resolve();
      await completion;
    });
    assert.equal(draft.current, attachmentDraft ? '' : 'Keep my unsent draft');
    assert.equal(first.node.querySelector('textarea').value, draft.current);
    if (attachmentDraft) assert.equal(first.node.querySelectorAll('img').length, 1);
    await act(async () => first.root.unmount());
    controller.clearAllStreams(); queryClient.clear();
    continue;
  }
  const originalPreview = first.node.querySelector('img')?.src;
  await act(async () => first.node.querySelector('[data-chat-composer-send]').click());
  assert.equal(draft.current, '');
  if (imageOnly) {
    assert.equal(reachedUpload, true);
    assert.equal(reachedRead, projectionFailure);
    const optimistic = queryClient.getQueryData(bundleQueryKey(thread.id));
    assert.equal(optimistic.messages.length, 2, 'the real submit added an optimistic image');
    assert.equal(optimistic.messages[1].kind, 'image');
    await act(async () => {
      (projectionFailure ? projection : upload).reject(new Error('scripted image preparation failure'));
      await nextTick();
    });
    assert.deepEqual(queryClient.getQueryData(bundleQueryKey(thread.id)).messages, originalMessages, scenario);
    assert.deepEqual(projections.get(thread.id).messages, originalMessages, 'visible projection must also roll back');
    assert.equal(reachedTurn, false, 'attachment failure must not dispatch a model turn');
    assert.equal(draft.current, '');
    assert.equal(first.node.querySelectorAll('img').length, 1, 'failed attachment remains editable');
    assert.notEqual(first.node.querySelector('img').src, originalPreview, 'restored image gets a fresh preview URL');
    await act(async () => first.root.unmount());
    controller.clearAllStreams(); queryClient.clear();
    continue;
  }
  if (scenario === 'upload_then_failure') assert.equal(reachedUpload, true);
  if (scenario === 'terminal_failure_with_new_attachment') assert.equal(reachedTurn, true);
  await act(async () => first.root.unmount());
  const second = await mount(scenario === 'terminal_failure_with_new_attachment' ? [attachment()] : []);
  const field = second.node.querySelector('textarea');
  assert.equal(field.disabled, false, 'the newly mounted composer should be editable');
  if (scenario !== 'terminal_failure_with_new_attachment') await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(field, 'New unsent draft');
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const before = draft.current;
  if (scenario === 'open_then_success') await act(async () => { open.resolve(); await nextTick(); terminal.resolve(); await nextTick(); });
  if (scenario === 'upload_then_failure') await act(async () => { upload.reject(new Error('scripted upload failure')); await nextTick(); });
  if (scenario === 'terminal_failure_with_new_attachment') await act(async () => { terminal.reject(new Error('scripted transport failure')); await nextTick(); });
  assert.equal(draft.current, before, scenario);
  assert.equal(field.value, before, 'visible draft must match the preserved store');
  if (scenario === 'terminal_failure_with_new_attachment') assert.equal(second.node.querySelectorAll('img').length, 1);
  await act(async () => second.root.unmount());
  controller.clearAllStreams(); queryClient.clear();
}
} finally {
  dom.window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
}
});
