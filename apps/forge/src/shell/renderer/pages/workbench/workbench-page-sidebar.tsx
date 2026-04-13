import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { formatDate } from '@renderer/components/format-utils.js';
import { PANELS, type WorkbenchPageSnapshot, type WorkbenchPanel } from './workbench-page-shared.js';

type WorkbenchPageSidebarProps = {
  snapshot: WorkbenchPageSnapshot;
  panel: WorkbenchPanel;
  onBack: () => void;
  onOpenPanel: (panel: WorkbenchPanel) => void;
};

export function WorkbenchPageSidebar({
  snapshot,
  panel,
  onBack,
  onOpenPanel,
}: WorkbenchPageSidebarProps) {
  return (
    <aside className="w-72 shrink-0 border-r border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-4 py-5">
      <Button
        tone="ghost"
        size="sm"
        onClick={onBack}
        className="text-xs uppercase tracking-[0.18em]"
      >
        Workbench
      </Button>
      <div className="mt-4">
        <h1 className="text-xl font-semibold text-[var(--nimi-text-primary)]">{snapshot.workspace.title}</h1>
        <p className="mt-1 text-sm text-[var(--nimi-text-muted)]">
          {snapshot.worldDraft.worldId ? `World ${snapshot.worldDraft.worldId.slice(0, 8)}` : 'Local draft workspace'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ForgeStatusBadge domain="workspace" status={snapshot.workspace.lifecycle} />
          <ForgeStatusBadge domain="workspace" status="WORLD_TRUTH" label={`${snapshot.reviewState.worldRules.length} world rules`} tone="info" />
          <ForgeStatusBadge domain="workspace" status="AGENTS" label={`${snapshot.reviewState.agentBundles.length} agents`} tone="success" />
        </div>
      </div>

      <nav className="mt-8 space-y-1">
        {PANELS.map((item) => (
          <Button
            key={item}
            tone={panel === item ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => onOpenPanel(item)}
            className="w-full justify-start rounded-xl text-left"
          >
            {item.replaceAll('_', ' ')}
          </Button>
        ))}
      </nav>

      <Surface tone="card" padding="sm" className="mt-8">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--nimi-text-muted)]">Local Status</p>
        <div className="mt-3 space-y-2 text-sm text-[var(--nimi-text-secondary)]">
          <p>{snapshot.importSessions.length} import session(s)</p>
          <p>{snapshot.reviewState.conflicts.length} conflict record(s)</p>
          <p>Updated {formatDate(snapshot.updatedAt)}</p>
        </div>
      </Surface>
    </aside>
  );
}
