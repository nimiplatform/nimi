import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('shell.core-navigation', () => {
  it('switches across the core desktop tabs with stable selectors', async () => {
    assertScenario('shell.core-navigation');
    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('home'));
    await waitForTestId(E2E_IDS.panel('home'));
    await clickByTestId(E2E_IDS.navTab('contacts'));
    await waitForTestId(E2E_IDS.panel('contacts'));
    await clickByTestId(E2E_IDS.navTab('world'));
    await waitForTestId(E2E_IDS.panel('world'));
    await clickByTestId(E2E_IDS.navTab('explore'));
    await waitForTestId(E2E_IDS.panel('explore'));
    await clickByTestId(E2E_IDS.navTab('settings'));
    await waitForTestId(E2E_IDS.panel('settings'));
    await clickByTestId(E2E_IDS.navTab('runtime'));
    await waitForTestId(E2E_IDS.panel('runtime'));
  });
});
