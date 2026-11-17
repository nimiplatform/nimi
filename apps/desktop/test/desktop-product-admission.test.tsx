import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { NimiProductControlRecordProjection } from '@nimiplatform/sdk/runtime';
import { useDesktopProductAdmission } from '../src/shell/renderer/app-shell/routes/desktop-product-admission.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings, DesktopRendererEventPort } from '../src/shell/renderer/renderer/contract.js';
import type { DesktopHomeProfileStatus } from '../src/shell/renderer/bridge/runtime-bridge/product-control.js';

test('current Product Control refusal and transport loss close admission and discard stale Host readiness', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const globals = { window: dom.window, document: dom.window.document, React, IS_REACT_ACT_ENVIRONMENT: true };
  const prior = Object.getOwnPropertyDescriptors(globalThis);
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  type Listener = Parameters<DesktopRendererEventPort['subscribeProductControlRecord']>[0];
  let publish!: Listener;
  let current!: ReturnType<typeof useDesktopProductAdmission>;
  const profileReads: Array<{
    resolve: (status: DesktopHomeProfileStatus) => void;
    reject: (error: Error) => void;
  }> = [];
  let admissionRequests = 0;
  const bindings = { app: {
    commands: { firstRun: {
      getHomeProfileStatus: () => new Promise<DesktopHomeProfileStatus>((resolve, reject) => { profileReads.push({ resolve, reject }); }),
      admitReadyForUse: async () => { admissionRequests++; return projection('not_logged_in').projection; },
    } },
    events: { subscribeProductControlRecord: (fn: Listener) => { publish = fn; return () => undefined; } },
  } } as unknown as DesktopCanonicalRendererBindings;
  function Observe() {
    current = useDesktopProductAdmission('authenticated');
    return null;
  }
  const projection = (state: NimiProductControlRecordProjection['state']) => ({
    ok: true as const, projection: { exists: true, state, path: '/projection', error: null, record: null },
  });
  const readyProfile = { mode: 'root', workAllowed: true, relaunchRequested: false } as const;
  try {
    await act(async () => root.render(<DesktopRendererBindingProvider bindings={bindings}><Observe /></DesktopRendererBindingProvider>));
    await act(async () => publish(projection('ready_for_use')));
    assert.equal(profileReads.length, 1);
    await act(async () => publish(projection('ready_for_use')));
    assert.equal(profileReads.length, 1, 'a slow Host check does not amplify reads');
    await act(async () => publish(projection('repair_required')));
    await act(async () => profileReads[0]!.resolve(readyProfile));
    assert.equal(current.admission, 'first-run');
    assert.equal(current.projection?.state, 'repair_required');
    assert.equal(current.homeProfile, null);

    await act(async () => publish({ ok: false, error: 'temporarily unavailable' }));
    assert.equal(current.admission, 'unavailable');
    assert.equal(current.projection, null);
    assert.equal(admissionRequests, 0);
    await act(async () => profileReads[1]!.resolve({ ...readyProfile, workAllowed: false, sourceRuntimeRestartRequired: true }));
    assert.equal(current.admission, 'unavailable');
    assert.equal(current.homeProfile?.sourceRuntimeRestartRequired, true);
    await act(async () => publish(projection('ready_for_use')));
    await act(async () => profileReads[2]!.reject(new Error('unknown Host status')));
    assert.equal(current.profileUnavailable, true);
    assert.equal(current.homeProfile, null);
    await act(async () => publish(projection('ready_for_use')));
    await act(async () => profileReads[3]!.resolve({ ...readyProfile, workAllowed: false }));
    assert.equal(current.profileUnavailable, false);
    assert.equal(current.homeProfile?.workAllowed, false);
    await act(async () => publish(projection('ready_for_use')));
    await act(async () => profileReads[4]!.resolve(readyProfile));
    assert.equal(current.homeProfile?.workAllowed, true);

    await act(async () => publish(projection('not_logged_in')));
    assert.equal(current.admission, 'admission-failed');
    await act(async () => publish(projection('not_logged_in')));
    assert.equal(admissionRequests, 1);
    await act(async () => current.retry());
    assert.equal(admissionRequests, 2);
    await act(async () => publish(projection('ready_for_use')));
    await act(async () => profileReads[5]!.resolve(readyProfile));
    assert.equal(current.admission, 'ready');
    assert.equal(current.homeProfile?.workAllowed, true);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const key of Object.keys(globals)) {
      if (prior[key]) Object.defineProperty(globalThis, key, prior[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
