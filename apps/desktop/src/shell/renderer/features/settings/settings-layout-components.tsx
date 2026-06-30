import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import {
  AppCardSurface,
  Button as KitButton,
  SettingsPageShell as KitSettingsPageShell,
  SettingsSectionTitle as KitSettingsSectionTitle,
  StatusBadge as KitStatusBadge,
  cn,
} from '@nimiplatform/kit/ui';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import {
  useDesktopCardMotion,
  useDesktopInteractiveMotion,
  useDesktopReducedMotion,
} from '@renderer/ui/motion/desktop-motion';

type AppCardSurfaceStyle = ComponentProps<typeof AppCardSurface>['style'];

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
  style?: AppCardSurfaceStyle;
}) {
  const cardMotion = useDesktopCardMotion();
  return (
    <motion.div
      layout
      whileHover={cardMotion.whileHover}
      whileTap={cardMotion.whileTap}
      transition={cardMotion.transition}
      className={cn(
        className,
      )}
      style={style}
    >
      <AppCardSurface kind="operational-solid">
        {children}
      </AppCardSurface>
    </motion.div>
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
    <KitSettingsPageShell
      footer={footer}
      scrollClassName="bg-transparent"
      viewportClassName="bg-transparent"
      contentClassName={cn('w-full max-w-4xl px-5 py-5', contentClassName)}
    >
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
  const interactiveMotion = useDesktopInteractiveMotion();
  return (
    <motion.span
      className="inline-flex"
      whileHover={disabled ? undefined : interactiveMotion.whileHover}
      whileTap={disabled ? undefined : interactiveMotion.whileTap}
      transition={interactiveMotion.transition}
    >
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
    </motion.span>
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
  const reducedMotion = useDesktopReducedMotion();
  return (
    <motion.div
      layout
      initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.2, 0, 0, 1] }}
      className="flex shrink-0 items-center justify-end gap-3 border-t border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] px-6 py-4"
    >
      {showCancel ? (
        <Button variant="secondary" onClick={onCancel}>
          {t('Common.cancel')}
        </Button>
      ) : null}
      <Button variant="primary" onClick={onSave} disabled={saving}>
        {saving ? t('Common.saving') : t('Common.saveChanges')}
      </Button>
    </motion.div>
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

export function FormFeedback(props: {
  feedback: InlineFeedbackState | null;
  title?: string;
  onDismiss?: () => void;
  className?: string;
}) {
  return <InlineFeedback {...props} />;
}
