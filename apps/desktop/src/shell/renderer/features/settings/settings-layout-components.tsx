import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_SECTION_TITLE_CLASS } from '@renderer/components/typography.js';
import { C, ICON_CHEVRON_RIGHT, getSettingsMenuSections } from './settings-assets';

const SETTINGS_SECTION_KEY_BY_LABEL: Record<string, string> = {
  Account: 'Settings.sectionAccount',
  'Privacy & Security': 'Settings.sectionPrivacySecurity',
  Preferences: 'Settings.sectionPreferences',
  Extensions: 'Settings.sectionExtensions',
  Advanced: 'Settings.sectionAdvanced',
};

const SETTINGS_ITEM_KEY_BY_ID: Record<string, string> = {
  profile: 'Settings.menuProfile',
  language: 'Settings.menuLanguage',
  privacy: 'Settings.menuPrivacy',
  security: 'Settings.menuSecurity',
  data: 'Settings.menuData',
  notifications: 'Settings.menuNotifications',
  performance: 'Settings.menuPerformance',
  extensions: 'Settings.menuModSettings',
  wallet: 'Settings.menuWallet',
  developer: 'Settings.menuDeveloper',
};

function resolveSettingsSectionLabelKey(label: string): string | null {
  return SETTINGS_SECTION_KEY_BY_LABEL[label] || null;
}

function resolveSettingsItemLabelKey(itemId: string): string | null {
  return SETTINGS_ITEM_KEY_BY_ID[itemId] || null;
}

export function Card({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`rounded-[10px] border border-gray-200 bg-white ${className}`} style={style}>
      {children}
    </div>
  );
}

export function PageShell({
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto bg-[#F8F9FB]">
        <div className="mx-auto max-w-2xl px-6 py-6" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {children}
        </div>
      </div>
      {footer}
    </div>
  );
}

export function SectionTitle({ children, description }: { children: ReactNode; description?: string }) {
  return (
    <div>
      <h3 className={APP_SECTION_TITLE_CLASS}>{children}</h3>
      {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
    </div>
  );
}

export function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={`text-sm font-medium ${highlight ? 'text-brand-600' : 'text-gray-900'}`}>{value}</span>
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-sm',
  };

  const variantClasses = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-gray-300',
    secondary: 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:bg-gray-100',
    ghost: 'text-gray-600 hover:bg-gray-50 disabled:text-gray-300',
    danger: 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors disabled:cursor-not-allowed ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

export function SaveFooter({
  onCancel,
  onSave,
  saving,
  showCancel = true,
}: {
  onCancel?: () => void;
  onSave?: () => void;
  saving?: boolean;
  showCancel?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-200 bg-white px-6 py-4">
      {showCancel ? (
        <Button variant="secondary" onClick={onCancel}>
          {t('Common.cancel')}
        </Button>
      ) : null}
      <Button variant="primary" onClick={onSave} disabled={saving}>
        {saving ? t('Common.saving') : t('Common.saveChanges')}
      </Button>
    </div>
  );
}

export function StatusBadge({
  status,
  text,
}: {
  status: 'success' | 'warning' | 'error' | 'info';
  text: string;
}) {
  const styles = {
    success: { bg: C.green50, text: C.green700 },
    warning: { bg: C.orange50, text: C.orange700 },
    error: { bg: C.red50, text: C.red700 },
    info: { bg: C.brand50, text: C.brand700 },
  };
  const style = styles[status];

  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {text}
    </span>
  );
}

export function SidebarNav({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const menuSections = getSettingsMenuSections();

  return (
    <nav className="flex flex-col px-3 pt-2" style={{ gap: '20px' }}>
      {menuSections.map((section) => {
        const sectionKey = resolveSettingsSectionLabelKey(section.label);
        const sectionLabel = sectionKey ? t(sectionKey) : section.label;
        return (
          <div key={section.label}>
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.6px] text-gray-400">
              {sectionLabel}
            </p>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = selected === item.id;
                const itemKey = resolveSettingsItemLabelKey(item.id);
                const itemTitle = itemKey ? t(itemKey) : item.title;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-sm transition-all ${
                      active
                        ? 'bg-mint-50 font-medium text-mint-700 ring-1 ring-mint-200'
                        : 'text-gray-600 hover:bg-mint-50/50'
                    }`}
                  >
                    <span className={active ? 'text-mint-600' : 'text-gray-400'}>{item.icon}</span>
                    <span>{itemTitle}</span>
                    {active && <span className="ml-auto text-mint-600">{ICON_CHEVRON_RIGHT}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
