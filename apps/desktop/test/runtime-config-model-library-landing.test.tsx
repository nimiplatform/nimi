import { createMemoryDesktopRendererLocalModelProgressPort } from './helpers/desktop-renderer-ports.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';

import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context';
import { DesktopMotionProvider } from '../src/shell/renderer/ui/motion/desktop-motion-context.js';
import { createLocalModelCenterProgressCache } from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-progress-cache';
import { LocalModelCenterProgressProvider } from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-progress-context';
import { ModelLibraryPage } from '../src/shell/renderer/features/runtime-config/runtime-config-page-model-library';
import type { RuntimeConfigPanelControllerModel } from '../src/shell/renderer/features/runtime-config/runtime-config-panel-types';
import type { RuntimeConfigActionFocus } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createDesktopRendererRuntimeConfigNavigationPort } from '../src/shell/renderer/renderer/runtime-config-navigation-port.js';

// The Model Library opens on the sub-page its entry asks for from the first
// render: local-files entries never mount discovery on the way there.

async function renderLibrary(actionFocus: RuntimeConfigActionFocus | null) {
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  const port = createDesktopRendererRuntimeConfigNavigationPort(() => store.navigation);
  if (actionFocus) port.focusAction(actionFocus); else port.openPage('modelLibrary');
  await Promise.resolve();
  const i18n = createInstance();
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} } } });
  const bindings = {
    app: { commands: {}, events: { subscribeDocumentMouseDown: () => () => undefined } },
    sdk: { localEnvironmentRpc: () => { throw new Error('rendering must not call Runtime'); } },
  } as unknown as DesktopCanonicalRendererBindings;
  const model = {
    actionFocus: port.takeAction(),
    modelMarketContext: null,
    runtimeWritesDisabled: false,
    installResolvedModelPlan: async () => { throw new Error('rendering must not install'); },
    onReturnToContextualLoadout: () => undefined,
  } as unknown as RuntimeConfigPanelControllerModel;
  const markup = renderToStaticMarkup(
    <AppStoreProvider store={store}>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <DesktopI18nResourceProvider resource={{ instance: { t: (key: string) => key } } as never}>
          <DesktopRendererBindingProvider bindings={bindings}>
            <LocalModelCenterProgressProvider cache={createLocalModelCenterProgressCache(createMemoryDesktopRendererLocalModelProgressPort())}>
              <DesktopMotionProvider>
                <ModelLibraryPage model={model} onClearActionFocus={() => undefined} />
              </DesktopMotionProvider>
            </LocalModelCenterProgressProvider>
          </DesktopRendererBindingProvider>
        </DesktopI18nResourceProvider>
      </QueryClientProvider>
    </I18nextProvider>
    </AppStoreProvider>,
  );
  store.navigation.dispose();
  return markup;
}

function checkedTabHtml(markup: string) {
  return /<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>([\s\S]*?)<\/button>/u.exec(markup)?.[1] ?? '';
}

test('manage model files opens the Model Library on the downloaded files', async () => {
  const markup = await renderLibrary({ page: 'modelLibrary', action: 'manage-model-files', focus: 'runtime-config-action-focus.model-library-files' });
  assert.match(checkedTabHtml(markup), /Downloaded/);
  assert.match(markup, /data-testid="runtime-model-assets"/);
  assert.doesNotMatch(markup, /data-testid="runtime-builtin-catalog"/);
});

test('import model files also lands on the downloaded files', async () => {
  const markup = await renderLibrary({ page: 'modelLibrary', action: 'import-model-files', focus: 'runtime-config-action-focus.model-library-import' });
  assert.match(checkedTabHtml(markup), /Downloaded/);
  assert.match(markup, /data-testid="runtime-model-assets"/);
});

test('entries without a local-files intent still open on discovery', async () => {
  for (const focus of [null, { page: 'modelLibrary', action: 'install-model', focus: 'runtime-config-action-focus.model-library-install' }] as const) {
    const markup = await renderLibrary(focus);
    assert.match(checkedTabHtml(markup), /Discover/);
    assert.doesNotMatch(markup, /data-testid="runtime-model-assets"/);
  }
});
