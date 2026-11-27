import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { RouteAndSubmitOutcome, type RouteAndSubmitInputRequest } from '@nimiplatform/sdk/runtime/generated';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import type { LocalAgentListItem } from '../src/shell/renderer/features/agents/local-agent-list-model.js';

function makePartner(localAgentRef: string, displayName: string): LocalAgentListItem {
  return {
    localAgentRef,
    ownerUserId: 'user-1',
    runtimeSourceRef: `src:${localAgentRef}`,
    displayName,
    sourceRef: {
      kind: 'persona_character',
      worldId: 'world-1',
      id: localAgentRef,
      sourceHash: 'hash-1',
    } as LocalAgentListItem['sourceRef'],
    sourceKey: `persona:${localAgentRef}`,
  };
}

test('HomeOmniComposer hides idle top pill, folds single partner into placeholder, and embeds partner picker inside the composer toolbar for multi-partner accounts', async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    SVGElement: dom.window.SVGElement,
    MutationObserver: dom.window.MutationObserver,
    ResizeObserver: ResizeObserverStub,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => (previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key)));
  }

  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { HomeOmniComposer } = await import('../src/shell/renderer/features/home/home-omni-composer.js');

  await initI18n();
  await changeLocale('zh');

  const calls: RouteAndSubmitInputRequest[] = [];
  const sessions = {
    listSessions: async () => ({ items: [] }),
    async routeAndSubmitInput(request: RouteAndSubmitInputRequest) {
      calls.push(request);
      return {
        outcome: RouteAndSubmitOutcome.ACCEPTED,
        sessionKind: 'general_inbox',
        ownerBodyKind: 'brain',
        resolvedWorkSessionRef: 'ws-inbox-1',
      };
    },
    subscribeBrainSessionEvents: async function* () {},
  };
  const bindings = {
    app: { commands: {} },
    sdk: { accountProduct: () => ({ sessions }) },
  } as unknown as DesktopCanonicalRendererBindings;

  const doc = dom.window.document;
  const root = createRoot(doc.getElementById('root')!);
  const partnerA = makePartner('agent-laurent', '洛朗·德·瓦尔蒙');
  const partnerB = makePartner('agent-lin', '林知夏');

  let openedAllCount = 0;
  let exploredCount = 0;

  const renderComposer = async (partners: readonly LocalAgentListItem[], partnersLoaded = true) => {
    await act(async () => {
      root.render(
        <DesktopRendererBindingProvider bindings={bindings}>
          <HomeOmniComposer
            accountKey="acct-home-test"
            partners={partners}
            partnersLoaded={partnersLoaded}
            onOpenHarness={() => {}}
            onOpenModelSwitch={() => {}}
            onOpenHumanChatDraft={() => {}}
            onOpenPartnerZhiyu={() => {}}
            onOpenAllPartners={() => { openedAllCount += 1; }}
            onExplorePartners={() => { exploredCount += 1; }}
          />
        </DesktopRendererBindingProvider>,
      );
    });
  };

  try {
    // 0. Zero partners (loaded): shows compact Add partner CTA inside composer toolbar instead of external strip.
    await renderComposer([], true);
    assert.equal(doc.querySelector('[data-testid="home-omni-default-partner-bar"]'), null);
    const addPartnerBtn = doc.querySelector<HTMLButtonElement>('[data-testid="home-omni-add-partner-trigger"]');
    assert.ok(addPartnerBtn, 'add partner CTA should appear when loaded with zero partners');
    await act(async () => {
      addPartnerBtn.click();
    });
    assert.equal(exploredCount, 1);

    // 1. Single partner idle state: inline partner pill is shown inside composer toolbar with Manage all partners link.
    await renderComposer([partnerA]);
    assert.equal(doc.querySelector('[data-testid="home-omni-context-pills"]'), null);
    assert.equal(doc.querySelector('[data-testid="home-omni-target-pill:auto"]'), null);
    assert.equal(doc.querySelector('[data-testid="home-omni-add-partner-trigger"]'), null);
    const singleComposerForm = doc.querySelector('[data-testid="home-quick-start-bar"]')!;
    assert.ok(singleComposerForm.querySelector('[data-testid="home-omni-default-partner-bar"]'));
    const singleTrigger = doc.querySelector<HTMLButtonElement>('[data-testid="home-omni-default-partner-trigger"]')!;
    assert.match(singleTrigger.textContent ?? '', /洛朗·德·瓦尔蒙/);
    await act(async () => {
      singleTrigger.click();
    });
    const manageAllBtn = doc.querySelector<HTMLButtonElement>('[data-testid="home-omni-manage-all-partners"]');
    assert.ok(manageAllBtn, 'partner menu should expose Manage all partners entry');
    await act(async () => {
      manageAllBtn.click();
    });
    assert.equal(openedAllCount, 1);
    const input = doc.querySelector<HTMLTextAreaElement>('[data-testid="home-quick-start-input"]')!;
    assert.match(input.placeholder, /洛朗·德·瓦尔蒙/);

    // 2. Multi-partner idle state: still no top pills inside form, inline default-partner picker nested inside composer toolbar.
    await renderComposer([partnerA, partnerB]);
    assert.equal(doc.querySelector('[data-testid="home-omni-context-pills"]'), null);
    const composerForm = doc.querySelector('[data-testid="home-quick-start-bar"]')!;
    const bar = composerForm.querySelector('[data-testid="home-omni-default-partner-bar"]');
    assert.ok(bar, 'inline default partner picker should render inside composer when multiple partners exist');
    assert.match(bar.textContent ?? '', /默认伙伴/);
    assert.doesNotMatch(bar.textContent ?? '', /智能分流|临时换人/);
    assert.ok(composerForm.querySelector('[data-testid="home-omni-trigger-hints"]'), 'composer should expose @ / ~ / # quick trigger hints');

    const trigger = doc.querySelector<HTMLButtonElement>('[data-testid="home-omni-default-partner-trigger"]')!;
    assert.match(trigger.textContent ?? '', /洛朗·德·瓦尔蒙/);

    // Open dropdown and pin the second partner.
    await act(async () => {
      trigger.click();
    });
    const optionB = doc.querySelector<HTMLButtonElement>('[data-testid="home-omni-default-partner-option:agent-lin"]')!;
    assert.ok(optionB, 'partner picker popover should list second partner');
    await act(async () => {
      optionB.click();
    });
    assert.match(trigger.textContent ?? '', /林知夏/);
    assert.equal(dom.window.localStorage.getItem('nimi.home.omni.pinnedPartner:acct-home-test'), 'agent-lin');

    // Free-text submit uses the newly pinned default partner handle.
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '帮我总结一下');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    const submit = doc.querySelector<HTMLButtonElement>('[data-testid="home-quick-start-submit"]')!;
    await act(async () => {
      submit.click();
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.agentHandle, 'agent-lin');

    // 3. Explicit ~ partner target expands top pills row on demand and hides external bar; clearing collapses back.
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '~洛朗');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    const triggerOption = doc.querySelector('[role="option"]')!;
    assert.ok(triggerOption);
    await act(async () => {
      triggerOption.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
    });
    assert.ok(doc.querySelector('[data-testid="home-omni-context-pills"]'));
    assert.ok(doc.querySelector('[data-testid="home-omni-target-pill:partner"]'));
    assert.equal(doc.querySelector('[data-testid="home-omni-default-partner-bar"]'), null);

    const clearTargetBtn = doc.querySelector<HTMLButtonElement>('[data-testid="home-omni-target-pill:partner"] button[aria-label="清除目标"]')!;
    await act(async () => {
      clearTargetBtn.click();
    });
    assert.equal(doc.querySelector('[data-testid="home-omni-context-pills"]'), null);
    assert.ok(doc.querySelector('[data-testid="home-omni-default-partner-bar"]'));

    // 4. Clicking a quiet ~ partner hint button inserts ~ and opens partner autocomplete.
    const partnerHintBtn = doc.querySelector<HTMLButtonElement>('[data-testid="home-omni-hint:partner"]')!;
    await act(async () => {
      partnerHintBtn.click();
    });
    assert.equal(input.value, '~');
    assert.ok(doc.querySelector('[data-testid="home-omni-trigger-popover:partner"]'));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
