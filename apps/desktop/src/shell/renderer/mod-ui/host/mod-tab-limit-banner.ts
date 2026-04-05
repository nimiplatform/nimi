import { useAppStore } from '@renderer/app-shell/providers/app-store';

type ShowModTabLimitBannerInput = {
  setActiveTab: (tab: 'mods') => void;
};

export function showModTabLimitBanner(input: ShowModTabLimitBannerInput): void {
  useAppStore.getState().setStatusBanner({
    kind: 'warning',
    message: '最多同时打开 5 个 Mod，请先关闭一个再继续。',
    actionLabel: '前往 Mods',
    onAction: () => {
      input.setActiveTab('mods');
    },
  });
}
