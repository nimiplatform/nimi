/**
 * Worlds Page — list drafts + published worlds (FG-WORLD-003)
 */

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useWorldResourceQueries, type WorldDraftSummary, type WorldSummary } from '@renderer/hooks/use-world-queries.js';

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function DraftStatusBadge({ status }: { status: WorldDraftSummary['status'] }) {
  const colors: Record<string, string> = {
    DRAFT: 'bg-yellow-500/20 text-yellow-400',
    SYNTHESIZE: 'bg-blue-500/20 text-blue-400',
    REVIEW: 'bg-purple-500/20 text-purple-400',
    PUBLISH: 'bg-green-500/20 text-green-400',
    FAILED: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${colors[status] || 'bg-neutral-700 text-neutral-300'}`}>
      {status}
    </span>
  );
}

function WorldStatusBadge({ status }: { status: WorldSummary['status'] }) {
  const colors: Record<string, string> = {
    ACTIVE: 'bg-green-500/20 text-green-400',
    DRAFT: 'bg-yellow-500/20 text-yellow-400',
    PENDING_REVIEW: 'bg-blue-500/20 text-blue-400',
    SUSPENDED: 'bg-red-500/20 text-red-400',
    ARCHIVED: 'bg-neutral-500/20 text-neutral-400',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${colors[status] || 'bg-neutral-700 text-neutral-300'}`}>
      {status}
    </span>
  );
}

export default function WorldsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { draftsQuery, worldsQuery } = useWorldResourceQueries({
    enabled: true,
    worldId: '',
    enableCollections: true,
  });

  const drafts = draftsQuery.data || [];
  const worlds = worldsQuery.data || [];
  const loading = draftsQuery.isLoading || worldsQuery.isLoading;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('pages.worlds')}</h1>
            <p className="mt-1 text-sm text-neutral-400">
              {t('worlds.subtitle', 'Manage your worlds and drafts')}
            </p>
          </div>
          <button
            onClick={() => navigate('/worlds/create')}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200 transition-colors"
          >
            {t('worlds.createNew', 'Create New World')}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Drafts Section */}
            {drafts.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
                  {t('worlds.drafts', 'Drafts')} ({drafts.length})
                </h2>
                <div className="space-y-2">
                  {drafts.map((draft) => (
                    <DraftCard
                      key={draft.id}
                      draft={draft}
                      onContinue={() => navigate(`/worlds/create?draftId=${draft.id}`)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Published Worlds Section */}
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
                {t('worlds.published', 'Published Worlds')} ({worlds.length})
              </h2>
              {worlds.length === 0 ? (
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-8 text-center">
                  <p className="text-neutral-400">
                    {t('worlds.noWorlds', 'No published worlds yet. Create your first world to get started.')}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {worlds.map((world) => (
                    <WorldCard
                      key={world.id}
                      world={world}
                      onMaintain={() => navigate(`/worlds/${world.id}/maintain`)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function DraftCard({ draft, onContinue }: { draft: WorldDraftSummary; onContinue: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 hover:border-neutral-700 transition-colors">
      <div className="flex items-center gap-3">
        <DraftStatusBadge status={draft.status} />
        <div>
          <p className="text-sm font-medium text-white">
            {draft.sourceRef || `Draft ${draft.id.slice(0, 8)}`}
          </p>
          <p className="text-xs text-neutral-500">
            {draft.sourceType} · {formatDate(draft.updatedAt)}
          </p>
        </div>
      </div>
      <button
        onClick={onContinue}
        className="rounded px-3 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-800 transition-colors"
      >
        Continue
      </button>
    </div>
  );
}

function WorldCard({ world, onMaintain }: { world: WorldSummary; onMaintain: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 hover:border-neutral-700 transition-colors">
      <div className="flex items-center gap-3">
        <WorldStatusBadge status={world.status} />
        <div>
          <p className="text-sm font-medium text-white">{world.name}</p>
          <p className="text-xs text-neutral-500">
            {world.description || 'No description'} · {formatDate(world.updatedAt)}
          </p>
        </div>
      </div>
      <button
        onClick={onMaintain}
        className="rounded px-3 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-800 transition-colors"
      >
        Maintain
      </button>
    </div>
  );
}
