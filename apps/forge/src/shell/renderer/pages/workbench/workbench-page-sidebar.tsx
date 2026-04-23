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
    <aside className="w-80 shrink-0 p-3 pr-0">
      <Surface
        tone="card"
        material="glass-regular"
        elevation="raised"
        padding="md"
        className="flex h-full flex-col rounded-[24px]"
      >
      <Button
        tone="ghost"
        size="sm"
        onClick={onBack}
        className="justify-start px-0 text-xs uppercase tracking-[0.18em]"
      >
        Workbench
      </Button>
      <div className="mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--nimi-accent-text)]">
          Active Workspace
        </p>
        <h1 className="mt-2 text-xl font-semibold text-[var(--nimi-text-primary)]">{snapshot.workspace.title}</h1>
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
            tone={panel === item ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => onOpenPanel(item)}
            className="w-full justify-start rounded-xl text-left"
          >
            {item.replaceAll('_', ' ')}
          </Button>
        ))}
      </nav>

      <Surface tone="card" material="glass-thin" padding="sm" className="mt-8">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--nimi-text-muted)]">Local Status</p>
        <div className="mt-3 space-y-2 text-sm text-[var(--nimi-text-secondary)]">
          <p>{snapshot.importSessions.length} import session(s)</p>
          <p>{snapshot.reviewState.conflicts.length} conflict record(s)</p>
          <p>Updated {formatDate(snapshot.updatedAt)}</p>
        </div>
      </Surface>
      </Surface>
    </aside>
  );
}
