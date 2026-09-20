import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { AppSafetyDeclaration } from '@nimiplatform/sdk/runtime/wire-types';

// The existing native-posture confirmation carries a short declaration
// summary, and an update confirmation shows the actual difference; the
// declaration adds no confirmation of its own. DOM globals are installed
// before any overlay module loads so the dialog portal mounts under jsdom.
function declaration(overrides: Partial<AppSafetyDeclaration> = {}): AppSafetyDeclaration {
  return {
    intendedAudience: 'general', contentDescriptors: [], aiDirectInteraction: true, aiInteractionNotice: 'absent', aiRiskFeatures: [], aiSubjectNotice: 'not-applicable',
    aiOutputs: [{ modality: 'text', exposure: 'exportable', publicationControl: 'not-applicable', inProductNotice: 'absent', exportVisibleMarking: 'absent', machineReadableMarking: 'absent' }],
    publisherDirectExternalNetwork: false, telemetry: [], thirdPartyAccount: 'none', userContentSharing: 'none', commercialFeatures: [], sensitiveDataCategories: [], highImpactDecisionUses: [],
    ...overrides,
  };
}

test('the existing install and update confirmations carry the declaration summary or difference inside the dialog', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.ts');
  const { AppsInstallConfirmationDialog } = await import('../src/shell/renderer/features/apps/apps-install-confirmation.js');
  await initI18n();
  await changeLocale('en');
  const intent = {
    approvedTargetSelector: new Uint8Array([1]), observedRegistryRevision: 'a'.repeat(40), descriptorId: 'publisher.example@1.2.0', targetId: 'windows-x86_64',
    appId: 'publisher.example', displayName: 'Example', publisherGithubNamespace: 'publisher', version: '1.2.0', assetName: 'example.nimiapp', assetSize: '42',
    os: 'windows' as const, windowsCodeSigning: 'unsigned' as const, macosNotarization: 'not-applicable' as const, observedSigningSubject: null,
    safetyDeclaration: declaration({ intendedAudience: 'teen' }),
  };
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => { root.render(<AppsInstallConfirmationDialog intent={intent} pending={false} onConfirm={() => {}} onClose={() => {}} />); });
    const dialog = dom.window.document.querySelector('[role="dialog"]');
    assert.ok(dialog, 'the unsigned confirmation dialog is open');
    assert.ok(dialog.querySelector('[data-testid="apps-safety-declaration-summary"]'), 'the existing confirmation carries the summary');
    assert.match(dialog.textContent ?? '', /Teens/u);
    assert.match(dialog.textContent ?? '', /Continue and install/u, 'the confirmation action is unchanged');
    await act(async () => {
      root.render(<AppsInstallConfirmationDialog intent={{ ...intent, update: { launchSelector: new Uint8Array([2]), installedVersion: '1.1.0', installedSafetyDeclaration: declaration() } }} pending={false} onConfirm={() => {}} onClose={() => {}} />);
    });
    const update = dom.window.document.querySelector('[role="dialog"]');
    assert.ok(update);
    const diff = update.querySelector('[data-testid="apps-safety-declaration-diff"]');
    assert.ok(diff, 'an update confirmation shows the actual declaration difference');
    assert.equal(diff.getAttribute('data-changes'), '1');
    assert.match(diff.textContent ?? '', /General audience/u);
    assert.match(diff.textContent ?? '', /Teens/u);
    await act(async () => {
      root.render(<AppsInstallConfirmationDialog intent={{ ...intent, safetyDeclaration: null }} pending={false} onConfirm={() => {}} onClose={() => {}} />);
    });
    assert.match(dom.window.document.querySelector('[role="dialog"]')?.textContent ?? '', /has not declared audience/u, 'an undeclared target reads as undeclared inside the confirmation');
  } finally {
    await act(async () => { root.unmount(); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
