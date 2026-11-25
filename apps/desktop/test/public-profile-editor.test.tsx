import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { JsonObject } from '@nimiplatform/sdk/types';
import { toHumanProfileData } from '../src/shell/renderer/features/profile/profile-model.js';

test('public profile editor', async (t) => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  class Observer { observe() {} unobserve() {} disconnect() {} }
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    Element: dom.window.Element,
    HTMLFormElement: dom.window.HTMLFormElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle,
    ResizeObserver: Observer,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale, productionDesktopI18n } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopI18nResourceProvider } = await import('../src/shell/renderer/i18n/i18n-context.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { PublicProfileEditor } = await import('../src/shell/renderer/features/profile/public-profile-editor.js');
  await initI18n();
  await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  await store.navigation.push({ id: 'settings', settingsSection: 'profile' });
  const profile = toHumanProfileData({
    id: 'alice',
    handle: 'alice',
    displayName: 'Alice',
    bio: 'Saved bio',
    city: 'Paris',
    countryCode: 'FR',
    languages: ['en', 'zh'],
    tags: ['design'],
  });
  const updates: JsonObject[] = [];
  let fail = true;
  const root = createRoot(dom.window.document.getElementById('root')!);
  const button = (text: string) => [...dom.window.document.querySelectorAll('button')]
    .find((element) => element.textContent?.trim() === text) as HTMLButtonElement | undefined;
  const bio = () => dom.window.document.querySelector('textarea')!;
  const typeBio = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(bio(), value);
      bio().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  try {
    await t.test('the draft requires explicit save, shows localized preview, and survives failure and controlled departure', async () => {
      const copied: string[] = [];
      let webHandoffCount = 0;
      await act(async () => {
        root.render(
          <AppStoreProvider store={store}>
            <DesktopI18nResourceProvider resource={productionDesktopI18n}>
              <DesktopMotionProvider>
                <PublicProfileEditor
                  profile={profile}
                  profileVisibility="FRIENDS"
                  onCopyHandle={async (handle) => { copied.push(handle); }}
                  onManageUsernameInWeb={async () => { webHandoffCount += 1; }}
                  onUploadAvatar={async () => { throw new Error('Upload not exercised'); }}
                  onSave={async (patch) => {
                    updates.push(patch);
                    if (fail) throw new Error('Could not save');
                    return { ...profile, bio: String(patch.bio ?? profile.bio) };
                  }}
                />
              </DesktopMotionProvider>
            </DesktopI18nResourceProvider>
          </AppStoreProvider>,
        );
      });

      // Clean state: no dirty bar, read-only handle display (not an <input>)
      assert.equal(dom.window.document.querySelector('[data-testid="profile-dirty-bar"]'), null);
      assert.equal(dom.window.document.querySelector('[data-testid="profile-readonly-handle"]')?.textContent, '@alice');
      assert.equal([...dom.window.document.querySelectorAll('input')].some((input) => input.value === '@alice'), false);

      // Copy handle & Web account handoff work cleanly without polluting draft
      await act(async () => { button('Copy username')!.click(); });
      assert.deepEqual(copied, ['@alice']);
      await act(async () => { button('Change in Web account')!.click(); });
      assert.equal(webHandoffCount, 1);

      // Edit bio -> no autosave, dirty bar appears with exact field summary
      await typeBio('Unsaved draft');
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 750)); });
      assert.equal(updates.length, 0, 'public changes must not autosave');
      assert.ok(dom.window.document.querySelector('[data-testid="profile-dirty-bar"]'));

      // Draft preview shows localized country ("France") and localized languages without hardcoded Chinese punctuation
      await act(async () => { button('Preview')!.click(); });
      const previewText = dom.window.document.querySelector('[data-testid="profile-draft-preview"]')!.textContent!;
      assert.match(previewText, /Unsaved draft/);
      assert.match(previewText, /Paris, France/);
      assert.doesNotMatch(previewText, /、/);
      await act(async () => { button('Continue editing')!.click(); });
      assert.equal(bio().value, 'Unsaved draft');

      // Failed save preserves unsaved input and exposes error
      await act(async () => { button('Save profile')!.click(); });
      assert.deepEqual(updates, [{ bio: 'Unsaved draft' }]);
      assert.equal(bio().value, 'Unsaved draft');
      assert.match(dom.window.document.body.textContent!, /Could not save/);

      // Controlled departure guards unsaved changes
      let leave!: ReturnType<typeof store.navigation.push>;
      await act(async () => {
        leave = store.navigation.push({ id: 'home' });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(updates.length, 1, 'navigation must not publish the draft automatically');
      assert.ok(button('Save and leave'));
      const continueButtons = [...dom.window.document.querySelectorAll('button')]
        .filter((element) => element.textContent?.trim() === 'Continue editing');
      await act(async () => { continueButtons.at(-1)!.click(); await leave; });
      assert.equal(store.navigation.getSnapshot().current.destination.id, 'settings');
      assert.equal(bio().value, 'Unsaved draft');

      // Successful save hides dirty bar; discard returns to latest saved owner profile
      fail = false;
      await act(async () => { button('Save profile')!.click(); });
      assert.equal(updates.length, 2);
      assert.equal(dom.window.document.querySelector('[data-testid="profile-dirty-bar"]'), null);

      // Chip tag input adds via Enter and updates dirty patch cleanly
      const tagInput = dom.window.document.querySelector<HTMLInputElement>('[data-testid="profile-tags-field-input"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(tagInput, 'worldbuilder');
        tagInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
      await act(async () => {
        tagInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      assert.match(dom.window.document.querySelector('[data-testid="profile-tags-field"]')!.textContent!, /worldbuilder/);

      await act(async () => { button('Discard changes')!.click(); });
      assert.equal(bio().value, 'Unsaved draft', 'discard returns to the latest saved owner profile');
      assert.doesNotMatch(dom.window.document.querySelector('[data-testid="profile-tags-field"]')!.textContent!, /worldbuilder/);
    });

    await t.test('default avatar renders Scheme A mesh fallback and preset swatches upload through the standard draft flow', async () => {
      const renderedPresets: Array<{ name: string; paletteId: string }> = [];
      const uploadedFiles: File[] = [];
      const savedPatches: JsonObject[] = [];
      await act(async () => {
        root.render(
          <AppStoreProvider store={store}>
            <DesktopI18nResourceProvider resource={productionDesktopI18n}>
              <DesktopMotionProvider>
                <PublicProfileEditor
                  profile={profile}
                  onRenderAvatarPreset={async (options) => {
                    renderedPresets.push({ name: options.name, paletteId: options.paletteId });
                    return new File(['png-bytes'], `nimi-avatar-${options.paletteId}.png`, { type: 'image/png' });
                  }}
                  onUploadAvatar={async (file) => {
                    uploadedFiles.push(file);
                    return {
                      avatarUrl: `https://cdn.nimi.test/${file.name}`,
                      avatarResourceId: `res-${file.name}`,
                      avatarMedia: null,
                    };
                  }}
                  onSave={async (patch) => {
                    savedPatches.push(patch);
                    return {
                      ...profile,
                      avatarUrl: patch.avatarResourceId ? `https://cdn.nimi.test/${String(patch.avatarResourceId)}` : null,
                      avatarResourceId: typeof patch.avatarResourceId === 'string' ? patch.avatarResourceId : null,
                    };
                  }}
                />
              </DesktopMotionProvider>
            </DesktopI18nResourceProvider>
          </AppStoreProvider>,
        );
      });

      const avatarFallback = dom.window.document.querySelector('[data-nimi-avatar-mesh]');
      assert.ok(avatarFallback, 'default avatar fallback must emit Scheme A mesh attribute');

      const presetButtons = dom.window.document.querySelectorAll('[data-testid="profile-avatar-preset-picker"] button');
      assert.equal(presetButtons.length, 8, 'must expose all 8 curated Scheme A default presets');

      const mintPreset = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="profile-avatar-preset-mint"]')!;
      await act(async () => { mintPreset.click(); });
      assert.deepEqual(renderedPresets, [{ name: 'Alice', paletteId: 'mint' }]);
      assert.equal(uploadedFiles.length, 1);
      assert.equal(uploadedFiles[0]!.name, 'nimi-avatar-mint.png');
      assert.equal(mintPreset.getAttribute('aria-pressed'), 'true');
      assert.ok(dom.window.document.querySelector('[data-testid="profile-dirty-bar"]'));

      await act(async () => { button('Save profile')!.click(); });
      assert.deepEqual(savedPatches, [{ avatarResourceId: 'res-nimi-avatar-mint.png' }]);

      await act(async () => { button('Remove photo')!.click(); });
      assert.equal(mintPreset.getAttribute('aria-pressed'), 'false');
      assert.ok(dom.window.document.querySelector('[data-testid="profile-dirty-bar"]'));
    });

    await t.test('returning from Web account handoff refreshes profile handle without losing draft edits', async () => {
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
      const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
      const { RealmSocialDataProvider } = await import('../src/shell/renderer/features/social/data/realm-social-data-context.js');
      const { currentUserProfileQueryKey } = await import('../src/shell/renderer/features/profile/current-user-profile.js');
      const { ProfilePage } = await import('../src/shell/renderer/features/settings/settings-account-panel.js');
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
      store.setState({
        bootstrapReady: true,
        runtimeDefaults: { realm: { realmBaseUrl: 'https://realm.test' } } as never,
      });
      const project = (id: string) => store.getState().applyRuntimeAccountProjection({
        status: 'authenticated',
        user: { id, realmEnvironmentId: 'realm' },
        sequence: '1',
        reasonCode: 0,
        accountReasonCode: 0,
        authorizationRevision: id,
      });
      let currentHandle = 'alice';
      const openedPages: string[] = [];
      let focusListener: ((focused: boolean) => void) | null = null;
      queryClient.setQueryData(
        currentUserProfileQueryKey('https://realm.test', 'realm', 'alice', 'alice'),
        { id: 'alice', handle: 'alice', displayName: 'Alice', bio: 'Initial bio' },
      );
      const bindings = {
        app: {
          commands: {
            writeClipboardText: async () => {},
            openAccountManagement: async (page: string) => { openedPages.push(page); },
          },
          events: {
            subscribeWindowFocus: (listener: (focused: boolean) => void) => {
              focusListener = listener;
              return () => { focusListener = null; };
            },
            subscribeDocumentVisibility: () => () => {},
          },
        },
        sdk: {
          realm: () => ({
            account: { getMySettings: async () => ({ profileVisibility: 'PUBLIC' }) },
            resources: { createImageDirectUpload: async () => { throw Error('unexpected prepare'); } },
          }),
        },
      };
      const socialResource = {
        loadCurrentUser: async () => ({ id: 'alice', handle: currentHandle, displayName: 'Alice', bio: 'Initial bio' }),
        updateUserProfile: async () => { throw new Error('not called'); },
      };
      project('alice');
      await act(async () => {
        root.render(
          <AppStoreProvider store={store}>
            <DesktopI18nResourceProvider resource={productionDesktopI18n}>
              <DesktopMotionProvider>
                <DesktopRendererBindingProvider bindings={bindings as never}>
                  <QueryClientProvider client={queryClient}>
                    <RealmSocialDataProvider resource={socialResource as never}>
                      <ProfilePage />
                    </RealmSocialDataProvider>
                  </QueryClientProvider>
                </DesktopRendererBindingProvider>
              </DesktopMotionProvider>
            </DesktopI18nResourceProvider>
          </AppStoreProvider>,
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      await typeBio('Local unsaved bio');
      await act(async () => { button('Change in Web account')!.click(); });
      assert.deepEqual(openedPages, ['profile']);

      // Simulate user changing handle on Web and switching focus back to Desktop
      currentHandle = 'alice_new';
      await act(async () => {
        focusListener?.(true);
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      assert.equal(dom.window.document.querySelector('[data-testid="profile-readonly-handle"]')?.textContent, '@alice_new');
      assert.equal(bio().value, 'Local unsaved bio', 'handle sync must not overwrite unsaved bio draft');
      await act(async () => {
        root.render(null);
        store.setState({ bootstrapReady: false, runtimeDefaults: null });
      });
      queryClient.clear();
    });

    await t.test('switching accounts during avatar hashing stops the settings upload before Realm preparation', async () => {
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
      const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
      const { RealmSocialDataProvider } = await import('../src/shell/renderer/features/social/data/realm-social-data-context.js');
      const { currentUserProfileQueryKey } = await import('../src/shell/renderer/features/profile/current-user-profile.js');
      const { ProfilePage } = await import('../src/shell/renderer/features/settings/settings-account-panel.js');
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
      const project = (id: string) => store.getState().applyRuntimeAccountProjection({
        status: 'authenticated',
        user: { id, realmEnvironmentId: 'realm' },
        sequence: '1',
        reasonCode: 0,
        accountReasonCode: 0,
        authorizationRevision: id,
      });
      for (const id of ['alice', 'bob']) {
        queryClient.setQueryData(currentUserProfileQueryKey('', 'realm', id, id), { id, handle: id, displayName: id });
      }
      let prepareCalls = 0;
      const bindings = {
        sdk: {
          realm: () => ({
            account: {},
            resources: {
              createImageDirectUpload: async () => {
                prepareCalls++;
                throw Error('unexpected prepare');
              },
            },
          }),
        },
      };
      project('alice');
      await act(async () => {
        root.render(
          <AppStoreProvider store={store}>
            <DesktopI18nResourceProvider resource={productionDesktopI18n}>
              <DesktopMotionProvider>
                <DesktopRendererBindingProvider bindings={bindings as never}>
                  <QueryClientProvider client={queryClient}>
                    <RealmSocialDataProvider resource={{} as never}>
                      <ProfilePage />
                    </RealmSocialDataProvider>
                  </QueryClientProvider>
                </DesktopRendererBindingProvider>
              </DesktopMotionProvider>
            </DesktopI18nResourceProvider>
          </AppStoreProvider>,
        );
      });
      let release!: (bytes: ArrayBuffer) => void;
      const file = new File(['image'], 'avatar.png', { type: 'image/png' });
      const chunk = new Promise<ArrayBuffer>((resolve) => { release = resolve; });
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
    await act(async () => { root.unmount(); await new Promise((resolve) => setTimeout(resolve, 40)); });
    store.navigation.dispose();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});
