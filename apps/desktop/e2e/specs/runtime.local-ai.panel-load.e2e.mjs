import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('runtime.local-ai.panel-load', () => {
  it('opens the local AI runtime subpage', async () => {
    assertScenario('runtime.local-ai.panel-load');
    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('runtime'));
    await waitForTestId(E2E_IDS.panel('runtime'));
    await clickByTestId(E2E_IDS.runtimeSidebarPage('local'));
    await waitForTestId(E2E_IDS.runtimePageRoot('local'));
  });
});
