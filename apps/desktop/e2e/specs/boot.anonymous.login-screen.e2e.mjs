import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('boot.anonymous.login-screen', () => {
  it('boots into anonymous runtime shell and supports login roundtrip', async () => {
    assertScenario('boot.anonymous.login-screen');
    await waitForTestId(E2E_IDS.mainShell);
    await waitForTestId(E2E_IDS.panel('runtime'));
    await waitForTestId(E2E_IDS.runtimePageRoot('overview'));
    await waitForTestId(E2E_IDS.topbarLoginButton);

    if (await $(`[data-testid="${E2E_IDS.shellSidebarRail}"]`).isExisting()) {
      throw new Error('anonymous shell must not render the primary sidebar rail');
    }

    await clickByTestId(E2E_IDS.topbarLoginButton);
    await waitForTestId(E2E_IDS.loginScreen);
    await waitForTestId(E2E_IDS.loginBackButton);

    const pageSource = await browser.getPageSource();
    if (pageSource.includes('data-auth-mode="embedded"')) {
      await clickByTestId(E2E_IDS.loginLogoTrigger);
      await waitForTestId(E2E_IDS.loginEmailInput);
      await clickByTestId(E2E_IDS.loginAlternativeToggle);
      await waitForTestId(E2E_IDS.loginAlternativePanel);
    }

    await clickByTestId(E2E_IDS.loginBackButton);
    await waitForTestId(E2E_IDS.panel('runtime'));
  });
});
