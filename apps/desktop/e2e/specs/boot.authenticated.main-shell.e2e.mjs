import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, waitForTestId } from '../helpers/app.mjs';

describe('boot.authenticated.main-shell', () => {
  it('renders the authenticated shell on the default chat tab', async () => {
    assertScenario('boot.authenticated.main-shell');
    await waitForTestId(E2E_IDS.mainShell);
    await waitForTestId(E2E_IDS.shellSidebarRail);
    await waitForTestId(E2E_IDS.navTab('home'));
    await waitForTestId(E2E_IDS.panel('chat'));

    if (await $(`[data-testid="${E2E_IDS.topbarLoginButton}"]`).isExisting()) {
      throw new Error('authenticated shell must not render the login action');
    }
  });
});
