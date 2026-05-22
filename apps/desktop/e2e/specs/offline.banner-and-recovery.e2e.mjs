import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, updateRealmRestOnline, waitForTestId, waitForTestIdToDisappear } from '../helpers/app.mjs';

describe('offline.banner-and-recovery', () => {
  it('surfaces the offline strip and clears it after recovery', async () => {
    assertScenario('offline.banner-and-recovery');
    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('explore'));
    await waitForTestId(E2E_IDS.offlineStrip);
    await updateRealmRestOnline(true);
    await waitForTestIdToDisappear(E2E_IDS.offlineStrip, 15000);
  });
});
