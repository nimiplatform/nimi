import { useState, type ReactElement, type ReactNode } from 'react';
import { OverlayShell, ScrollArea } from '@nimiplatform/kit/ui';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-appacc-001
// @nimi-authority: rule.nimi.desktop.shell-ui.r061

export interface AppsPropertiesRow {
  readonly label: string;
  readonly value: string;
  readonly icon?: ReactNode;
  readonly mono?: boolean;
}

export interface AppsPropertiesSection {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly rows?: readonly AppsPropertiesRow[];
  readonly content?: ReactNode;
}

/**
 * Steam-style two-pane properties dialog. The left rail carries the App name in
 * the accent color above section navigation; the right pane shows one section at
 * a time, with fields laid out as soft filled bars rather than an admin-style
 * bordered definition table.
 */
export function AppsPropertiesDialog({ open, appName, sections, onClose }: {
  readonly open: boolean;
  readonly appName: string;
  readonly sections: readonly AppsPropertiesSection[];
  readonly onClose: () => void;
}): ReactElement | null {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const active = sections.find((section) => section.id === selectedId) ?? sections[0];
  if (!active) return null;

  const sidebar = (
    <nav aria-label={appName} className="flex flex-col gap-0.5">
      <p className="mb-3 truncate px-3 text-sm font-semibold text-[var(--nimi-action-primary-bg)]">
        {appName}
      </p>
      {sections.map((section) => {
        const isActive = section.id === active.id;
        return (
          <button
            key={section.id}
            type="button"
            data-testid={`apps-properties-nav:${section.id}`}
            aria-current={isActive ? 'true' : undefined}
            onClick={() => setSelectedId(section.id)}
            className={`rounded-lg px-3 py-2 text-left text-sm transition-colors ${isActive
              ? 'bg-[var(--nimi-sidebar-item-active)] font-medium text-[var(--nimi-text-primary)]'
              : 'text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-sidebar-item-hover)] hover:text-[var(--nimi-text-primary)]'}`}
          >
            {section.label}
          </button>
        );
      })}
    </nav>
  );

  return (
    <OverlayShell
      open={open}
      kind="dialog"
      size="lg"
      onClose={onClose}
      title={(
        <span className="text-xl font-semibold leading-7 text-[color:var(--nimi-text-primary)]">
          {active.label}
        </span>
      )}
      sidebar={sidebar}
      sidebarClassName="bg-[var(--nimi-sidebar-canvas)]"
      panelStyle={{ height: 'min(620px, calc(100vh - 3rem))', maxHeight: 'calc(100vh - 3rem)' }}
      panelClassName="flex flex-col overflow-hidden"
      contentClassName="flex min-h-0 flex-1 flex-col px-0 py-0"
      data-testid="apps-detail-properties-dialog"
    >
      <ScrollArea className="min-h-0 flex-1" contentClassName="px-6 pb-6 pt-2">
        {active.description ? (
          <p className="mb-4 max-w-2xl text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
            {active.description}
          </p>
        ) : null}
        {active.rows ? (
          <dl className="space-y-2">
            {active.rows.map((row) => (
              <AppsPropertiesRowItem key={row.label} row={row} />
            ))}
          </dl>
        ) : null}
        {active.content}
      </ScrollArea>
    </OverlayShell>
  );
}

export function AppsPropertiesRowItem({ row }: { readonly row: AppsPropertiesRow }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-card)_72%,transparent)] px-4 py-3">
      <dt className="flex shrink-0 items-center gap-2 text-sm text-[color:var(--nimi-text-muted)]">
        {row.icon ? <span aria-hidden="true">{row.icon}</span> : null}
        {row.label}
      </dt>
      <dd className={`min-w-0 text-right text-sm text-[color:var(--nimi-text-primary)] ${row.mono ? 'break-all font-mono text-xs leading-5' : 'break-words'}`}>
        {row.value}
      </dd>
    </div>
  );
}
