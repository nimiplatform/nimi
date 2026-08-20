import { StatusBadge, Surface } from '@nimiplatform/kit/ui';

export type WorkbenchEmptyStateProps = {
  readonly appTitle: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
};

export function WorkbenchEmptyState({
  appTitle,
  eyebrow,
  title,
  description,
  status,
}: WorkbenchEmptyStateProps) {
  return (
    <section className="workbench-empty-state" data-testid="workbench-empty-state">
      <Surface className="workbench-empty-state__panel" material="glass-regular" tone="panel" elevation="raised">
        <p className="workbench-empty-state__eyebrow">{eyebrow}</p>
        <div className="workbench-empty-state__heading">
          <h1>{appTitle}</h1>
          <StatusBadge tone="neutral" shape="dot">{status}</StatusBadge>
        </div>
        <h2>{title}</h2>
        <p className="workbench-empty-state__description">{description}</p>
      </Surface>
    </section>
  );
}
