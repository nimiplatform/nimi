import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('mods.panel-open', () => {
  it('opens the mods panel from the shell sidebar', async () => {
    assertScenario('mods.panel-open');
    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('mods'));
    await waitForTestId(E2E_IDS.panel('mods'));
  });
});
