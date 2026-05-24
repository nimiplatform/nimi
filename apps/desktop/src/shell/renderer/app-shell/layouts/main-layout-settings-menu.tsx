import { useTranslation } from 'react-i18next';
import { ScrollArea, Surface } from '@nimiplatform/kit/ui';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { SHELL_CHROME_MENU_ITEM_BASE_CLASS, SHELL_CHROME_OVERLAY_CLASS } from './shell-chrome-classes';
import { renderShellNavIcon } from './navigation-config';

export type SettingsSubmenuItemId =
  | 'profile'
  | 'wallet'
  | 'settings'
  | 'support'
  | 'developer-tools'
  | 'terms-of-service'
  | 'privacy-policy'
  | 'logout';

const SETTINGS_SUBMENU_ITEMS: Array<{ id: SettingsSubmenuItemId; label: string; icon: string }> = [
  { id: 'profile', label: 'Profile', icon: 'profile' },
  { id: 'wallet', label: 'Wallet', icon: 'wallet' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'support', label: 'Support', icon: 'support' },
  { id: 'developer-tools', label: 'Developer Tools', icon: 'developer-tools' },
  { id: 'terms-of-service', label: 'Terms of Service', icon: 'terms-of-service' },
  { id: 'privacy-policy', label: 'Privacy Policy', icon: 'privacy-policy' },
  { id: 'logout', label: 'Logout', icon: 'logout' },
];

const SETTINGS_SUBMENU_I18N_KEYS: Record<SettingsSubmenuItemId, string> = {
  profile: 'Menu.profile',
  wallet: 'Menu.wallet',
  settings: 'Menu.settings',
  support: 'Menu.support',
  'developer-tools': 'DeveloperTools.navLabel',
  'terms-of-service': 'Menu.termsOfService',
  'privacy-policy': 'Menu.privacyPolicy',
  logout: 'Menu.logout',
};

type MainLayoutSettingsMenuProps = {
  top: number;
  left: number;
  userAvatarUrl?: string | null;
  displayName: string;
  userEmail?: string | null;
  developerModeEnabled: boolean;
  isItemActive: (itemId: SettingsSubmenuItemId) => boolean;
  onOpenItem: (itemId: SettingsSubmenuItemId) => void;
  onEditProfile: () => void;
  onLogout: () => void;
};

function MenuChevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[color-mix(in_srgb,var(--nimi-text-secondary)_45%,white)]">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function MainLayoutSettingsMenu(props: MainLayoutSettingsMenuProps) {
  const { t } = useTranslation();
  const items = SETTINGS_SUBMENU_ITEMS.filter((item) => (
    item.id !== 'logout'
    && item.id !== 'profile'
    && (item.id !== 'developer-tools' || props.developerModeEnabled)
  ));

  return (
    <div className="fixed z-[11010]" style={{ top: `${props.top}px`, left: `${props.left}px` }}>
      <Surface tone="overlay" material="glass-thick" padding="none" className={`flex max-h-[calc(100vh-100px)] w-64 flex-col overflow-hidden py-2 ${SHELL_CHROME_OVERLAY_CLASS}`}>
        <div className="flex items-center gap-3 px-4 py-3">
          <EntityAvatar imageUrl={props.userAvatarUrl} name={props.displayName} kind="human" sizeClassName="h-10 w-10" textClassName="text-sm font-semibold" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{props.displayName}</p>
            {props.userEmail ? <p className="truncate text-xs text-[var(--nimi-text-secondary)]">{props.userEmail}</p> : null}
          </div>
          <button type="button" onClick={props.onEditProfile} className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--nimi-text-secondary)] transition hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-action-primary-bg)]" title={t('Layout.editProfile', { defaultValue: 'Edit Profile' })}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        </div>
        <div className="mx-4 my-2 h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,white)] to-transparent" />
        <ScrollArea className="flex-1">
          <div className="px-2">
            <button type="button" onClick={() => props.onOpenItem('profile')} className={`${SHELL_CHROME_MENU_ITEM_BASE_CLASS} ${props.isItemActive('profile') ? 'bg-[var(--nimi-action-ghost-hover)] text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,white)]'}`}>
              <span className={`w-4 shrink-0 ${props.isItemActive('profile') ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-secondary)]'}`}>{renderShellNavIcon('profile')}</span>
              <span className="min-w-0 flex-1 text-left font-medium">{t(SETTINGS_SUBMENU_I18N_KEYS.profile, 'Profile')}</span>
              <MenuChevron />
            </button>
            {items.map((item) => {
              const active = props.isItemActive(item.id);
              return (
                <button key={item.id} type="button" onClick={() => props.onOpenItem(item.id)} className={`${SHELL_CHROME_MENU_ITEM_BASE_CLASS} ${active ? 'bg-[var(--nimi-action-ghost-hover)] text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,white)]'}`}>
                  <span className={`w-4 shrink-0 ${active ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-secondary)]'}`}>{renderShellNavIcon(item.icon)}</span>
                  <span className="min-w-0 flex-1 text-left font-medium">{t(SETTINGS_SUBMENU_I18N_KEYS[item.id], item.label)}</span>
                  <MenuChevron />
                </button>
              );
            })}
          </div>
          <div className="mx-4 my-2 h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--nimi-text-secondary)_14%,white)] to-transparent" />
          <div className="px-2 pb-2">
            <button type="button" onClick={props.onLogout} className={`${SHELL_CHROME_MENU_ITEM_BASE_CLASS} text-[var(--nimi-text-primary)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,white)]`}>
              <span className="w-4 shrink-0 text-[var(--nimi-text-secondary)]">{renderShellNavIcon('logout')}</span>
              <span className="min-w-0 flex-1 text-left font-medium">{t('Menu.logout', 'Log out')}</span>
              <MenuChevron />
            </button>
          </div>
        </ScrollArea>
      </Surface>
    </div>
  );
}
