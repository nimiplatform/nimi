import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('runtime.external-agent.panel-load', () => {
  it('opens the external agent runtime subpage', async () => {
    assertScenario('runtime.external-agent.panel-load');
    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('runtime'));
    await waitForTestId(E2E_IDS.panel('runtime'));
    await clickByTestId(E2E_IDS.runtimeSidebarPage('runtime'));
    await waitForTestId(E2E_IDS.runtimePageRoot('runtime'));
  });
});
