type ShowModTabLimitBannerInput = {
  setStatusBanner: (banner: {
    kind: 'warning';
    message: string;
    actionLabel: string;
    onAction: () => void;
  }) => void;
  setActiveTab: (tab: 'mods') => void;
};

export function showModTabLimitBanner(input: ShowModTabLimitBannerInput): void {
  input.setStatusBanner({
    kind: 'warning',
    message: '最多同时打开 5 个 Mod，请先关闭一个再继续。',
    actionLabel: '前往 Mods',
    onAction: () => {
      input.setActiveTab('mods');
    },
  });
}

