import type { RuntimeSetupPageIdV11 } from '@renderer/features/runtime-config/state/types';

type RuntimeSetupTabsProps = {
  activePage: RuntimeSetupPageIdV11;
  onChangePage: (pageId: RuntimeSetupPageIdV11) => void;
};

const SETUP_PAGES: Array<{
  id: RuntimeSetupPageIdV11;
  label: string;
  description: string;
}> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Runtime health, capability coverage, and quick actions.',
  },
  {
    id: 'models',
    label: 'Models',
    description: 'Search, install, and manage local AI models.',
  },
  {
    id: 'cloud-api',
    label: 'Cloud API',
    description: 'Configure API keys for cloud provider fallback.',
  },
  {
    id: 'providers',
    label: 'Providers',
    description: 'Capability matrix and provider diagnostics.',
  },
  {
    id: 'audit',
    label: 'Audit',
    description: 'Event timeline, filter, and export audit trail.',
  },
];

export function RuntimeSetupTabs({ activePage, onChangePage }: RuntimeSetupTabsProps) {
  return (
    <div className="rounded-[10px] border border-gray-200 bg-white p-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {SETUP_PAGES.map((page) => {
          const active = page.id === activePage;
          return (
            <button
              key={`runtime-setup-page-${page.id}`}
              type="button"
              onClick={() => onChangePage(page.id)}
              className={`rounded-[10px] border px-3 py-2 text-left transition-colors ${
                active
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <p className="text-sm font-semibold">{page.label}</p>
              <p className={`mt-1 text-[11px] ${active ? 'text-brand-600/80' : 'text-gray-500'}`}>{page.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
