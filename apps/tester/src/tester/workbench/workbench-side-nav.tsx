import {
  Boxes,
  Compass,
} from 'lucide-react';
import { Tooltip } from '@nimiplatform/kit/ui';
import { getTesterCapability, type TesterCapabilityId } from '../tester-capabilities.js';
import { capabilityIcons } from './capability-icons.js';
import { workbenchLibraryCapabilityId, workbenchNavGroups, type WorkbenchView } from './workbench-context.js';

type WorkbenchSideNavProps = {
  view: WorkbenchView;
  onSelectCapability: (id: TesterCapabilityId) => void;
  onSelectRecipes: () => void;
};

export function WorkbenchSideNav({
  view,
  onSelectCapability,
  onSelectRecipes,
}: WorkbenchSideNavProps) {
  const activeCapabilityId = view.kind === 'capability' ? view.capabilityId : null;
  return (
    <aside
      className="workbench-side-nav"
      aria-label="Nimi App Lab workspace navigation"
    >
      <nav className="workbench-side-nav__groups">
        {workbenchNavGroups.map((group) => (
          <div key={group.label} className="workbench-side-nav__group">
            <ul>
              {group.capabilityIds.map((id) => {
                const Icon = capabilityIcons[id];
                const active = activeCapabilityId === id;
                const label = getTesterCapability(id).label;
                return (
                  <li key={id}>
                    <Tooltip
                      content={label}
                      placement="right"
                      className="w-full"
                    >
                      <button
                        type="button"
                        className={active ? 'workbench-side-nav__item workbench-side-nav__item--active' : 'workbench-side-nav__item'}
                        onClick={() => onSelectCapability(id)}
                        aria-label={label}
                        aria-current={active ? 'page' : undefined}
                      >
                        <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
                        <span className="workbench-side-nav__item-label">{label}</span>
                      </button>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div className="workbench-side-nav__group">
          <ul>
            <li>
              <Tooltip
                content="UI Recipes"
                placement="right"
                className="w-full"
              >
                <button
                  type="button"
                  className={view.kind === 'ui-recipes' ? 'workbench-side-nav__item workbench-side-nav__item--active' : 'workbench-side-nav__item'}
                  onClick={onSelectRecipes}
                  aria-label="UI Recipes"
                  aria-current={view.kind === 'ui-recipes' ? 'page' : undefined}
                >
                  <Boxes size={18} strokeWidth={1.9} aria-hidden="true" />
                  <span className="workbench-side-nav__item-label">UI Recipes</span>
                </button>
              </Tooltip>
            </li>
            <li>
              <Tooltip
                content={getTesterCapability(workbenchLibraryCapabilityId).label}
                placement="right"
                className="w-full"
              >
                <button
                  type="button"
                  className={activeCapabilityId === workbenchLibraryCapabilityId ? 'workbench-side-nav__item workbench-side-nav__item--active' : 'workbench-side-nav__item'}
                  onClick={() => onSelectCapability(workbenchLibraryCapabilityId)}
                  aria-label={getTesterCapability(workbenchLibraryCapabilityId).label}
                  aria-current={activeCapabilityId === workbenchLibraryCapabilityId ? 'page' : undefined}
                >
                  <Compass size={18} strokeWidth={1.9} aria-hidden="true" />
                  <span className="workbench-side-nav__item-label">{getTesterCapability(workbenchLibraryCapabilityId).label}</span>
                </button>
              </Tooltip>
            </li>
          </ul>
        </div>
      </nav>
    </aside>
  );
}
