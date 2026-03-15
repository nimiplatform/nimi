import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, updateRuntimeBridgeStatus, waitForTestId, waitForTestIdToDisappear } from '../helpers/app.mjs';

describe('offline.banner-and-recovery', () => {
  it('surfaces the offline strip and clears it after recovery', async () => {
    assertScenario('offline.banner-and-recovery');
    await waitForTestId(E2E_IDS.mainShell);
    await waitForTestId(E2E_IDS.offlineStrip);
    await updateRuntimeBridgeStatus({
      running: true,
      managed: true,
      launchMode: 'RELEASE',
      grpcAddr: '127.0.0.1:46371',
      version: '0.1.0',
      lastError: '',
    });
    await waitForTestIdToDisappear(E2E_IDS.offlineStrip, 10000);
  });
});
