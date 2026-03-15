import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('boot.anonymous.login-screen', () => {
  it('renders the desktop login screen', async () => {
    assertScenario('boot.anonymous.login-screen');
    await waitForTestId(E2E_IDS.loginScreen);

    const pageSource = await browser.getPageSource();
    if (!pageSource.includes('data-auth-mode="embedded"')) {
      return;
    }

    await clickByTestId(E2E_IDS.loginLogoTrigger);
    await waitForTestId(E2E_IDS.loginEmailInput);
    await clickByTestId(E2E_IDS.loginAlternativeToggle);
    await waitForTestId(E2E_IDS.loginAlternativePanel);
  });
});
