import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@nimiplatform/nimi-kit/ui';

export type GenericMetricDetailShellProps = {
  backTo?: string;
  backLabel?: ReactNode;
  topAction?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Generic fallback shell for read-only metric detail pages (typed by
 * routes.yaml as the "通用兜底" surface). Distinct from
 * `ProfileDetailShell` by design — uses pill ArrowLeft back + max-w-5xl
 * + tight top padding to visually signal "you are on a generic fallback
 * page" rather than a领域 detail page.
 *
 * Body content (metric summary surface, history list, etc.) is fully
 * caller-provided; this shell only owns the outer container + back row.
 */
export function GenericMetricDetailShell({
  backTo = '/profile',
  backLabel,
  topAction,
  children,
  className,
}: GenericMetricDetailShellProps) {
  const { t } = useTranslation();
  const label = backLabel ?? t('Profile.detail.back', { defaultValue: 'Back' });
  return (
    <div className={cn('h-full overflow-y-auto hide-scrollbar bg-transparent', className)}>
      <div className="mx-auto max-w-5xl px-6 pb-8 pt-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link
            to={backTo}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
              'bg-[color-mix(in_srgb,var(--nimi-surface-card)_35%,transparent)] text-[var(--nimi-text-muted)]',
              'hover:bg-[var(--nimi-action-ghost-hover)]',
            )}
          >
            <ArrowLeft size={14} />
            {label}
          </Link>
          {topAction}
        </div>
        {children}
      </div>
    </div>
  );
}
