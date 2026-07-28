import type { AppTab } from '../providers/app-store';

export function shouldHideMainLayoutPrimaryRail(input: {
  activeTab: AppTab;
  selectedProfileId: string | null;
  profileDetailOverlayOpen: boolean;
}): boolean {
  return input.activeTab === 'gift-inbox'
    || (input.activeTab === 'profile' && Boolean(input.selectedProfileId))
    || input.profileDetailOverlayOpen;
}
