import { E2E_IDS } from '../helpers/selectors.mjs';
import {
  assertScenario,
  assertTextVisible,
  clickByTestId,
  waitForTestId,
  waitForTestIdToDisappear,
} from '../helpers/app.mjs';

describe('explore.feed-profile-modal', () => {
  it('opens and closes a single profile modal from the dynamic feed author avatar', async () => {
    assertScenario('explore.feed-profile-modal');
    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('explore'));
    await waitForTestId(E2E_IDS.panel('explore'));

    await clickByTestId(E2E_IDS.feedPostAuthor('post-explore-author-1'));
    await waitForTestId(E2E_IDS.contactDetailProfileModal);
    await waitForTestId(E2E_IDS.profileDetailSurface);
    await waitForTestIdToDisappear(E2E_IDS.shellSidebarRail);
    await assertTextVisible('Explore Author');

    await clickByTestId(E2E_IDS.contactDetailProfileModalClose);
    await waitForTestIdToDisappear(E2E_IDS.contactDetailProfileModal);
    await waitForTestId(E2E_IDS.panel('explore'));
    await waitForTestId(E2E_IDS.shellSidebarRail);
  });
});
