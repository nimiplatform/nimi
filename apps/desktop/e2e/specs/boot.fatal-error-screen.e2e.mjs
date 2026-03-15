import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, waitForTestId } from '../helpers/app.mjs';

describe('boot.fatal-error-screen', () => {
  it('fails closed onto the bootstrap error screen', async () => {
    assertScenario('boot.fatal-error-screen');
    await waitForTestId(E2E_IDS.appBootstrapErrorScreen);
  });
});
