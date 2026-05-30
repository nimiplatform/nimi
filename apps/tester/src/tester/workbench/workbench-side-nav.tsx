import {
  AudioLines,
  Beaker,
  Boxes,
  Compass,
  FlaskConical,
  Image as ImageIcon,
  MessageSquareText,
  Sparkles,
  TextCursorInput,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { Surface } from '@nimiplatform/kit/ui';
import { getTesterCapability, type TesterCapabilityId } from '../tester-capabilities.js';
import { workbenchLibraryCapabilityId, workbenchNavGroups, type WorkbenchView } from './workbench-context.js';

const capabilityIcons: Record<TesterCapabilityId, LucideIcon> = {
  'text.generate': Sparkles,
  'chat.stream': MessageSquareText,
  'text.embed': TextCursorInput,
  'image.generate': ImageIcon,
  'video.generate': Video,
  'audio.synthesize': AudioLines,
  'audio.transcribe': AudioLines,
  'speech.bundle': AudioLines,
  'world.generate': Compass,
};

type WorkbenchSideNavProps = {
  view: WorkbenchView;
  onSelectCapability: (id: TesterCapabilityId) => void;
  onSelectRecipes: () => void;
  appId: string;
  appVersion: string;
};

export function WorkbenchSideNav({
  view,
  onSelectCapability,
  onSelectRecipes,
  appId,
  appVersion,
}: WorkbenchSideNavProps) {
  const activeCapabilityId = view.kind === 'capability' ? view.capabilityId : null;
  return (
    <Surface
      as="aside"
      material="glass-regular"
      padding="none"
      elevation="raised"
      className="workbench-side-nav"
      aria-label="Nimi App Lab workspace navigation"
    >
      <div className="workbench-side-nav__brand">
        <span className="workbench-side-nav__brand-mark" aria-hidden="true">
          <Beaker size={16} />
        </span>
        <div>
          <strong>Nimi App Lab</strong>
          <span>{appId}</span>
        </div>
      </div>
      <nav className="workbench-side-nav__groups">
        {workbenchNavGroups.map((group) => (
          <div key={group.label} className="workbench-side-nav__group">
            <p className="workbench-side-nav__group-title">{group.label}</p>
            <ul>
              {group.capabilityIds.map((id) => {
                const Icon = capabilityIcons[id];
                const active = activeCapabilityId === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={active ? 'workbench-side-nav__item workbench-side-nav__item--active' : 'workbench-side-nav__item'}
                      onClick={() => onSelectCapability(id)}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon size={15} aria-hidden="true" />
                      <span className="workbench-side-nav__item-label">{getTesterCapability(id).label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div className="workbench-side-nav__group">
          <p className="workbench-side-nav__group-title">Library</p>
          <ul>
            <li>
              <button
                type="button"
                className={view.kind === 'ui-recipes' ? 'workbench-side-nav__item workbench-side-nav__item--active' : 'workbench-side-nav__item'}
                onClick={onSelectRecipes}
                aria-current={view.kind === 'ui-recipes' ? 'page' : undefined}
              >
                <Boxes size={15} aria-hidden="true" />
                <span className="workbench-side-nav__item-label">UI Recipes</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className={activeCapabilityId === workbenchLibraryCapabilityId ? 'workbench-side-nav__item workbench-side-nav__item--active' : 'workbench-side-nav__item'}
                onClick={() => onSelectCapability(workbenchLibraryCapabilityId)}
                aria-current={activeCapabilityId === workbenchLibraryCapabilityId ? 'page' : undefined}
              >
                <Compass size={15} aria-hidden="true" />
                <span className="workbench-side-nav__item-label">{getTesterCapability(workbenchLibraryCapabilityId).label}</span>
              </button>
            </li>
          </ul>
        </div>
      </nav>
      <div className="workbench-side-nav__footer">
        <span className="workbench-side-nav__footer-build">
          <FlaskConical size={12} aria-hidden="true" />
          v{appVersion}
        </span>
        <span>developer-only</span>
      </div>
    </Surface>
  );
}
