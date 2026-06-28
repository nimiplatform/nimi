import { E2E_IDS } from '../helpers/selectors.mjs';
import {
  assertScenario,
  clickByTestId,
  clickByTestIdAtStart,
  waitForTestId,
  waitForTestIdToDisappear,
} from '../helpers/app.mjs';

async function waitForMemoryMode(expectedMode, timeoutMsg) {
  await browser.waitUntil(async () => {
    const status = await waitForTestId(E2E_IDS.chatMemoryModeStatus);
    return (await status.getAttribute('data-memory-mode')) === expectedMode;
  }, {
    timeout: 10000,
    timeoutMsg,
  });
}

describe('chat.memory-standard-bind', () => {
  it('keeps Baseline until explicit confirmation and refreshes to Standard after bind', async () => {
    assertScenario('chat.memory-standard-bind');
    await waitForTestId(E2E_IDS.panel('chat'));
    await clickByTestId(E2E_IDS.chatTarget(E2E_IDS.localAgentRef('local-agent:user-e2e-primary:agent-e2e-alpha')));
    await clickByTestId(E2E_IDS.chatSettingsToggle);
    await clickByTestId(E2E_IDS.chatAgentCenterSection('cognition'));

    await waitForMemoryMode('baseline', 'expected baseline memory status before explicit bind');

    await clickByTestIdAtStart(E2E_IDS.chatMemoryModeUpgradeButton);
    await waitForMemoryMode('baseline', 'expected baseline memory status after cancelled confirmation');

    await clickByTestIdAtStart(E2E_IDS.chatMemoryModeUpgradeButton);
    await waitForMemoryMode('standard', 'expected standard memory status after confirmed bind');
    await waitForTestIdToDisappear(E2E_IDS.chatMemoryModeUpgradeButton);
  });
});
