/**
 * 更新 pane of the installed-App properties dialog proof.
 *
 * Renders AppsUpdateSection under jsdom with an installed fixture that has a
 * newer Registry version, and asserts the policy select, the pending-update
 * action, the version facts, the installed version's release notes and license,
 * and the pending version's release notes all come from the real props rather
 * than fabricated state.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import {
  AppPackageSourceClass,
  type ApprovedAppCatalogTarget,
  type AppPackageInfo,
  type CommittedAppRelease,
  type GetAppPackageInfoRequest,
} from '@nimiplatform/sdk/runtime/wire-types';
import type { DesktopAppsEntry } from '../src/shell/renderer/features/apps/apps-panel-projection';
import type { AppCardActionId } from '../src/shell/renderer/features/apps/apps-card-actions';
import { writeAppUpdatePolicy } from '../src/shell/renderer/features/apps/apps-update-preferences';

function entryFixture(): DesktopAppsEntry {
  return {
    identity: {
      entryKey: 'verified:nimi.lab',
      appId: 'nimi.lab',
      sourceClass: 'verified',
      displayName: 'Nimi Lab',
      updatedAtUnixMs: 1_700_000_000_000,
    },
    catalogTarget: {
      policyBlocked: false,
      version: '0.2.0',
      approvedTargetSelector: new Uint8Array([1, 2, 3, 4]),
    } as unknown as ApprovedAppCatalogTarget,
    localDevelopment: null,
    committedRelease: {
      sourceClass: AppPackageSourceClass.VERIFIED,
      version: '0.1.6',
      committedAt: { seconds: '1757600000', nanos: 0 },
    } as unknown as CommittedAppRelease,
    packageJob: null,
    run: null,
    aiConfigSummary: null,
    iconUrl: null,
    summary: null,
    appInfo: {
      appId: 'nimi.lab',
      version: '0.1.6',
      releaseNotesMarkdown: '## 0.1.6\n- installed version notes',
      licenseIdentifier: 'Apache-2.0',
      licenseText: 'Apache License\nVersion 2.0',
    } as unknown as AppPackageInfo,
  };
}

test('Apps update section renders policy, pending update, version facts and release notes', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLFormElement: dom.window.HTMLFormElement,
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
  const { AppsUpdateSection } = await import('../src/shell/renderer/features/apps/apps-update-section.js');
  await initI18n();
  await changeLocale('en');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const actions: AppCardActionId[] = [];
  const infoRequests: GetAppPackageInfoRequest[] = [];
  const readPackageInfo = async (request: GetAppPackageInfoRequest): Promise<AppPackageInfo> => {
    infoRequests.push(request);
    return {
      appId: 'nimi.lab',
      version: '0.2.0',
      releaseNotesMarkdown: '## Fixes\n- sandbox escapes closed',
    } as AppPackageInfo;
  };
  try {
    await act(async () => {
      root.render(
        <AppsUpdateSection
          entry={entryFixture()}
          readPackageInfo={readPackageInfo}
          onAction={(action) => actions.push(action)}
          actionsDisabled={false}
          actionPending={false}
        />,
      );
    });
    const { document } = dom.window;
    const section = document.querySelector('[data-testid="apps-update-section"]');
    assert.ok(section, 'expected the update section');
    const policy = section.querySelector('[data-testid="apps-update-policy"]');
    assert.ok(policy, 'expected the auto-update policy select');
    assert.match(policy.textContent ?? '', /Notify me when an update is available/u);
    assert.match(section.querySelector('[data-testid="apps-update-available"]')?.textContent ?? '', /Update available: 0\.2\.0/u);
    const facts = section.textContent ?? '';
    assert.match(facts, /Installed version/u);
    assert.match(facts, /0\.1\.6/u);
    assert.match(facts, /Latest online version/u);
    assert.match(facts, /0\.2\.0/u);
    assert.match(facts, /Installed content updated/u);
    assert.match(facts, /2025/u);
    await act(async () => { await Promise.resolve(); });
    assert.equal(infoRequests.length, 1);
    assert.deepEqual([...infoRequests[0]!.approvedTargetSelector], [1, 2, 3, 4]);
    assert.equal(infoRequests[0]!.launchSelector.length, 0);
    assert.equal(infoRequests[0]!.installedReleaseRef, '');
    assert.match(section.querySelector('[data-testid="apps-update-notes"]')?.textContent ?? '', /sandbox escapes closed/u);
    const installedDocs = section.querySelector('[data-testid="apps-update-installed-documents"]');
    assert.ok(installedDocs, 'expected the installed version documents in the update pane');
    assert.match(installedDocs.textContent ?? '', /Version notes/u);
    assert.match(installedDocs.textContent ?? '', /installed version notes/u);
    assert.match(installedDocs.textContent ?? '', /License · Apache-2\.0/u);
    assert.match(installedDocs.textContent ?? '', /Apache License/u);
    assert.equal(installedDocs.textContent?.includes('How to use'), false, 'the readme stays in the documents pane');
    const updateNow = section.querySelector('[data-testid="apps-update-now"]');
    assert.ok(updateNow, 'expected the update action');
    await act(async () => {
      updateNow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert.deepEqual(actions, ['update']);
    // Persisting the auto policy through the real write path updates the select.
    await act(async () => {
      writeAppUpdatePolicy('nimi.lab', 'auto');
    });
    assert.match(section.querySelector('[data-testid="apps-update-policy"]')?.textContent ?? '', /Start updates automatically/u);
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
