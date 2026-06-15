import assert from 'node:assert/strict';
import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, assertTextVisible, clickByTestId, waitForTestId } from '../helpers/app.mjs';

const CBDB_REALM_AGENT_ID = 'cbdb-song-slice-real-20260614-agent-8af2c5ca8a';
const CBDB_VIEWER_ID = 'user-e2e-primary';
const CBDB_LOCAL_AGENT_REF = E2E_IDS.localAgentRef(CBDB_VIEWER_ID, CBDB_REALM_AGENT_ID);

describe('chat.cbdb-agentfriend-open', () => {
  it('opens a seeded CBDB RealmAgent friend through the LocalAgent Chat path', async () => {
    assertScenario('chat.cbdb-agentfriend-open');
    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('explore'));
    await waitForTestId(E2E_IDS.panel('explore'));
    await clickByTestId('explore-section-tab-agents');
    await waitForTestId('explore-agents-section');
    await waitForTestId(E2E_IDS.exploreAgentCard(CBDB_REALM_AGENT_ID));
    await assertTextVisible('CBDB Su Zhe');

    const primaryAction = await waitForTestId(E2E_IDS.exploreAgentPrimaryAction(CBDB_REALM_AGENT_ID));
    assert.equal(await primaryAction.getAttribute('data-friend-state'), 'friend');
    assert.equal(await primaryAction.getAttribute('data-primary-action'), 'open_agent_chat');

    await primaryAction.click();
    await waitForTestId(E2E_IDS.panel('chat'));
    await waitForTestId(E2E_IDS.chatTarget(CBDB_LOCAL_AGENT_REF));
    await assertTextVisible('CBDB Su Zhe');
  });
});
