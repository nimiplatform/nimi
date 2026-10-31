import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { JsonObject } from '@nimiplatform/sdk/types';
import { toHumanProfileData } from '../src/shell/renderer/features/profile/profile-model.js';

test('public profile editor', async t => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  class Observer { observe() {} unobserve() {} disconnect() {} }
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, Element: dom.window.Element,
    HTMLFormElement: dom.window.HTMLFormElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement, Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle, ResizeObserver: Observer,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale, productionDesktopI18n } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopI18nResourceProvider } = await import('../src/shell/renderer/i18n/i18n-context.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { PublicProfileEditor } = await import('../src/shell/renderer/features/profile/public-profile-editor.js');
  await initI18n(); await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  await store.navigation.push({ id: 'settings', settingsSection: 'profile' });
  const profile = toHumanProfileData({ id: 'alice', handle: 'alice', displayName: 'Alice', bio: 'Saved bio', city: 'Paris' });
  const updates: JsonObject[] = [];
  let fail = true;
  const root = createRoot(dom.window.document.getElementById('root')!);
  const button = (text: string) => [...dom.window.document.querySelectorAll('button')].find(element => element.textContent === text) as HTMLButtonElement;
  const bio = () => dom.window.document.querySelector('textarea')!;
  const typeBio = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(bio(), value);
      bio().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  try {
    await t.test('the draft requires explicit save and survives preview, failure and controlled departure', async () => {
      await act(async () => { root.render(<AppStoreProvider store={store}><DesktopI18nResourceProvider resource={productionDesktopI18n}><DesktopMotionProvider>
        <PublicProfileEditor profile={profile} onUploadAvatar={async () => { throw new Error('Upload not exercised'); }}
          onSave={async patch => { updates.push(patch); if (fail) throw new Error('Could not save'); return { ...profile, bio: String(patch.bio) }; }} />
      </DesktopMotionProvider></DesktopI18nResourceProvider></AppStoreProvider>); });
      await typeBio('Unsaved draft');
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 750)); });
      assert.equal(updates.length, 0, 'public changes must not autosave');
      await act(async () => { button('Preview').click(); });
      assert.match(dom.window.document.querySelector('[data-testid="profile-draft-preview"]')!.textContent!, /Unsaved draft/);
      await act(async () => { button('Continue editing').click(); });
      assert.equal(bio().value, 'Unsaved draft');
      await act(async () => { button('Save profile').click(); });
      assert.deepEqual(updates, [{ bio: 'Unsaved draft' }]);
      assert.equal(bio().value, 'Unsaved draft');
      assert.match(dom.window.document.body.textContent!, /Could not save/);
      let leave!: ReturnType<typeof store.navigation.push>;
      await act(async () => { leave = store.navigation.push({ id: 'home' }); await new Promise(resolve => setTimeout(resolve, 50)); });
      assert.equal(updates.length, 1, 'navigation must not publish the draft automatically');
      assert.ok(button('Save and leave'));
      const continueButtons = [...dom.window.document.querySelectorAll('button')].filter(element => element.textContent === 'Continue editing');
      await act(async () => { continueButtons.at(-1)!.click(); await leave; });
      assert.equal(store.navigation.getSnapshot().current.destination.id, 'settings');
      assert.equal(bio().value, 'Unsaved draft');
      fail = false;
      await act(async () => { button('Save profile').click(); });
      assert.equal(updates.length, 2);
      assert.equal(button('Save profile').disabled, true);
      await typeBio('Another draft');
      await act(async () => { button('Cancel').click(); });
      assert.equal(bio().value, 'Unsaved draft', 'cancel returns to the latest saved owner profile');
    });

    await t.test('switching accounts during avatar hashing stops the settings upload before Realm preparation', async () => {
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
      const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
      const { RealmSocialDataProvider } = await import('../src/shell/renderer/features/social/data/realm-social-data-context.js');
      const { currentUserProfileQueryKey } = await import('../src/shell/renderer/features/profile/current-user-profile.js');
      const { ProfilePage } = await import('../src/shell/renderer/features/settings/settings-account-panel.js');
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
      const project = (id: string) => store.getState().applyRuntimeAccountProjection({
        status: 'authenticated', user: { id, realmEnvironmentId: 'realm' }, sequence: '1',
        reasonCode: 0, accountReasonCode: 0, authorizationRevision: id,
      });
      for (const id of ['alice', 'bob']) queryClient.setQueryData(currentUserProfileQueryKey('', 'realm', id, id), { id, handle: id, displayName: id });
      let prepareCalls = 0;
      const bindings = { sdk: { realm: () => ({
        account: { getMyHandleChangeEligibility: async () => ({
          handle: '@alice', canChange: true, minLength: 4, maxLength: 16, pattern: '^[a-z0-9_]+$', nextEligibleAt: null,
        }) },
        resources: { createImageDirectUpload: async () => { prepareCalls++; throw Error('unexpected prepare'); } },
      }) } };
      project('alice');
      await act(async () => root.render(<AppStoreProvider store={store}><DesktopI18nResourceProvider resource={productionDesktopI18n}>
        <DesktopMotionProvider><DesktopRendererBindingProvider bindings={bindings as never}><QueryClientProvider client={queryClient}>
          <RealmSocialDataProvider resource={{} as never}><ProfilePage /></RealmSocialDataProvider>
        </QueryClientProvider></DesktopRendererBindingProvider></DesktopMotionProvider>
      </DesktopI18nResourceProvider></AppStoreProvider>));
      let release!: (bytes: ArrayBuffer) => void;
      const file = new File(['image'], 'avatar.png', { type: 'image/png' });
      const chunk = new Promise<ArrayBuffer>(resolve => { release = resolve; });
      let reading = false;
      Object.defineProperty(file, 'slice', { value: () => ({ arrayBuffer() { reading = true; return chunk; } }) });
      const input = dom.window.document.querySelector<HTMLInputElement>('input[type=file]')!;
      Object.defineProperty(input, 'files', { value: [file] });
      await act(async () => { input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
      assert.ok(reading);
      await act(async () => { project('bob'); release(new ArrayBuffer(file.size)); });
      assert.equal(prepareCalls, 0);
      queryClient.clear();
    });
  } finally {
    await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 40)); }); store.navigation.dispose(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
  }
});
