import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, waitForTestId } from '../helpers/app.mjs';

describe('boot.runtime-unavailable.degraded-shell', () => {
  it('keeps the shell available while exposing the runtime degradation strip', async () => {
    assertScenario('boot.runtime-unavailable.degraded-shell');
    await waitForTestId(E2E_IDS.mainShell);
    await waitForTestId(E2E_IDS.desktopReleaseStrip);
  });
});
