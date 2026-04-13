import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgeErrorBanner, ForgeStatCard } from '@renderer/components/page-layout.js';
import type { WorkbenchPageSnapshot } from './workbench-page-shared.js';

type WorkbenchPagePublishPanelProps = {
  snapshot: WorkbenchPageSnapshot;
  userId: string;
  publishReady: boolean;
  publishPending: boolean;
  completenessIssues: string[];
  publishError: string | null;
  onPublish: () => void;
};

export function WorkbenchPagePublishPanel({
  snapshot,
  userId,
  publishReady,
  publishPending,
  completenessIssues,
  publishError,
  onPublish,
}: WorkbenchPagePublishPanelProps) {
  return (
    <section className="mx-auto max-w-5xl p-8">
      <Surface tone="card" padding="md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Publish Plan</h2>
            <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">
              Workbench publish now builds one completeness-gated official package and publishes it through the canonical admin package surface.
            </p>
          </div>
          <Button
            tone="primary"
            size="sm"
            onClick={onPublish}
            disabled={!publishReady || publishPending}
          >
            {publishPending ? 'Publishing...' : 'Publish'}
          </Button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <ForgeStatCard
            label="World Action"
            value={snapshot.worldDraft.worldId ? 'UPDATE' : 'CREATE'}
            detail={snapshot.worldDraft.name || snapshot.workspace.title}
          />
          <ForgeStatCard
            label="Agents"
            value={Object.values(snapshot.agentDrafts).filter((draft) => draft.ownershipType === 'WORLD_OWNED').length}
            detail={`${snapshot.reviewState.agentBundles.length} bundle(s) with truth ready to write`}
          />
        </div>

        <Surface tone="card" padding="sm" className="mt-6">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">Guards</p>
          <div className="mt-3 space-y-2 text-sm text-[var(--nimi-text-secondary)]">
            <p>{snapshot.reviewState.hasPendingConflicts ? 'Blocked: unresolved conflicts remain.' : 'Conflicts resolved.'}</p>
            <p>{snapshot.reviewState.hasUnmappedCharacters ? 'Blocked: one or more character bundles are not mapped to world-owned agents.' : 'Character bundles mapped to world-owned agents.'}</p>
            <p>{snapshot.reviewState.worldRules.length} world rule(s) and {snapshot.reviewState.agentBundles.reduce((sum, bundle) => sum + bundle.rules.length, 0)} agent rule(s) will be packaged.</p>
            <p>{userId ? 'Authenticated publish actor resolved.' : 'Blocked: authenticated user required.'}</p>
          </div>
        </Surface>

        <Surface tone="card" padding="sm" className="mt-4">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">Completeness Gate</p>
          <div className="mt-3 space-y-2 text-sm text-[var(--nimi-text-secondary)]">
            {completenessIssues.length === 0 ? (
              <p>All required world and agent completion fields are present.</p>
            ) : completenessIssues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        </Surface>

        {publishError ? (
          <ForgeErrorBanner message={publishError} className="mt-4" />
        ) : null}
      </Surface>
    </section>
  );
}
