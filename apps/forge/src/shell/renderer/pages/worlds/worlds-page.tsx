/**
 * Worlds Page — list drafts + published worlds (FG-WORLD-003)
 */

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@nimiplatform/nimi-kit/ui';
import { useWorldResourceQueries, type WorldDraftSummary, type WorldSummary } from '@renderer/hooks/use-world-queries.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import {
  ForgePage,
  ForgePageHeader,
  ForgeEmptyState,
  ForgeLoadingSpinner,
  ForgeSection,
  ForgeSectionHeading,
} from '@renderer/components/page-layout.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { ForgeListCard, ForgeEntityAvatar } from '@renderer/components/card-list.js';
import { formatDate } from '@renderer/components/format-utils.js';

export default function WorldsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ensureWorkspaceForDraft = useForgeWorkspaceStore((state) => state.ensureWorkspaceForDraft);

  const { draftsQuery, worldsQuery } = useWorldResourceQueries({
    enabled: true,
    worldId: '',
    enableCollections: true,
  });

  const drafts = draftsQuery.data || [];
  const worlds = worldsQuery.data || [];
  const loading = draftsQuery.isLoading || worldsQuery.isLoading;

  return (
    <ForgePage>
      <ForgePageHeader
        title={t('pages.worlds')}
        subtitle={t('worlds.subtitle', 'Browse draft sessions, inspect published worlds, and hand off into maintain when needed.')}
        actions={
          <Button tone="primary" onClick={() => navigate('/workbench/new')}>
            {t('worlds.createNew', 'New Workspace')}
          </Button>
        }
      />

      {loading ? (
        <ForgeLoadingSpinner />
      ) : (
        <>
          {/* Drafts Section */}
          {drafts.length > 0 && (
            <ForgeSection>
              <ForgeSectionHeading
                eyebrow={t('worlds.drafts', 'Drafts')}
                title={`${t('worlds.drafts', 'Drafts')} (${drafts.length})`}
                description={t('worlds.draftsDesc', 'Unpublished world creation sessions ready for review or continuation.')}
              />
              <div className="mt-4 space-y-2">
                {drafts.map((draft) => (
                  <DraftCard
                    key={draft.id}
                    draft={draft}
                    onContinue={() => {
                      const workspaceId = ensureWorkspaceForDraft({
                        draftId: draft.id,
                        title: draft.sourceRef || `Draft ${draft.id.slice(0, 8)}`,
                        targetWorldId: draft.targetWorldId,
                      });
                      navigate(`/workbench/${workspaceId}?panel=WORLD_TRUTH`);
                    }}
                  />
                ))}
              </div>
            </ForgeSection>
          )}

          {/* Published Worlds Section */}
          <ForgeSection>
            <ForgeSectionHeading
              eyebrow={t('worlds.published', 'Published Worlds')}
              title={`${t('worlds.published', 'Published Worlds')} (${worlds.length})`}
              description={t('worlds.publishedDesc', 'Maintain published worlds from the same workbench truth flow.')}
            />
            {worlds.length === 0 ? (
              <ForgeEmptyState
                message={t('worlds.noWorlds', 'No published worlds yet. Create your first world to get started.')}
              />
            ) : (
              <div className="mt-4 space-y-2">
                {worlds.map((world) => (
                  <WorldCard
                    key={world.id}
                    world={world}
                    onMaintain={() => navigate(`/worlds/${world.id}/maintain`)}
                  />
                ))}
              </div>
            )}
          </ForgeSection>
        </>
      )}
    </ForgePage>
  );
}

function DraftCard({ draft, onContinue }: { draft: WorldDraftSummary; onContinue: () => void }) {
  return (
    <ForgeListCard
      title={draft.sourceRef || `Draft ${draft.id.slice(0, 8)}`}
      subtitle={`${draft.sourceType} · ${formatDate(draft.updatedAt)}`}
      badges={<ForgeStatusBadge domain="draft" status={draft.status} />}
      actions={
        <Button tone="ghost" size="sm" onClick={onContinue}>
          Continue
        </Button>
      }
    />
  );
}

function WorldCard({ world, onMaintain }: { world: WorldSummary; onMaintain: () => void }) {
  const navigate = useNavigate();
  return (
    <ForgeListCard
      leading={<ForgeEntityAvatar name={world.name} size="sm" />}
      title={world.name}
      subtitle={`${world.description || 'No description'} · ${formatDate(world.updatedAt)}`}
      badges={<ForgeStatusBadge domain="world" status={world.status} />}
      onClick={() => navigate(`/worlds/${world.id}`)}
      actions={
        <Button tone="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onMaintain(); }}>
          Maintain
        </Button>
      }
    />
  );
}
