import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('tester.world-tour', () => {
  it('opens the desktop tester world tour lane', async () => {
    assertScenario('tester.world-tour');

    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('tester'));
    await waitForTestId(E2E_IDS.panel('tester'));

    await clickByTestId(E2E_IDS.testerCapabilityTab('world.generate'));
    await waitForTestId(E2E_IDS.testerPanel('world.generate'));
    await waitForTestId(E2E_IDS.testerInput('world-generate-prompt'));
  });
});
