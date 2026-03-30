import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button as KitButton,
  SettingsCard as KitSettingsCard,
  SettingsPageShell as KitSettingsPageShell,
  SettingsSectionTitle as KitSettingsSectionTitle,
  StatusBadge as KitStatusBadge,
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
    <KitSettingsCard className={className} style={style}>
      {children}
    </KitSettingsCard>
  );
}

/* ------------------------------------------------------------------ */
/*  PageShell — settings page chrome with kit ScrollArea              */
/* ------------------------------------------------------------------ */

export function PageShell({
  children,
  footer,
  contentClassName,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  contentClassName?: string;
}) {
  return (
    <KitSettingsPageShell footer={footer} contentClassName={contentClassName}>
      {children}
    </KitSettingsPageShell>
  );
}

/* ------------------------------------------------------------------ */
/*  SectionTitle — typography composition (kept as-is)                */
/* ------------------------------------------------------------------ */

export function SectionTitle({ children, description }: { children: ReactNode; description?: string }) {
  return <KitSettingsSectionTitle description={description}>{children}</KitSettingsSectionTitle>;
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
    <div className="flex shrink-0 items-center justify-end gap-3 bg-white px-6 py-4">
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
