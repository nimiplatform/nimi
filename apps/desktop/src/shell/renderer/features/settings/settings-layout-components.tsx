import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button as KitButton,
  ScrollArea,
  StatusBadge as KitStatusBadge,
  Surface,
} from '@nimiplatform/nimi-kit/ui';

/* ------------------------------------------------------------------ */
/*  Card — thin wrapper around kit Surface with tone="card"           */
/* ------------------------------------------------------------------ */

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
    <Surface tone="card" padding="none" className={className} style={style}>
      {children}
    </Surface>
  );
}

/* ------------------------------------------------------------------ */
/*  PageShell — settings page chrome with kit ScrollArea              */
/* ------------------------------------------------------------------ */

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
      <ScrollArea className="flex-1 bg-[#F8F9FB]" viewportClassName="bg-[#F8F9FB]">
        <div className="mx-auto max-w-2xl px-6 py-6" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {children}
        </div>
      </ScrollArea>
      {footer}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SectionTitle — typography composition (kept as-is)                */
/* ------------------------------------------------------------------ */

export function SectionTitle({ children, description }: { children: ReactNode; description?: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900">{children}</h3>
      {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  InfoRow — layout composition (kept as-is)                         */
/* ------------------------------------------------------------------ */

export function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={`text-sm font-medium ${highlight ? 'text-mint-600' : 'text-gray-900'}`}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Button — delegates to kit Button, mapping variant→tone            */
/* ------------------------------------------------------------------ */

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
  return (
    <KitButton
      tone={variant}
      size={size}
      leadingIcon={icon}
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {children}
    </KitButton>
  );
}

/* ------------------------------------------------------------------ */
/*  SaveFooter — composition using local Button wrapper               */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  StatusBadge — delegates to kit StatusBadge, mapping status→tone   */
/* ------------------------------------------------------------------ */

const STATUS_TO_TONE = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  info: 'info',
} as const;

export function StatusBadge({
  status,
  text,
}: {
  status: 'success' | 'warning' | 'error' | 'info';
  text: string;
}) {
  return (
    <KitStatusBadge tone={STATUS_TO_TONE[status]}>
      {text}
    </KitStatusBadge>
  );
}
