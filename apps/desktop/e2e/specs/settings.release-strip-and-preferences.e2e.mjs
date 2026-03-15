import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('settings.release-strip-and-preferences', () => {
  it('navigates from the runtime-unavailable strip into settings preferences', async () => {
    assertScenario('settings.release-strip-and-preferences');
    await waitForTestId(E2E_IDS.desktopReleaseStrip);
    await clickByTestId(E2E_IDS.desktopReleaseOpenUpdates);
    await waitForTestId(E2E_IDS.panel('settings'));
  });
});
