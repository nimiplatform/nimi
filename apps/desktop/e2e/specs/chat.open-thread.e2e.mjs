import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertActiveChat, assertScenario, assertTextVisible, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('chat.open-thread', () => {
  it('opens a seeded chat thread and routes Open User Profile to the shared profile detail page', async () => {
    assertScenario('chat.open-thread');
    await waitForTestId(E2E_IDS.panel('chat'));
    await clickByTestId(E2E_IDS.chatRow('chat-e2e-primary'));
    await assertActiveChat('chat-e2e-primary');
    await assertTextVisible('Hello from the desktop E2E fixture.');
    await clickByTestId(E2E_IDS.chatHeaderProfileToggle);
    await waitForTestId(E2E_IDS.chatOpenUserProfile);
    await clickByTestId(E2E_IDS.chatOpenUserProfile);
    await waitForTestId(E2E_IDS.panel('profile'));
    await waitForTestId(E2E_IDS.profileDetailSurface);
    await assertTextVisible('Fixture Friend');
  });
});
