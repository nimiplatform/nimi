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
  readonly detail?: string;
  readonly semanticId?: string;
};

export type WorkbenchNavigationGroup<TViewId extends string> = {
  readonly id: string;
  readonly label?: string;
  readonly items: readonly WorkbenchNavigationItem<TViewId>[];
};

export type WorkbenchCoreProps<TViewId extends string> = {
  readonly activeViewId: TViewId | null;
  readonly navigationLabel: string;
  readonly navigationPresentation?: 'rail' | 'catalog';
  readonly navigationTitle?: string;
  readonly navigationDescription?: string;
  readonly navigationGroups: readonly WorkbenchNavigationGroup<TViewId>[];
  readonly bottomNavigationItems?: readonly WorkbenchNavigationItem<TViewId>[];
  readonly bottomNavigationLabel?: string;
  readonly onSelectView: (viewId: TViewId) => void;
  readonly accountSlot?: ReactNode;
  readonly rootTestId?: string;
  readonly children: ReactNode;
};

export function WorkbenchCore<TViewId extends string>({
  activeViewId,
  navigationLabel,
  navigationPresentation = 'rail',
  navigationTitle,
  navigationDescription,
  navigationGroups,
  bottomNavigationItems = [],
  bottomNavigationLabel,
  onSelectView,
  accountSlot,
  rootTestId,
  children,
}: WorkbenchCoreProps<TViewId>) {
  return (
    <main className="workbench" data-testid={rootTestId} data-navigation-presentation={navigationPresentation}>
      <div className="workbench__body">
        <aside className="workbench-side-nav" aria-label={navigationLabel}>
          {navigationPresentation === 'catalog' && navigationTitle ? (
            <div className="workbench-side-nav__heading">
              <h1>{navigationTitle}</h1>
              {navigationDescription ? <p>{navigationDescription}</p> : null}
            </div>
          ) : null}
          <nav className="workbench-side-nav__groups" aria-label={navigationLabel}>
            {navigationGroups.map((group) => (
              <WorkbenchNavigationList
                key={group.id}
                activeViewId={activeViewId}
                items={group.items}
                label={group.label}
                onSelectView={onSelectView}
                presentation={navigationPresentation}
              />
            ))}
            {navigationPresentation === 'rail' && (bottomNavigationItems.length > 0 || accountSlot) ? (
              <div className="workbench-side-nav__group" data-nav-placement="bottom">
                <ul>
                  {bottomNavigationItems.map((item) => (
                    <WorkbenchNavigationListItem
                      key={item.id}
                      active={activeViewId === item.id}
                      item={item}
                      onSelectView={onSelectView}
                      presentation="rail"
                    />
                  ))}
                  {accountSlot ? (
                    <li className="workbench-side-nav__account">{accountSlot}</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </nav>
          {navigationPresentation === 'catalog' && (bottomNavigationItems.length > 0 || accountSlot) ? (
            <div className="workbench-side-nav__footer" role="navigation" aria-label={bottomNavigationLabel ?? navigationLabel}>
              {bottomNavigationItems.length > 0 ? (
                <WorkbenchNavigationList
                  activeViewId={activeViewId}
                  items={bottomNavigationItems}
                  label={bottomNavigationLabel}
                  onSelectView={onSelectView}
                  presentation="catalog"
                />
              ) : null}
              {accountSlot ? <div className="workbench-side-nav__account">{accountSlot}</div> : null}
            </div>
          ) : null}
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
  label,
  onSelectView,
  presentation,
}: {
  readonly activeViewId: TViewId | null;
  readonly items: readonly WorkbenchNavigationItem<TViewId>[];
  readonly label?: string;
  readonly onSelectView: (viewId: TViewId) => void;
  readonly presentation: 'rail' | 'catalog';
}) {
  return (
    <div className="workbench-side-nav__group">
      {presentation === 'catalog' && label ? <h2 className="workbench-side-nav__group-label">{label}</h2> : null}
      <ul>
        {items.map((item) => (
          <WorkbenchNavigationListItem
            key={item.id}
            active={activeViewId === item.id}
            item={item}
            onSelectView={onSelectView}
            presentation={presentation}
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
  presentation,
}: {
  readonly active: boolean;
  readonly item: WorkbenchNavigationItem<TViewId>;
  readonly onSelectView: (viewId: TViewId) => void;
  readonly presentation: 'rail' | 'catalog';
}) {
  const Icon = item.icon;
  const button = (
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
      {presentation === 'catalog' ? (
        <span className="workbench-side-nav__item-copy">
          <span className="workbench-side-nav__item-label">{item.label}</span>
          {item.detail ? <span className="workbench-side-nav__item-detail">{item.detail}</span> : null}
        </span>
      ) : (
        <span className="workbench-side-nav__item-label" data-workbench-rail-label="">{item.label}</span>
      )}
    </Button>
  );
  return (
    <li>
      {presentation === 'catalog'
        ? button
        : <Tooltip content={item.label} placement="right" className="w-full">{button}</Tooltip>}
    </li>
  );
}
