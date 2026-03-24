import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { APP_SECTION_TITLE_CLASS } from '@renderer/components/typography.js';
import { C } from './settings-assets.js';

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
      <ScrollShell className="flex-1 bg-[#F8F9FB]" viewportClassName="bg-[#F8F9FB]">
        <div className="mx-auto max-w-2xl px-6 py-6" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {children}
        </div>
      </ScrollShell>
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
