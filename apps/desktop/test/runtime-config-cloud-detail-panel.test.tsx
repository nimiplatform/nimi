import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import type { RuntimeConfigConnectorSdkService } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-sdk-service.js';
import type { RuntimeConfigPanelControllerModel } from '../src/shell/renderer/features/runtime-config/runtime-config-panel-types.js';

async function withDetailPanel(
  options: { isDraft?: boolean },
  run: (fixture: {
    dom: JSDOM;
    clickButton: (label: string, scope?: ParentNode) => Promise<void>;
    drawer: () => HTMLElement | null;
  }) => Promise<void>,
) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element,
    SVGElement: dom.window.SVGElement,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  const { createRoot } = await import('react-dom/client');
  const { TooltipProvider } = await import('@nimiplatform/kit/ui');
  const { I18nextProvider } = await import('react-i18next');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { RuntimeConfigConnectorSdkProvider } = await import('../src/shell/renderer/features/runtime-config/runtime-config-connector-sdk-context.js');
  const { CloudConnectorDetailPanel } = await import('../src/shell/renderer/features/runtime-config/runtime-config-page-cloud-detail-panel.js');
  const { normalizeConnectorV11 } = await import('../src/shell/renderer/features/runtime-config/runtime-config-state-types.js');
  const { i18n, initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');

  await initI18n();
  await changeLocale('zh');

  const isDraft = Boolean(options.isDraft);
  const connector = normalizeConnectorV11({
    id: isDraft ? 'draft-volcengine' : 'conn-volcengine',
    vendor: 'volcengine',
    provider: 'volcengine',
    label: 'volcengine',
    endpoint: 'https://ark.cn-beijing.volces.com',
    hasCredential: !isDraft,
    status: isDraft ? 'idle' : 'healthy',
    isDraft,
  });

  const appStore = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  appStore.getState().setAuthSession({ id: 'cloud-detail-account' });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const bindings = {
    sdk: {
      machineProduct: () => ({
        connectors: {
          listModelCatalog: async () => ({ entries: [] }),
          listReferences: async () => ({ references: [], complete: true, observedAt: new Date().toISOString() }),
          getUsageSummary: async () => ({ requests: 0, complete: true }),
        },
      }),
    },
  } as unknown as DesktopCanonicalRendererBindings;

  const connectorSdk = {
    sdkListConnectorCatalog: async () => [],
    sdkListConnectorReferences: async () => ({ references: [], complete: true, observedAt: new Date().toISOString() }),
    sdkGetConnectorUsage: async () => ({ requests: 0, complete: true }),
  } as unknown as RuntimeConfigConnectorSdkService;

  const model = {
    checkingConnector: null,
    showCloudApiKey: false,
    setShowCloudApiKey: () => {},
    runtimeWritesDisabled: false,
    testSelectedConnector: async () => {},
    updateState: () => {},
    onVaultChanged: () => {},
  } as unknown as RuntimeConfigPanelControllerModel;

  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AppStoreProvider store={appStore}>
            <DesktopRendererBindingProvider bindings={bindings}>
              <I18nextProvider i18n={i18n}>
                <DesktopMotionProvider>
                  <TooltipProvider>
                    <RuntimeConfigConnectorSdkProvider service={connectorSdk}>
                      <CloudConnectorDetailPanel
                        deleting={false}
                        onDelete={async () => {}}
                        onOpenHistory={() => {}}
                        onOpenOwner={() => {}}
                        onSaveConnection={async () => {}}
                        authOptions={[{ label: 'API Key', value: 'api_key' }]}
                        authStatus="authenticated"
                        canEditCredentialMode={false}
                        canEditVendor={false}
                        canStartManagedOAuth={false}
                        canManageCatalogOverrides={false}
                        managedOAuthBusy={false}
                        managedOAuthPending={null}
                        connectorConfigurationLocked={false}
                        connectorLabelDraft={connector.label}
                        isBrowserManagedConnector={false}
                        isDraft={isDraft}
                        isMachineGlobal={false}
                        isRuntimeSystem={false}
                        isSystemOwned={false}
                        model={model}
                        onAcquireManagedOAuth={() => {}}
                        onCancelManagedOAuth={() => {}}
                        onManageCatalogOverrides={() => {}}
                        onConnectorLabelDraftChange={() => {}}
                        onChangeConnectorAuthOption={() => {}}
                        onChangeConnectorVendor={async () => {}}
                        reportError={() => {}}
                        savingToken={false}
                        selectedAuthOptionValue="api_key"
                        selectedConnector={connector}
                        selectedProviderCatalogEntry={null}
                        setTokenDraft={() => {}}
                        t={i18n.t.bind(i18n)}
                        tokenDraft=""
                        tokenSaveError={null}
                        tokenSavedConnectorId=""
                        vendorOptions={[{ label: 'volcengine', value: 'volcengine' }]}
                      />
                    </RuntimeConfigConnectorSdkProvider>
                  </TooltipProvider>
                </DesktopMotionProvider>
              </I18nextProvider>
            </DesktopRendererBindingProvider>
          </AppStoreProvider>
        </QueryClientProvider>,
      );
    });

    await run({
      dom,
      drawer: () => dom.window.document.querySelector<HTMLElement>('[data-testid="cloud-connection-editor"]'),
      async clickButton(label, scope = dom.window.document) {
        const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
          item => item.textContent?.trim() === label,
        );
        assert.ok(button, `Missing button "${label}"`);
        await act(async () => button.click());
      },
    });
  } finally {
    await act(async () => root.unmount());
    await new Promise(resolve => setTimeout(resolve, 0));
    queryClient.clear();
    appStore.navigation.dispose();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
}

test('cloud edit drawer pins remove and save actions in the footer without repeating removal help text', async () => {
  await withDetailPanel({ isDraft: false }, async ({ dom, clickButton, drawer }) => {
    await clickButton('编辑连接');
    const editor = drawer();
    assert.ok(editor, 'edit connection drawer should open');

    const footer = editor.querySelector<HTMLElement>('.nimi-overlay-footer');
    assert.ok(footer, 'edit connection drawer should render actions in OverlayShell footer');

    const footerButtons = [...footer.querySelectorAll<HTMLButtonElement>('button')].map(button => ({
      text: button.textContent?.trim(),
      className: button.className,
    }));
    assert.deepEqual(footerButtons.map(item => item.text), ['移除连接', '取消', '保存']);
    assert.match(footerButtons[0]!.className, /\bnimi-action--ghost\b/);
    assert.match(footerButtons[0]!.className, /--nimi-status-danger/);

    assert.doesNotMatch(
      editor.textContent ?? '',
      /已保存的配置可能仍引用此连接/,
      'removal consequence copy should not appear inside the edit drawer before removal is requested',
    );

    await clickButton('移除连接', footer);
    const dialogs = [...dom.window.document.querySelectorAll<HTMLElement>('[role="dialog"]')];
    const confirmDialog = dialogs.find(dialog => dialog.textContent?.includes('移除「volcengine」？'));
    assert.ok(confirmDialog, 'clicking remove connection should open confirmation dialog');
    assert.match(confirmDialog.textContent ?? '', /已保存的配置可能仍引用此连接/);
  });
});

test('draft connection removal confirmation avoids misleading saved-reference warning', async () => {
  await withDetailPanel({ isDraft: true }, async ({ dom, clickButton, drawer }) => {
    const editor = drawer();
    assert.ok(editor, 'draft connector opens edit drawer directly');

    const footer = editor.querySelector<HTMLElement>('.nimi-overlay-footer');
    assert.ok(footer);
    await clickButton('移除连接', footer);

    const dialogs = [...dom.window.document.querySelectorAll<HTMLElement>('[role="dialog"]')];
    const confirmDialog = dialogs.find(dialog => dialog.textContent?.includes('移除「volcengine」？'));
    assert.ok(confirmDialog, 'draft removal should open confirmation dialog');
    assert.match(confirmDialog.textContent ?? '', /草稿连接尚未保存/);
    assert.doesNotMatch(confirmDialog.textContent ?? '', /已保存的配置可能仍引用此连接/);
  });
});
