import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('explore.panel-load', () => {
  it('opens the explore panel through shell navigation', async () => {
    assertScenario('explore.panel-load');
    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('explore'));
    await waitForTestId(E2E_IDS.panel('explore'));
  });
});
