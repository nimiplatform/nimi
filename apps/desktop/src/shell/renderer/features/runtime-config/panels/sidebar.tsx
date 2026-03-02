import type { RuntimePageIdV11 } from '../state/types';

type RuntimeSidebarProps = {
  activePage: RuntimePageIdV11;
  onSelectPage: (pageId: RuntimePageIdV11) => void;
  installedModelCount: number;
  activeModelCount: number;
  connectorCount: number;
  healthyConnectorCount: number;
  modCount: number;
  daemonRunning: boolean;
};

const SIDEBAR_ITEMS: Array<{
  id: RuntimePageIdV11;
  label: string;
  description: string;
  icon: string;
}> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Dashboard & quick actions',
    icon: '◎',
  },
  {
    id: 'local',
    label: 'Local Models',
    description: 'Install & manage models',
    icon: '⊞',
  },
  {
    id: 'cloud',
    label: 'Cloud API',
    description: 'API key connectors',
    icon: '☁',
  },
  {
    id: 'runtime',
    label: 'Runtime',
    description: 'Daemon, audit & EAA',
    icon: '⚙',
  },
  {
    id: 'mods',
    label: 'Mods',
    description: 'AI dependency setup',
    icon: '⧉',
  },
];

function getBadge(
  item: (typeof SIDEBAR_ITEMS)[number],
  props: RuntimeSidebarProps,
): string | null {
  if (item.id === 'local') {
    return `${props.activeModelCount}/${props.installedModelCount}`;
  }
  if (item.id === 'cloud') {
    return `${props.healthyConnectorCount}/${props.connectorCount}`;
  }
  if (item.id === 'mods' && props.modCount > 0) {
    return String(props.modCount);
  }
  return null;
}

export function RuntimeSidebar(props: RuntimeSidebarProps) {
  return (
    <nav className="flex flex-col px-3 pt-4">
      <div className="flex flex-col gap-0.5">
        {SIDEBAR_ITEMS.map((item) => {
          const active = item.id === props.activePage;
          const badge = getBadge(item, props);
          const showDaemonDot = item.id === 'runtime';
          return (
            <button
              key={`sidebar-${item.id}`}
              type="button"
              onClick={() => props.onSelectPage(item.id)}
              className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm transition-colors ${
                active ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="block truncate">{item.label}</span>
                  {showDaemonDot ? (
                    <span
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                        props.daemonRunning ? 'bg-emerald-500' : 'bg-red-400'
                      }`}
                    />
                  ) : null}
                  {badge ? (
                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                      active ? 'bg-brand-100 text-brand-800' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {badge}
                    </span>
                  ) : null}
                </div>
                <span className={`block text-[11px] ${active ? 'text-brand-600/70' : 'text-gray-400'}`}>
                  {item.description}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
