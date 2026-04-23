import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgeEmptyState } from '@renderer/components/page-layout.js';
import { ForgeListCard } from '@renderer/components/card-list.js';
import type { WorkbenchPageSnapshot, WorkbenchPanel } from './workbench-page-shared.js';

type WorkbenchPageImportPanelProps = {
  snapshot: WorkbenchPageSnapshot;
  onOpenPanel: (panel: WorkbenchPanel) => void;
  onOpenCharacterCardImport: () => void;
  onOpenNovelImport: () => void;
};

export function WorkbenchPageImportPanel({
  snapshot,
  onOpenPanel,
  onOpenCharacterCardImport,
  onOpenNovelImport,
}: WorkbenchPageImportPanelProps) {
  return (
    <section className="mx-auto max-w-5xl p-8">
      <Surface tone="card" material="glass-regular" padding="md">
        <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Import into Workspace</h2>
        <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">
          Import pipelines no longer publish directly. They write source fidelity and review drafts back into this workspace.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button tone="primary" size="sm" onClick={onOpenCharacterCardImport}>
            Character Card
          </Button>
          <Button tone="secondary" size="sm" onClick={onOpenNovelImport}>
            Novel
          </Button>
        </div>

        <div className="mt-6 space-y-3">
          {snapshot.importSessions.length === 0 ? (
            <ForgeEmptyState message="No import sessions recorded yet." />
          ) : snapshot.importSessions.map((session) => (
            <ForgeListCard
              key={session.sessionId}
              title={session.sourceFile}
              subtitle={`${session.sessionType} · ${session.status} · ${session.unresolvedConflicts} unresolved conflict(s)`}
              actions={(
                <Button tone="secondary" size="sm" onClick={() => onOpenPanel('REVIEW')}>
                  Open Review
                </Button>
              )}
            />
          ))}
        </div>
      </Surface>
    </section>
  );
}
