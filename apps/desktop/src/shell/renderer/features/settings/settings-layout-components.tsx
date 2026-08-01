import { type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import {
  AppCardSurface,
  Button as KitButton,
  NimiText,
  SettingsPageShell as KitSettingsPageShell,
  SettingsSectionTitle as KitSettingsSectionTitle,
  StatusBadge as KitStatusBadge,
  Toggle as KitToggle,
  cn,
} from '@nimiplatform/kit/ui';
import { InlineFeedback, type InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import {
  useDesktopCardMotion,
  useDesktopInteractiveMotion,
  useDesktopReducedMotion,
} from '../../ui/motion/desktop-motion';

type AppCardSurfaceStyle = ComponentProps<typeof AppCardSurface>['style'];

/* ------------------------------------------------------------------ */
/*  PageShell — settings page chrome: header + kit scroll shell       */
/* ------------------------------------------------------------------ */

export function PageShell({
  title,
  description,
  status,
  children,
  footer,
  contentClassName,
}: {
  title: string;
  description?: string;
  status?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  contentClassName?: string;
}) {
  return (
    <KitSettingsPageShell
      footer={footer}
      scrollClassName="bg-transparent"
      viewportClassName="bg-transparent"
      contentClassName={cn('w-full max-w-4xl gap-4 px-5 py-5', contentClassName)}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <NimiText as="h2" role="page-title">
            {title}
          </NimiText>
          {description ? (
            <NimiText role="helper" className="mt-1">
              {description}
            </NimiText>
          ) : null}
        </div>
        {status ? <div className="flex shrink-0 items-center pt-1">{status}</div> : null}
      </header>
      {children}
    </KitSettingsPageShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Section — titled settings section (16px rhythm via PageShell gap) */
/* ------------------------------------------------------------------ */

export function Section({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      {title ? <KitSettingsSectionTitle description={description}>{title}</KitSettingsSectionTitle> : null}
      {children}
    </section>
  );
}

export function SectionTitle({ children, description }: { children: ReactNode; description?: string }) {
  return <KitSettingsSectionTitle description={description}>{children}</KitSettingsSectionTitle>;
}

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
    >
      <AppCardSurface kind="operational-solid" className={cn('p-4', className)} style={style}>
        {children}
      </AppCardSurface>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  SettingRow / ToggleRow — canonical row composition                */
/* ------------------------------------------------------------------ */

export function SettingRow({
  icon,
  title,
  description,
  control,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  control: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3 py-3', className)}>
      {icon ? (
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--nimi-radius-md)] text-[var(--nimi-text-muted)]">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-[length:var(--nimi-type-label-size)] font-medium text-[var(--nimi-text-primary)]">{title}</p>
        {description ? (
          <p className="mt-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{description}</p>
        ) : null}
      </div>
      <div className="max-w-full shrink-0">{control}</div>
    </div>
  );
}

export function ToggleRow({
  icon,
  title,
  description,
  checked,
  onChange,
  disabled,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <SettingRow
      icon={icon}
      title={title}
      description={description}
      className={className}
      control={<KitToggle checked={checked} onChange={onChange} disabled={disabled} ariaLabel={title} />}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  InfoRow — label/value row                                         */
/* ------------------------------------------------------------------ */

export function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[length:var(--nimi-type-body-size)] text-[var(--nimi-text-secondary)]">{label}</span>
      <span
        className={cn(
          'text-[length:var(--nimi-type-body-size)] font-medium',
          highlight ? 'text-mint-600' : 'text-[var(--nimi-text-primary)]',
        )}
      >
        {value}
      </span>
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
  disabled = false,
}: {
  onCancel?: () => void;
  onSave?: () => void;
  saving?: boolean;
  showCancel?: boolean;
  disabled?: boolean;
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
      <Button variant="primary" onClick={onSave} disabled={saving || disabled}>
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

/* ------------------------------------------------------------------ */
/*  FormFeedback — real inline feedback (no toast-only dead props)    */
/* ------------------------------------------------------------------ */

export function FormFeedback(props: {
  feedback: InlineFeedbackState | null;
  title?: string;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <InlineFeedback
      feedback={props.feedback}
      title={props.title}
      onDismiss={props.onDismiss}
      className={props.className}
    />
  );
}
