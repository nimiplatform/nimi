import type { AppTab } from '@renderer/app-shell/providers/app-store';

export function openContactsMessageTab(setActiveTab: (tab: AppTab) => void) {
  setActiveTab('chat');
}
