import type { ReactNode } from 'react';
import {
  Boxes,
  Cable,
  Compass,
} from 'lucide-react';
import { Button, Tooltip } from '@nimiplatform/kit/ui';
import { getTesterCapability, type TesterCapabilityId } from '../tester-capabilities.js';
import { capabilityIcons } from './capability-icons.js';
import { workbenchLibraryCapabilityId, workbenchNavGroups, type WorkbenchView } from './workbench-context.js';

type WorkbenchSideNavProps = {
  view: WorkbenchView;
  onSelectCapability: (id: TesterCapabilityId) => void;
  onSelectRecipes: () => void;
  onSelectAppAccess: () => void;
  accountSlot?: ReactNode;
};

export function WorkbenchSideNav({
  view,
  onSelectCapability,
  onSelectRecipes,
  onSelectAppAccess,
  accountSlot,
}: WorkbenchSideNavProps) {
  const activeCapabilityId = view.kind === 'capability' ? view.capabilityId : null;
  return (
    <aside
      className="workbench-side-nav"
      aria-label="Nimi Lab workspace navigation"
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
                      <Button
                        type="button"
                        tone="ghost"
                        size="sm"
                        data-nimi-semantic-id={id === 'text.generate' ? 'tester-primary-action' : undefined}
                        data-workbench-rail-item=""
                        className={active ? 'workbench-side-nav__item workbench-side-nav__item--active' : 'workbench-side-nav__item'}
                        onClick={() => onSelectCapability(id)}
                        aria-label={label}
                        aria-current={active ? 'page' : undefined}
                      >
                        <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
                        <span className="workbench-side-nav__item-label" data-workbench-rail-label="">{label}</span>
                      </Button>
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
                content={getTesterCapability(workbenchLibraryCapabilityId).label}
                placement="right"
                className="w-full"
              >
                <Button
                  type="button"
                  tone="ghost"
                  size="sm"
                  data-workbench-rail-item=""
                  className={activeCapabilityId === workbenchLibraryCapabilityId ? 'workbench-side-nav__item workbench-side-nav__item--active' : 'workbench-side-nav__item'}
                  onClick={() => onSelectCapability(workbenchLibraryCapabilityId)}
                  aria-label={getTesterCapability(workbenchLibraryCapabilityId).label}
                  aria-current={activeCapabilityId === workbenchLibraryCapabilityId ? 'page' : undefined}
                >
                  <Compass size={18} strokeWidth={1.9} aria-hidden="true" />
                  <span className="workbench-side-nav__item-label" data-workbench-rail-label="">{getTesterCapability(workbenchLibraryCapabilityId).label}</span>
                </Button>
              </Tooltip>
            </li>
          </ul>
        </div>
        <div className="workbench-side-nav__group" data-nav-placement="bottom">
          <ul>
            <li>
              <Tooltip
                content="App Access"
                placement="right"
                className="w-full"
              >
                <Button
                  type="button"
                  tone="ghost"
                  size="sm"
                  data-workbench-rail-item=""
                  className={view.kind === 'app-access' ? 'workbench-side-nav__item workbench-side-nav__item--active' : 'workbench-side-nav__item'}
                  onClick={onSelectAppAccess}
                  aria-label="App Access"
                  aria-current={view.kind === 'app-access' ? 'page' : undefined}
                >
                  <Cable size={18} strokeWidth={1.9} aria-hidden="true" />
                  <span className="workbench-side-nav__item-label" data-workbench-rail-label="">App Access</span>
                </Button>
              </Tooltip>
            </li>
            <li>
              <Tooltip
                content="UI Recipes"
                placement="right"
                className="w-full"
              >
                <Button
                  type="button"
                  tone="ghost"
                  size="sm"
                  data-workbench-rail-item=""
                  className={view.kind === 'ui-recipes' ? 'workbench-side-nav__item workbench-side-nav__item--active' : 'workbench-side-nav__item'}
                  onClick={onSelectRecipes}
                  aria-label="UI Recipes"
                  aria-current={view.kind === 'ui-recipes' ? 'page' : undefined}
                >
                  <Boxes size={18} strokeWidth={1.9} aria-hidden="true" />
                  <span className="workbench-side-nav__item-label" data-workbench-rail-label="">UI Recipes</span>
                </Button>
              </Tooltip>
            </li>
            {accountSlot ? (
              <li className="workbench-side-nav__account">
                {accountSlot}
              </li>
            ) : null}
          </ul>
        </div>
      </nav>
    </aside>
  );
}
