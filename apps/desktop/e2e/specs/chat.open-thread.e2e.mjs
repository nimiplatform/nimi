import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertActiveChat, assertScenario, assertTextVisible, clickByTestId, waitForTestId } from '../helpers/app.mjs';

describe('chat.open-thread', () => {
  it('opens a seeded chat thread and binds the message timeline to it', async () => {
    assertScenario('chat.open-thread');
    await waitForTestId(E2E_IDS.panel('chat'));
    await clickByTestId(E2E_IDS.chatRow('chat-e2e-primary'));
    await assertActiveChat('chat-e2e-primary');
    await assertTextVisible('Hello from the desktop E2E fixture.');
  });
});
