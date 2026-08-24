import type { AppTab } from '../providers/app-store';

export function shouldHideMainLayoutPrimaryRail(input: {
  activeTab: AppTab;
  profileDetailOverlayOpen: boolean;
}): boolean {
  return input.profileDetailOverlayOpen;
}
