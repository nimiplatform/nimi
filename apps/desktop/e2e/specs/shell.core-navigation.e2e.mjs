import assert from 'node:assert/strict';
import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('shell.core-navigation', () => {
  it('switches across the core desktop tabs with stable selectors', async () => {
    assertScenario('shell.core-navigation');
    await waitForTestId(E2E_IDS.mainShell);
    await waitForTestId(E2E_IDS.shellSidebarRail);

    const navButtons = await $$(`[data-testid^="${E2E_IDS.navTab('')}"]`);
    const primaryOrder = [];
    for (const button of navButtons) {
      primaryOrder.push((await button.getAttribute('data-testid')).replace(E2E_IDS.navTab(''), ''));
    }
    assert.deepEqual(primaryOrder, ['home', 'chat', 'explore', 'apps', 'runtime']);
    for (const removed of ['world', 'settings', 'contacts', 'mods']) {
      assert.equal(await $(`[data-testid="${E2E_IDS.navTab(removed)}"]`).isExisting(), false);
    }

    await clickByTestId(E2E_IDS.navTab('home'));
    await waitForTestId(E2E_IDS.panel('home'));
    await clickByTestId(E2E_IDS.navTab('chat'));
    await waitForTestId(E2E_IDS.panel('chat'));
    await clickByTestId(E2E_IDS.navTab('explore'));
    await waitForTestId(E2E_IDS.panel('explore'));
    await clickByTestId(E2E_IDS.navTab('apps'));
    await waitForTestId(E2E_IDS.panel('apps'));
    await clickByTestId(E2E_IDS.navTab('runtime'));
    await waitForTestId(E2E_IDS.panel('runtime'));
  });
});
