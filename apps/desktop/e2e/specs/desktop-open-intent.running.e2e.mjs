import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';

const DESKTOP_OPEN_INTENT_PATH = '/v1/open-intent';
let requestCounter = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function desktopOpenDescriptorPath() {
  const home = String(process.env.NIMI_E2E_HOME_DIR || process.env.HOME || process.env.USERPROFILE || '').trim();
  assert.ok(home, 'NIMI_E2E_HOME_DIR or HOME is required for Desktop Open e2e');
  return path.join(home, '.nimi', 'run', 'desktop', 'open-intent', 'presence.v1.json');
}

function readDescriptor() {
  const descriptor = JSON.parse(fs.readFileSync(desktopOpenDescriptorPath(), 'utf8'));
  assert.equal(descriptor.schemaVersion, 1);
  assert.match(String(descriptor.endpoint || ''), /^http:\/\/(?:127\.0\.0\.1|\[::1\]):\d+$/);
  assert.match(String(descriptor.bridgeId || ''), /^desktop-open-bridge-/);
  assert.ok(String(descriptor.token || '').length >= 32, 'descriptor token is required');
  return descriptor;
}

async function waitForDescriptor() {
  const deadline = Date.now() + 15000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return readDescriptor();
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw new Error(`Desktop Open descriptor did not become readable: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function postDesktopOpenIntent(intent) {
  const descriptor = await waitForDescriptor();
  const response = await fetch(new URL(DESKTOP_OPEN_INTENT_PATH, descriptor.endpoint), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${descriptor.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      schemaVersion: 1,
      sourceApp: 'nimi.desktop-open-test-launcher',
      sourceHost: 'dev-fixture',
      requestId: `desktop-open-e2e-${Date.now()}-${requestCounter += 1}`,
      intent,
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.bridgeId, descriptor.bridgeId);
  return body;
}

async function openDesktopIntentWhenReady(intent) {
  const deadline = Date.now() + 15000;
  let lastResult = null;
  while (Date.now() < deadline) {
    const result = await postDesktopOpenIntent(intent);
    lastResult = result;
    if (result.status === 'accepted') {
      return result;
    }
    if (result.reasonCode !== 'desktop-open-desktop-not-ready') {
      return result;
    }
    await sleep(250);
  }
  return lastResult;
}

async function assertExplorePanel(sectionId) {
  await waitForTestId(E2E_IDS.panel('explore'));
  await waitForTestId(E2E_IDS.exploreSection(sectionId));
}

async function assertPanelAbsent(panelId) {
  const selector = `[data-testid="${E2E_IDS.panel(panelId)}"]`;
  await browser.waitUntil(async () => !(await $(selector).isExisting()), {
    timeout: 5000,
    timeoutMsg: `expected ${panelId} panel to be absent`,
  });
}

describe('desktop-open-intent.running', () => {
  it('accepts a visible running Desktop Open Intent and applies the Explore target', async () => {
    assertScenario('desktop-open-intent.running');
    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('chat'));
    await waitForTestId(E2E_IDS.chatPage);

    const result = await openDesktopIntentWhenReady({
      kind: 'open-explore',
      section: 'personas',
      productIntent: 'select-partner',
      query: 'mentor',
    });

    assert.equal(result.status, 'accepted');
    assert.equal(result.appliedTarget, 'open-explore');
    await assertExplorePanel('personas');
  });

  it('rejects an unsupported intent without applying Desktop navigation', async () => {
    assertScenario('desktop-open-intent.running');
    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('chat'));
    await waitForTestId(E2E_IDS.chatPage);

    const result = await postDesktopOpenIntent({
      kind: 'open-explore',
      section: 'worlds',
      productIntent: 'select-partner',
    });

    assert.equal(result.status, 'rejected');
    assert.equal(result.reasonCode, 'desktop-open-target-unsupported');
    await assertPanelAbsent('explore');
  });
});
