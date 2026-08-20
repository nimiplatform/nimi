import type { ComponentType, ReactNode } from 'react';
import { Button, Tooltip } from '@nimiplatform/kit/ui';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c

export type WorkbenchNavigationIconProps = {
  readonly size?: number;
  readonly strokeWidth?: number;
  readonly 'aria-hidden'?: boolean | 'true' | 'false';
};

export type WorkbenchNavigationItem<TViewId extends string> = {
  readonly id: TViewId;
  readonly label: string;
  readonly icon: ComponentType<WorkbenchNavigationIconProps>;
  readonly semanticId?: string;
};

export type WorkbenchNavigationGroup<TViewId extends string> = {
  readonly id: string;
  readonly items: readonly WorkbenchNavigationItem<TViewId>[];
};

export type WorkbenchCoreProps<TViewId extends string> = {
  readonly activeViewId: TViewId | null;
  readonly navigationLabel: string;
  readonly navigationGroups: readonly WorkbenchNavigationGroup<TViewId>[];
  readonly bottomNavigationItems?: readonly WorkbenchNavigationItem<TViewId>[];
  readonly onSelectView: (viewId: TViewId) => void;
  readonly accountSlot?: ReactNode;
  readonly rootTestId?: string;
  readonly children: ReactNode;
};

export function WorkbenchCore<TViewId extends string>({
  activeViewId,
  navigationLabel,
  navigationGroups,
  bottomNavigationItems = [],
  onSelectView,
  accountSlot,
  rootTestId,
  children,
}: WorkbenchCoreProps<TViewId>) {
  return (
    <main className="workbench" data-testid={rootTestId}>
      <div className="workbench__body">
        <aside className="workbench-side-nav" aria-label={navigationLabel}>
          <nav className="workbench-side-nav__groups" aria-label={navigationLabel}>
            {navigationGroups.map((group) => (
              <WorkbenchNavigationList
                key={group.id}
                activeViewId={activeViewId}
                items={group.items}
                onSelectView={onSelectView}
              />
            ))}
            {(bottomNavigationItems.length > 0 || accountSlot) ? (
              <div className="workbench-side-nav__group" data-nav-placement="bottom">
                <ul>
                  {bottomNavigationItems.map((item) => (
                    <WorkbenchNavigationListItem
                      key={item.id}
                      active={activeViewId === item.id}
                      item={item}
                      onSelectView={onSelectView}
                    />
                  ))}
                  {accountSlot ? (
                    <li className="workbench-side-nav__account">{accountSlot}</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </nav>
        </aside>
        <div className="workbench__main">
          <div className="workbench__content">{children}</div>
        </div>
      </div>
    </main>
  );
}

function WorkbenchNavigationList<TViewId extends string>({
  activeViewId,
  items,
  onSelectView,
}: {
  readonly activeViewId: TViewId | null;
  readonly items: readonly WorkbenchNavigationItem<TViewId>[];
  readonly onSelectView: (viewId: TViewId) => void;
}) {
  return (
    <div className="workbench-side-nav__group">
      <ul>
        {items.map((item) => (
          <WorkbenchNavigationListItem
            key={item.id}
            active={activeViewId === item.id}
            item={item}
            onSelectView={onSelectView}
          />
        ))}
      </ul>
    </div>
  );
}

function WorkbenchNavigationListItem<TViewId extends string>({
  active,
  item,
  onSelectView,
}: {
  readonly active: boolean;
  readonly item: WorkbenchNavigationItem<TViewId>;
  readonly onSelectView: (viewId: TViewId) => void;
}) {
  const Icon = item.icon;
  return (
    <li>
      <Tooltip content={item.label} placement="right" className="w-full">
        <Button
          type="button"
          tone="ghost"
          size="sm"
          data-nimi-semantic-id={item.semanticId}
          data-workbench-rail-item=""
          className={active ? 'workbench-side-nav__item workbench-side-nav__item--active' : 'workbench-side-nav__item'}
          onClick={() => onSelectView(item.id)}
          aria-label={item.label}
          aria-current={active ? 'page' : undefined}
        >
          <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
          <span className="workbench-side-nav__item-label" data-workbench-rail-label="">{item.label}</span>
        </Button>
      </Tooltip>
    </li>
  );
}
