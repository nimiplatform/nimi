import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('boot.anonymous.login-screen', () => {
  it('boots into login without rendering ordinary shell', async () => {
    assertScenario('boot.anonymous.login-screen');
    await waitForTestId(E2E_IDS.loginScreen);
    if (await $(`[data-testid="${E2E_IDS.shellSidebarRail}"]`).isExisting()) {
      throw new Error('anonymous shell must not render the primary sidebar rail');
    }
    if (await $(`[data-testid="${E2E_IDS.mainShell}"]`).isExisting()) {
      throw new Error('anonymous boot must not render the ordinary main shell');
    }
    if (await $(`[data-testid="${E2E_IDS.panel('chat')}"]`).isExisting()) {
      throw new Error('anonymous boot must not render the ordinary chat panel');
    }
    if (await $(`[data-testid="${E2E_IDS.topbarLoginButton}"]`).isExisting()) {
      throw new Error('anonymous login route must not expose in-shell login action');
    }
    if (await $(`[data-testid="${E2E_IDS.loginBackButton}"]`).isExisting()) {
      throw new Error('anonymous login route must not expose back-to-chat');
    }

    const pageSource = await browser.getPageSource();
    if (pageSource.includes('data-auth-mode="embedded"')) {
      await clickByTestId(E2E_IDS.loginLogoTrigger);
      await waitForTestId(E2E_IDS.loginEmailInput);
      await clickByTestId(E2E_IDS.loginAlternativeToggle);
      await waitForTestId(E2E_IDS.loginAlternativePanel);
    }
  });
});
