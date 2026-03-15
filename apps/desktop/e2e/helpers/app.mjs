import assert from 'node:assert/strict';
import { E2E_IDS } from './selectors.mjs';

export async function waitForTestId(id, timeout = 15000) {
  const selector = `[data-testid="${id}"]`;
  const element = await $(selector);
  await element.waitForExist({ timeout });
  return element;
}

export async function clickByTestId(id, timeout = 15000) {
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
