import { type CSSProperties, type ComponentPropsWithoutRef, type MouseEvent, type ReactNode } from 'react';
import { IconButton } from './action.js';
import {
  SIDEBAR_AFFORDANCE_CLASS,
  SIDEBAR_FAMILY_CLASS,
  SIDEBAR_ITEM_KIND_CLASS,
  cx,
  type SidebarAffordance,
  type SidebarFamily,
  type SidebarItemKind,
} from './design-tokens.js';
import { Surface } from './surface.js';

const SEARCH_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const CLEAR_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

type SidebarShellProps = {
  as?: 'aside' | 'div';
  family?: SidebarFamily;
  width?: number | string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
} & Omit<ComponentPropsWithoutRef<'aside'>, 'children' | 'className' | 'style'>;

export function SidebarShell({
  as,
  family = 'desktop-sidebar-v1',
  width,
  children,
  className,
  style,
  ...rest
}: SidebarShellProps) {
  const mergedStyle = width === undefined
    ? style
    : { ...style, width: typeof width === 'number' ? `${width}px` : width };

  return (
    <Surface
      as={as || 'aside'}
      tone="panel"
      elevation="base"
      padding="none"
      className={cx(
        'relative flex shrink-0 flex-col rounded-none border-y-0 border-l-0 border-r',
        SIDEBAR_FAMILY_CLASS[family],
        className,
      )}
      style={mergedStyle}
      {...rest}
    >
      {children}
    </Surface>
  );
}

export function SidebarHeader(props: { title: ReactNode; className?: string }) {
  return (
    <div className={cx('nimi-sidebar-header flex shrink-0 items-center', props.className)}>
      {props.title}
    </div>
  );
}

type SidebarSearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  onClear?: () => void;
  clearLabel?: string;
  primaryAction?: ReactNode;
  className?: string;
};

export function SidebarSearch({
  value,
  onChange,
  placeholder,
  ariaLabel,
  onClear,
  clearLabel = 'Clear',
  primaryAction,
  className,
}: SidebarSearchProps) {
  return (
    <div className={cx('nimi-sidebar-search-row', className)}>
      <div className="flex min-h-10 items-center gap-2">
        <div className="nimi-sidebar-search flex min-w-0 flex-1 px-4">
          <span className="shrink-0 text-gray-400">{SEARCH_ICON}</span>
          <input
            className="nimi-sidebar-search__field ml-1 text-sm"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            aria-label={ariaLabel || placeholder}
          />
          {value && onClear ? (
            <IconButton
              icon={CLEAR_ICON}
              size="sm"
              tone="ghost"
              onClick={onClear}
              className="ml-1 h-6 w-6 text-gray-400 hover:text-gray-600"
              aria-label={clearLabel}
              title={clearLabel}
            />
          ) : null}
        </div>
        {primaryAction ? <div className="shrink-0">{primaryAction}</div> : null}
      </div>
    </div>
  );
}

export function SidebarSection(props: { label?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <section className={cx('nimi-sidebar-section', props.className)}>
      {props.label ? <div className="nimi-sidebar-section-label">{props.label}</div> : null}
      {props.children}
    </section>
  );
}

type SidebarItemProps = {
  kind: SidebarItemKind;
  active?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  trailingAffordance?: SidebarAffordance | SidebarAffordance[];
  className?: string;
} & Omit<ComponentPropsWithoutRef<'button'>, 'children'>;

export function SidebarItem({
  kind,
  active = false,
  icon,
  label,
  description,
  trailing,
  trailingAffordance,
  className,
  type = 'button',
  ...rest
}: SidebarItemProps) {
  const affordanceClasses = Array.isArray(trailingAffordance)
    ? trailingAffordance.map((item) => SIDEBAR_AFFORDANCE_CLASS[item]).join(' ')
    : (trailingAffordance ? SIDEBAR_AFFORDANCE_CLASS[trailingAffordance] : '');

  return (
    <button
      type={type}
      className={cx(
        'nimi-sidebar-item',
        SIDEBAR_ITEM_KIND_CLASS[kind],
        active && 'nimi-sidebar-item--active',
        className,
      )}
      {...rest}
    >
      {icon ? <span className="inline-flex shrink-0 items-center justify-center">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="nimi-sidebar-item__title block truncate">{label}</span>
        {description ? <span className="nimi-sidebar-item__description block truncate">{description}</span> : null}
      </span>
      {trailing ? <span className={cx('nimi-sidebar-affordance shrink-0', affordanceClasses)}>{trailing}</span> : null}
    </button>
  );
}

type SidebarResizeHandleProps = {
  ariaLabel: string;
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  className?: string;
};

export function SidebarResizeHandle({
  ariaLabel,
  onMouseDown,
  className,
}: SidebarResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onMouseDown={onMouseDown}
      className={cx(
        'nimi-sidebar-resize-handle absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize',
        className,
      )}
    />
  );
}
