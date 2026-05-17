import assert from 'node:assert/strict';
import { E2E_IDS } from './selectors.mjs';

const DEFAULT_WAIT_TIMEOUT_MS = 15000;
const BOOTSTRAP_WAIT_TIMEOUT_MS = 60000;

function timeoutForTestId(id, timeout) {
  if (Number.isFinite(timeout) && timeout > 0) {
    return timeout;
  }
  if (id === E2E_IDS.mainShell || id === E2E_IDS.chatPage || String(id).startsWith('panel:')) {
    return BOOTSTRAP_WAIT_TIMEOUT_MS;
  }
  return DEFAULT_WAIT_TIMEOUT_MS;
}

async function currentBootstrapErrorText() {
  const errorScreen = await $(`[data-testid="${E2E_IDS.appBootstrapErrorScreen}"]`);
  if (!(await errorScreen.isExisting())) {
    return '';
  }
  return (await errorScreen.getText()).trim();
}

export async function waitForTestId(id, timeout = 0) {
  const selector = `[data-testid="${id}"]`;
  const element = await $(selector);
  const effectiveTimeout = timeoutForTestId(id, timeout);
  await browser.waitUntil(async () => {
    if (await element.isExisting()) {
      return true;
    }
    const bootstrapError = await currentBootstrapErrorText();
    if (bootstrapError) {
      throw new Error(`bootstrap failed before ${id} became available: ${bootstrapError}`);
    }
    return false;
  }, {
    timeout: effectiveTimeout,
    timeoutMsg: `expected ${id} to exist within ${effectiveTimeout}ms`,
  });
  return element;
}

export async function clickByTestId(id, timeout = 0) {
  const element = await waitForTestId(id, timeout);
  await element.click();
  return element;
}

export async function waitForTestIdToDisappear(id, timeout = 15000) {
  const selector = `[data-testid="${id}"]`;
  await browser.waitUntil(async () => !(await $(selector).isExisting()), {
    timeout,
    timeoutMsg: `expected ${id} to disappear`,
  });
}

export function assertScenario(expectedScenario) {
  assert.equal(process.env.NIMI_E2E_SCENARIO || '', expectedScenario);
}

export async function updateRuntimeBridgeStatus(status) {
  const baseUrl = String(process.env.NIMI_E2E_FIXTURE_CONTROL_URL || '').trim();
  assert.ok(baseUrl, 'NIMI_E2E_FIXTURE_CONTROL_URL is required');
  const response = await fetch(`${baseUrl}/runtime-bridge-status`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(status),
  });
  assert.equal(response.ok, true, `runtime-bridge-status control failed: ${response.status}`);
  return response.json();
}

export async function updateRealmRestOnline(online) {
  const baseUrl = String(process.env.NIMI_E2E_FIXTURE_CONTROL_URL || '').trim();
  assert.ok(baseUrl, 'NIMI_E2E_FIXTURE_CONTROL_URL is required');
  const response = await fetch(`${baseUrl}/rest-online`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ online }),
  });
  assert.equal(response.ok, true, `rest-online control failed: ${response.status}`);
  return response.json();
}

export async function assertActiveChat(chatId) {
  const timeline = await waitForTestId(E2E_IDS.messageTimeline);
  await browser.waitUntil(async () => {
    return (await timeline.getAttribute('data-active-chat-id')) === chatId;
  }, { timeout: 10000, timeoutMsg: `expected active chat ${chatId}` });
}

export async function assertTextVisible(text, timeout = 15000) {
  await browser.waitUntil(async () => {
    return (await browser.getPageSource()).includes(text);
  }, { timeout, timeoutMsg: `expected page to contain text: ${text}` });
}
