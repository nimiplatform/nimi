import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getCatalogEntry } from '@renderer/data/world-catalog.js';
import { getWorldDetailWithAgents } from '@renderer/data/world-client.js';
import { getClassification } from '@renderer/data/classification.js';
import { ClassificationBadge } from './components/classification-badge.js';
import type { RealmServiceResult } from '@nimiplatform/sdk/realm';

type WorldDetailWithAgentsResult = RealmServiceResult<'WorldsService', 'worldControllerGetWorldDetailWithAgents'>;
type WorldAgentSummary = WorldDetailWithAgentsResult['agents'][number];

// ── Agent Card ──────────────────────────────────────────────────────────────

type AgentCardProps = {
  agent: WorldAgentSummary;
  worldId: string;
  size: 'primary' | 'secondary';
};

function AgentCard({ agent, worldId, size }: AgentCardProps) {
  const isPrimary = size === 'primary';

  return (
    <Link
      to={`/explore/${worldId}/agent/${agent.id}`}
      className={[
        'flex bg-white rounded-2xl border border-neutral-200 hover:border-amber-300 transition-colors overflow-hidden',
        isPrimary ? 'flex-col' : 'flex-row gap-3 items-center p-3',
      ].join(' ')}
    >
      {/* Avatar */}
      <div className={[
        'bg-neutral-100 flex items-center justify-center shrink-0',
        isPrimary ? 'h-40 w-full' : 'w-12 h-12 rounded-xl',
      ].join(' ')}>
        {agent.avatarUrl ? (
          <img
            src={agent.avatarUrl}
            alt={agent.name}
            className={['object-cover', isPrimary ? 'w-full h-full' : 'w-12 h-12 rounded-xl'].join(' ')}
          />
        ) : (
          <span className="text-neutral-300 text-2xl">人</span>
        )}
      </div>

      {/* Info */}
      <div className={isPrimary ? 'p-3' : 'flex-1 min-w-0'}>
        <h3 className={['font-semibold text-neutral-800 truncate', isPrimary ? 'text-base' : 'text-sm'].join(' ')}>
          {agent.name}
        </h3>
        {agent.bio && (
          <p className={['text-neutral-400 leading-relaxed mt-0.5', isPrimary ? 'text-sm line-clamp-3' : 'text-xs line-clamp-2'].join(' ')}>
            {agent.bio}
          </p>
        )}
      </div>
    </Link>
  );
}

// ── World Detail Page ───────────────────────────────────────────────────────

export default function WorldDetailPage() {
  const { t } = useTranslation();
  const { worldId } = useParams<{ worldId: string }>();
  const navigate = useNavigate();
  const [showAllAgents, setShowAllAgents] = useState(false);

  const catalogEntry = worldId ? getCatalogEntry(worldId) : undefined;

  const { data: worldData, isLoading, error } = useQuery({
    queryKey: ['world-detail', worldId],
    queryFn: async () => {
      const result = await getWorldDetailWithAgents(worldId!);
      return result as WorldDetailWithAgentsResult;
    },
    enabled: !!worldId,
  });

  const primaryAgents = (worldData?.agents ?? []).filter((a) => a.importance === 'PRIMARY');
  const secondaryAgents = (worldData?.agents ?? []).filter((a) => a.importance === 'SECONDARY' || a.importance === 'BACKGROUND');

  const classification = catalogEntry
    ? getClassification(catalogEntry.contentType, catalogEntry.truthMode)
    : null;

  // Catalog gate — SJ-EXPL-007
  if (worldId && !catalogEntry) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-neutral-500 text-sm">此历史时期不在时迹目录中</p>
          <button onClick={() => navigate('/explore')} className="text-amber-600 text-sm font-medium hover:text-amber-700">
            返回时间长河
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      {/* Back link */}
      <div className="px-6 pt-4 pb-2">
        <Link to="/explore" className="text-sm text-neutral-400 hover:text-amber-600 transition-colors flex items-center gap-1">
          <span>←</span> <span>时间长河</span>
        </Link>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
        </div>
      )}

      {error && !isLoading && (
        <div className="flex items-center justify-center h-48">
          <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
        </div>
      )}

      {!isLoading && !error && worldData && (
        <>
          {/* Hero section — SJ-EXPL-004:2 */}
          <div className="relative">
            {worldData.bannerUrl && (
              <div className="h-48 w-full overflow-hidden">
                <img src={worldData.bannerUrl} alt={worldData.name} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="px-6 py-5">
              <div className="flex items-start gap-3 flex-wrap mb-3">
                <h1 className="text-2xl font-bold text-neutral-900">{worldData.name}</h1>
                {/* Classification badges — SJ-EXPL-008:2 */}
                {catalogEntry && (
                  <ClassificationBadge
                    contentType={catalogEntry.contentType}
                    truthMode={catalogEntry.truthMode}
                    size="md"
                  />
                )}
              </div>
              {catalogEntry && (
                <p className="text-sm text-neutral-500 mb-1">{catalogEntry.eraLabel}</p>
              )}
              {worldData.tagline && (
                <p className="text-base text-neutral-600 mb-3">{worldData.tagline}</p>
              )}
              {worldData.description && (
                <p className="text-sm text-neutral-500 leading-relaxed">{worldData.description}</p>
              )}
            </div>
          </div>

          <div className="px-6 pb-8 space-y-8">
            {/* Primary agents — SJ-EXPL-004:3, SJ-EXPL-005:2 */}
            {primaryAgents.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">主要人物</h2>
                <div className="grid grid-cols-2 gap-3">
                  {primaryAgents.map((agent) => (
                    <AgentCard key={agent.id} agent={agent} worldId={worldId!} size="primary" />
                  ))}
                </div>
              </section>
            )}

            {/* Secondary agents — SJ-EXPL-004:4, SJ-EXPL-005:3 */}
            {secondaryAgents.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">其他人物</h2>
                  <button
                    onClick={() => setShowAllAgents(!showAllAgents)}
                    className="text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors"
                  >
                    {showAllAgents ? '收起' : `展开 (${secondaryAgents.length})`}
                  </button>
                </div>
                {showAllAgents && (
                  <div className="space-y-2">
                    {secondaryAgents.map((agent) => (
                      <AgentCard key={agent.id} agent={agent} worldId={worldId!} size="secondary" />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Classification disclosure — SJ-EXPL-004:5 */}
            {classification && (
              <section className="border border-amber-100 rounded-xl p-4 bg-amber-50/40">
                <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">内容说明</h2>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  {classification.contentType === 'history' && '此时期内容基于历史事实，在时迹的真值边界内呈现为史实记录。'}
                  {classification.contentType === 'literature' && '此内容源自传统文学名著，作为历史时期的文学演义与补充视角，非 canonical 历史记录。'}
                  {classification.contentType === 'mythology' && '此内容源自神话与传说，作为文化想象与故事学习的辅助材料，非 canonical 历史记录。'}
                </p>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
