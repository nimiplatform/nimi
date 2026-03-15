import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('contacts.panel-load', () => {
  it('opens the contacts panel through shell navigation', async () => {
    assertScenario('contacts.panel-load');
    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('contacts'));
    await waitForTestId(E2E_IDS.panel('contacts'));
  });
});
