import { useAppStore } from '@renderer/app-shell/providers/app-store';

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
      <div className="h-full max-w-full overflow-x-auto">
        <div className="inline-flex h-full min-w-max items-stretch gap-1 px-2">
          {modWorkspaceTabs.map((tab) => {
            const active = tab.tabId === activeTab;
            return (
              <button
                key={tab.tabId}
                type="button"
                data-mod-tab-interactive="true"
                onClick={() => setActiveTab(tab.tabId)}
                className={`group relative mt-1.5 mb-1.5 flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-all ${
                  active
                    ? 'border-white/60 bg-white/90 text-[#0a4a3f] shadow-sm'
                    : 'border-white/20 bg-white/20 text-[#0b4f43] hover:bg-white/35 hover:border-white/40'
                }`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    active ? 'bg-[#0ea68b]' : 'bg-[#0a4a3f]/40'
                  }`}
                />
                <span className="max-w-36 truncate">{tab.title}</span>
                {tab.fused ? (
                  <span className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
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
                  className={`ml-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[14px] leading-none transition-colors ${
                    active
                      ? 'text-[#0d5b4d]/70 hover:bg-[#0a4a3f]/10 hover:text-[#0a4a3f]'
                      : 'text-[#0b5b4d]/60 hover:bg-white/30 hover:text-[#0a4a3f]'
                  }`}
                  aria-label={`Close ${tab.title}`}
                >
                  ×
                </span>
              </button>
            );
          })}
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
                  className={`group flex h-8 items-center gap-2 rounded-md border px-3 text-xs transition-colors ${
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
                    className="rounded px-1 text-[11px] text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                    aria-label={`Close ${tab.title}`}
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
