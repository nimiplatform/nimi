import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { JSDOM } from 'jsdom';

async function setup() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element,
    Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { TooltipProvider } = await import('@nimiplatform/kit/ui');
  const { createHomeNavigation } = await import('../src/shell/renderer/app-shell/providers/home-navigation.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { CloudConnectorListPanel } = await import('../src/shell/renderer/features/runtime-config/runtime-config-page-cloud-connector-list.js');
  const { normalizeConnectorV11 } = await import('../src/shell/renderer/features/runtime-config/runtime-config-state-types.js');
  const { i18n, initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  await initI18n();
  await changeLocale('zh');
  const navigation = createHomeNavigation();
  await navigation.push({ id: 'cloud', runtime: { connectorId: 'healthy' } });
  const connectors = [
    normalizeConnectorV11({ id: 'healthy', label: 'Healthy', hasCredential: true, status: 'healthy' }),
    normalizeConnectorV11({ id: 'failed', label: 'Failed', hasCredential: true, status: 'unreachable' }),
    normalizeConnectorV11({ id: 'unchecked', label: 'Unchecked', hasCredential: true, status: 'idle' }),
    normalizeConnectorV11({ id: 'missing', label: 'Missing', hasCredential: false, status: 'idle' }),
    normalizeConnectorV11({ id: 'disabled', label: 'Disabled', hasCredential: true, status: 'healthy', managementStatus: 'disabled' }),
  ];
  function Harness() {
    const snapshot = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
    return <CloudConnectorListPanel
      connectors={connectors}
      selectedConnectorId={snapshot.current.destination.runtime?.connectorId ?? ''}
      onSelectConnector={async connectorId => (await navigation.push({ id: 'cloud', runtime: { connectorId } })).status === 'committed'}
      defaultEndpointFor={() => ''}
      onAddConnector={() => {}}
      onOpenHistory={() => {}}
      uncheckedCount={1}
      t={i18n.t.bind(i18n)}
    />;
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(<DesktopMotionProvider><TooltipProvider><Harness /></TooltipProvider></DesktopMotionProvider>));
  const rail = () => dom.window.document.querySelector('aside')!;
  const filterButton = () => rail().querySelector<HTMLButtonElement>('button[aria-label="筛选连接"]')!;
  const closeMenu = async () => {
    await act(async () => dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  };
  return {
    dom, navigation, rail,
    selected: () => navigation.getSnapshot().current.destination.runtime?.connectorId,
    rows: () => [...rail().querySelectorAll('[role="listitem"] .desktop-sidebar__label')].map(row => row.textContent),
    activeRow: () => rail().querySelector('[aria-current="page"] .desktop-sidebar__label')?.textContent,
    async chooseFilter(label: string) {
      await act(async () => filterButton().click());
      const item = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === label);
      assert.ok(item, `Missing filter ${label}`);
      await act(async () => item.click());
      await closeMenu();
    },
    async search(query: string) {
      const input = rail().querySelector<HTMLInputElement>('input')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, query);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    },
    async clickButton(label: string) {
      const button = [...rail().querySelectorAll('button')].find(button => button.textContent === label);
      assert.ok(button, `Missing button ${label}`);
      await act(async () => button.click());
    },
    async close() {
      await act(async () => root.unmount());
      navigation.dispose();
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('state filters include failed connections and keep the selected detail in the visible results', async () => {
  const ui = await setup();
  try {
    await ui.chooseFilter('需处理');
    assert.deepEqual(ui.rows(), ['Failed', 'Missing', 'Disabled']);
    assert.equal(ui.selected(), 'failed');
    assert.equal(ui.activeRow(), 'Failed');
    assert.doesNotMatch(ui.rail().textContent!, /不在当前|1 个未检查/);

    await act(async () => { await ui.navigation.push({ id: 'cloud', runtime: { connectorId: 'disabled' } }); });
    await ui.chooseFilter('全部');
    assert.equal(ui.selected(), 'disabled', 'a matching selection survives a filter change');
    assert.equal(ui.rows().length, 5);

    await ui.chooseFilter('未检查');
    assert.deepEqual(ui.rows(), ['Unchecked']);
    assert.equal(ui.selected(), 'unchecked');
    assert.equal(ui.activeRow(), 'Unchecked');
  } finally { await ui.close(); }
});

test('a filter waits for the detail leave guard and cancellation preserves selection and results', async () => {
  const ui = await setup();
  let decide!: (result: 'allow' | 'cancel') => void;
  const unregister = ui.navigation.registerLeaveGuard(() => new Promise(resolve => { decide = resolve; }));
  try {
    await ui.chooseFilter('需处理');
    assert.equal(ui.selected(), 'healthy');
    assert.equal(ui.rows().length, 5);
    await act(async () => decide('cancel'));
    assert.equal(ui.activeRow(), 'Healthy');
    assert.equal(ui.rows().length, 5);

    await ui.chooseFilter('需处理');
    await act(async () => decide('allow'));
    assert.deepEqual(ui.rows(), ['Failed', 'Missing', 'Disabled']);
    assert.equal(ui.activeRow(), 'Failed');
  } finally { unregister(); await ui.close(); }
});

test('filter selection respects search and empty results identify the retained detail by name', async () => {
  const ui = await setup();
  try {
    await ui.search('Missing');
    await ui.chooseFilter('需处理');
    assert.deepEqual(ui.rows(), ['Missing']);
    assert.equal(ui.selected(), 'missing');

    await ui.search('no-such-connection');
    await ui.chooseFilter('未检查');
    assert.deepEqual(ui.rows(), []);
    assert.equal(ui.selected(), 'missing');
    assert.match(ui.rail().textContent!, /右侧正在显示“Missing”的详情/);
    assert.match(ui.rail().textContent!, /没有符合当前搜索或筛选条件的连接/);
    await ui.clickButton('清除筛选');
    assert.equal(ui.rows().length, 5);
    assert.equal(ui.activeRow(), 'Missing');
    assert.doesNotMatch(ui.rail().textContent!, /不在当前/);
  } finally { await ui.close(); }
});
