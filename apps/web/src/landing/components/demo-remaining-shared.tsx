import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewNotice } from './demo-third-party-shared.js';

export type PreviewNavItem = { id: string; label: string; Icon: LucideIcon };

export function RemainingPreview({
  content,
  kind,
  children,
}: {
  content: RemainingPreviewMeta;
  kind: string;
  children: ReactNode;
}) {
  const { previewLang } = useAppPreviewLocale();
  return (
    <div
      className={`tp-preview rp-preview rp-${kind}`}
      data-demo-remaining-app={content.id}
      lang={previewLang}
    >
      {children}
      <PreviewNotice>{content.notice}</PreviewNotice>
    </div>
  );
}

export function PreviewNav({
  content,
  items,
  active,
  onSelect,
  footer,
}: {
  content: RemainingPreviewMeta;
  items: readonly PreviewNavItem[];
  active: string;
  onSelect: (id: string) => void;
  footer?: ReactNode;
}) {
  const { t } = useAppPreviewLocale();
  return (
    <aside className="rp-navigation">
      <div className="rp-brand">
        <img src={content.icon} alt={''} />
        <strong>{content.name}</strong>
      </div>
      <nav aria-label={t('shared.previewNav.appNavigation')}>
        {items.map(({ id, label, Icon }) => (
          <button
            type="button"
            key={id}
            aria-label={label}
            title={label}
            aria-current={active === id ? 'page' : undefined}
            onClick={() => onSelect(id)}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {footer && <div className="rp-nav-footer">{footer}</div>}
    </aside>
  );
}

export function PreviewHeading({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="rp-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="rp-heading-actions">{children}</div>}
    </header>
  );
}

export function PreviewTabs({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="rp-tabs" role="group" aria-label={label}>
      {items.map(({ value: item, label: itemLabel }) => (
        <button
          type="button"
          key={item}
          aria-pressed={value === item}
          onClick={() => onChange(item)}
        >
          {itemLabel}
        </button>
      ))}
    </div>
  );
}
