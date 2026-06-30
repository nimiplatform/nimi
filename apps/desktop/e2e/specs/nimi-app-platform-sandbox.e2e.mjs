import assert from 'node:assert/strict';
import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';
import { PLATFORM_FIXTURE_APP_ID } from '../helpers/nimi-app-platform.mjs';

const cardId = `apps-entry-${PLATFORM_FIXTURE_APP_ID}`;

describe('nimi-app-platform.sandbox.lifecycle', () => {
  it('installs the admitted developer-only sandbox fixture without ordinary product claims', async () => {
    assertScenario('nimi-app-platform.sandbox.lifecycle');
    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('apps'));
    await waitForTestId(E2E_IDS.panel('apps'));

    await expectCardAttr('data-ordinary-visibility', 'developer-only');
    await expectCardAttr('data-ordinary-catalog-discovery', 'false');
    await expectCardAttr('data-install-state', 'not-installed');
    await expectCardAttr('data-open-readiness', 'install-required');
    await expectSourceStatus('catalog', 'present');
    await expectSourceStatus('account', 'present');
    await expectSourceStatus('local', 'absent');

    await clickByTestId(`apps-action-${PLATFORM_FIXTURE_APP_ID}-install`);
    await browser.waitUntil(async () => {
      const card = await $(`[data-testid="${cardId}"]`);
      return (await card.getAttribute('data-install-state')) === 'installed'
        && (await card.getAttribute('data-open-readiness')) === 'ready';
    }, {
      timeout: 20_000,
      timeoutMsg: 'sandbox fixture did not become installed and ready after Runtime install',
    });

    await expectCardAttr('data-ordinary-visibility', 'developer-only');
    await expectCardAttr('data-ordinary-catalog-discovery', 'false');
    assert.equal(await $(`[data-testid="apps-action-${PLATFORM_FIXTURE_APP_ID}-open"]`).isExisting(), true);
    assert.equal(await $('[data-testid="apps-action-error"]').isExisting(), false);
  });
});

async function expectCardAttr(name, expected) {
  await browser.waitUntil(async () => {
    const card = await $(`[data-testid="${cardId}"]`);
    return (await card.getAttribute(name)) === expected;
  }, {
    timeout: 15_000,
    timeoutMsg: `expected ${cardId} ${name}=${expected}`,
  });
}

async function expectSourceStatus(source, expected) {
  const chip = await waitForTestId(`apps-entry-${PLATFORM_FIXTURE_APP_ID}-source-${source}`);
  assert.equal(await chip.getAttribute('data-source-status'), expected);
}
