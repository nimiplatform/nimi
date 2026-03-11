import { ChromeTab } from '@renderer/components/chrome-tab.js';
import { i18n } from '@renderer/i18n';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { renderShellNavIcon } from '@renderer/app-shell/layouts/navigation-config';

type ModWorkspaceTabsProps = {
  placement?: 'content' | 'titlebar';
};

export function ModWorkspaceTabs(props: ModWorkspaceTabsProps) {
  const placement = props.placement || 'content';
  const activeTab = useAppStore((state) => state.activeTab);
  const modWorkspaceTabs = useAppStore((state) => state.modWorkspaceTabs);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const closeModWorkspaceTab = useAppStore((state) => state.closeModWorkspaceTab);

  if (modWorkspaceTabs.length === 0) {
    return null;
  }

  if (placement === 'titlebar') {
    return (
      <div className="flex h-full max-w-full items-center overflow-visible pt-0">
        <div
          className="translate-y-[2px] overflow-x-auto overflow-y-visible [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="inline-flex min-w-max items-end gap-1.5 pr-2">
            <button
              type="button"
              onClick={() => setActiveTab('home')}
              className={`mb-0 flex h-9 w-9 items-center justify-center rounded-[14px] border transition-colors ${
                activeTab === 'home'
                  ? 'border-white/70 bg-[#f7fbfd] text-[#1A1D1F] shadow-[0_10px_24px_rgba(15,23,42,0.08)]'
                  : 'border-white/10 bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.82)] hover:bg-[rgba(255,255,255,0.12)]'
              }`}
              aria-label={i18n.t('Nav.home', { defaultValue: 'Home' })}
              title={i18n.t('Nav.home', { defaultValue: 'Home' })}
            >
              <span className="flex h-4 w-4 items-center justify-center">
                {renderShellNavIcon('home')}
              </span>
            </button>
            {modWorkspaceTabs.map((tab) => {
              const active = tab.tabId === activeTab;
              return (
                <ChromeTab
                  key={tab.tabId}
                  active={active}
                  title={tab.title}
                  onClick={() => setActiveTab(tab.tabId)}
                  onClose={() => closeModWorkspaceTab(tab.tabId)}
                  leading={(
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        active
                          ? (tab.fused ? 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.14)]' : 'bg-[#4ECCA3] shadow-[0_0_0_3px_rgba(78,204,163,0.16)]')
                          : tab.fused
                            ? 'bg-red-300/95'
                            : 'bg-white/68'
                      }`}
                    />
                  )}
                  trailing={tab.fused ? (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      active ? 'bg-red-500 text-white' : 'bg-red-500/85 text-white'
                    }`}>
                      CRASH
                    </span>
                  ) : undefined}
                  inactiveBg="rgba(255,255,255,0.06)"
                  inactiveHoverBg="rgba(255,255,255,0.12)"
                  activeBg="#f7fbfd"
                  inactiveColor="rgba(255,255,255,0.78)"
                  activeColor="#1A1D1F"
                  className="mb-0"
                  style={undefined}
                />
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="flex h-10 items-center gap-2 px-2">
        <span className="shrink-0 rounded-md bg-gray-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Workspace
        </span>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex min-w-max items-center gap-1">
            {modWorkspaceTabs.map((tab) => {
              const active = tab.tabId === activeTab;
              return (
                <button
                  key={tab.tabId}
                  type="button"
                  data-mod-tab-interactive="true"
                  onClick={() => setActiveTab(tab.tabId)}
                  className={`group flex h-8 items-center gap-2 rounded-md border pl-3 pr-2 text-xs transition-[padding,color,background-color,border-color] duration-180 hover:pr-3 ${
                    active
                      ? 'border-brand-200 bg-brand-50 text-brand-700'
                      : 'border-transparent text-gray-600 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="max-w-44 truncate">{tab.title}</span>
                  {tab.fused ? (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                      CRASH
                    </span>
                  ) : null}
                  <span
                    role="button"
                    tabIndex={0}
                    data-mod-tab-interactive="true"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeModWorkspaceTab(tab.tabId);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        closeModWorkspaceTab(tab.tabId);
                      }
                    }}
                    className="ml-0 overflow-hidden rounded px-1 text-[11px] text-gray-400 opacity-0 transition-[opacity,margin,max-width,padding] duration-180 max-w-0 group-hover:ml-0.5 group-hover:max-w-5 group-hover:opacity-100 group-hover:hover:bg-gray-200 group-hover:hover:text-gray-600"
                    aria-label={`${i18n.t('ModUI.closeTab', { defaultValue: 'Close tab' })} ${tab.title}`}
                  >
                    x
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
