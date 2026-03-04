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
        <div className="inline-flex h-full min-w-max items-stretch">
          {modWorkspaceTabs.map((tab) => {
            const active = tab.tabId === activeTab;
            return (
              <button
                key={tab.tabId}
                type="button"
                data-mod-tab-interactive="true"
                onClick={() => setActiveTab(tab.tabId)}
                className={`group relative flex h-full items-center gap-2 px-3.5 text-[12px] font-medium transition-colors ${
                  active
                    ? 'bg-white/24 text-[#0a4a3f]'
                    : 'bg-transparent text-[#0d5f51]/86 hover:bg-white/16 hover:text-[#083f36]'
                }`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    active ? 'bg-[#0ea68b]' : 'border border-white/34'
                  }`}
                />
                <span className="max-w-40 truncate">{tab.title}</span>
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
                  className={`ml-0.5 flex h-4 w-4 items-center justify-center rounded text-[12px] leading-none transition-colors ${
                    active
                      ? 'text-[#0d5b4d]/80 hover:bg-white/36 hover:text-[#083f36]'
                      : 'text-[#0b5b4d]/68 hover:bg-white/22 hover:text-[#083f36]'
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
