import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('runtime.config-panel-load', () => {
  it('loads the runtime config panel through shell navigation', async () => {
    assertScenario('runtime.config-panel-load');
    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('runtime'));
    await waitForTestId(E2E_IDS.panel('runtime'));
    await waitForTestId(E2E_IDS.runtimePageRoot('overview'));
  });
});
