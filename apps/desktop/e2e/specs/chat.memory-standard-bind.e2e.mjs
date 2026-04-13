import { E2E_IDS } from '../helpers/selectors.mjs';
import {
  assertScenario,
  clickByTestId,
  waitForTestId,
  waitForTestIdToDisappear,
} from '../helpers/app.mjs';

describe('chat.memory-standard-bind', () => {
  it('keeps Baseline until explicit confirmation and refreshes to Standard after bind', async () => {
    assertScenario('chat.memory-standard-bind');
    await waitForTestId(E2E_IDS.panel('chat'));
    await clickByTestId(E2E_IDS.chatTarget('agent-e2e-alpha'));
    await clickByTestId(E2E_IDS.chatSettingsToggle);

    const status = await waitForTestId(E2E_IDS.chatMemoryModeStatus);
    await browser.waitUntil(async () => (await status.getText()) === 'Baseline', {
      timeout: 10000,
      timeoutMsg: 'expected baseline memory status before explicit bind',
    });

    await clickByTestId(E2E_IDS.chatMemoryModeUpgradeButton);
    await browser.waitUntil(async () => (await status.getText()) === 'Baseline', {
      timeout: 10000,
      timeoutMsg: 'expected baseline memory status after cancelled confirmation',
    });

    await clickByTestId(E2E_IDS.chatMemoryModeUpgradeButton);
    await browser.waitUntil(async () => (await status.getText()) === 'Standard', {
      timeout: 10000,
      timeoutMsg: 'expected standard memory status after confirmed bind',
    });
    await waitForTestIdToDisappear(E2E_IDS.chatMemoryModeUpgradeButton);
  });
});
