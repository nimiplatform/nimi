import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, waitForTestId } from '../helpers/app.mjs';

describe('boot.anonymous.login-screen', () => {
  it('renders the desktop login screen', async () => {
    assertScenario('boot.anonymous.login-screen');
    await waitForTestId(E2E_IDS.loginScreen);
  });
});
