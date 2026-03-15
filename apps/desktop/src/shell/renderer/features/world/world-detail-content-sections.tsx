import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { resolveExtendedLayout } from './world-detail-layout.js';
import {
  BENTO_SPAN_CLASS,
  buildVisibleAgentGroups,
  DataFactCard,
  displayValue,
  formatDateTime,
  formatEnum,
  formatFreezeReason,
  joinParts,
  MetricPill,
  SectionShell,
} from './world-detail-primitives.js';
import type {
  WorldAgent,
  WorldAuditItem,
  WorldEventsBundle,
  WorldPublicAssetsData,
  WorldSemanticData,
} from './world-detail-types.js';

export function WorldTimelineSection({
  events,
  loading,
  onSelectAgentName,
  onSelectSceneName,
}: {
  events: WorldEventsBundle;
  loading?: boolean;
  onSelectAgentName?: (name: string) => void;
  onSelectSceneName?: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'ALL' | 'PRIMARY' | 'SECONDARY'>('ALL');
  const [visibleCount, setVisibleCount] = useState(8);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const filteredEvents = useMemo(() => (
    filter === 'ALL' ? events.items : events.items.filter((item) => item.level === filter)
  ), [events.items, filter]);

  const visibleEvents = filteredEvents.slice(0, visibleCount);

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.timeline.title')}
      subtitle={t('WorldDetail.xianxia.v2.timeline.subtitle')}
      dataTestId="world-detail-timeline"
    >
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        {[
          { key: 'ALL', label: t('WorldDetail.xianxia.v2.timeline.filterAll') },
          { key: 'PRIMARY', label: t('WorldDetail.xianxia.v2.timeline.filterPrimary') },
          { key: 'SECONDARY', label: t('WorldDetail.xianxia.v2.timeline.filterSecondary') },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => {
              setFilter(item.key as 'ALL' | 'PRIMARY' | 'SECONDARY');
              setVisibleCount(8);
            }}
            className={`rounded-full border px-3 py-1.5 text-xs transition-all ${
              filter === item.key
                ? 'border-[#4ECCA3]/45 bg-[#4ECCA3]/16 text-[#dffdf2]'
                : 'border-[#4ECCA3]/14 bg-black/12 text-[#d8efe4]/55 hover:border-[#4ECCA3]/24 hover:text-[#d8efe4]/85'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex min-h-[220px] items-center justify-center text-sm text-[#d8efe4]/42">{t('WorldDetail.xianxia.v2.timeline.loading')}</div>
      ) : visibleEvents.length ? (
        <div className="relative flex flex-col gap-4">
          <div className="absolute bottom-0 left-[11px] top-2 w-px bg-gradient-to-b from-[#4ECCA3] via-[#4ECCA3]/30 to-transparent" />
          {visibleEvents.map((event) => {
            const isExpanded = Boolean(expandedIds[event.id]);
            const summary = event.summary || event.description;
            return (
              <article key={event.id} className="relative pl-8">
                <div className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#4ECCA3]/28 bg-[#0f1612]">
                  <div className="h-2 w-2 rounded-full bg-[#4ECCA3]" />
                </div>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-[#86f0ca]">
                  <span>{formatDateTime(event.time) || 'N/A'}</span>
                  <span className="rounded-full border border-[#4ECCA3]/16 bg-[#4ECCA3]/10 px-2 py-0.5 text-[10px] tracking-[0.14em] text-[#dffdf2]">
                    {event.level === 'PRIMARY' ? t('WorldDetail.xianxia.v2.timeline.primary') : t('WorldDetail.xianxia.v2.timeline.secondary')}
                  </span>
                </div>
                <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/60 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-base font-semibold text-[#effff8]">{displayValue(event.title)}</h4>
                      {summary ? <p className="mt-2 text-sm leading-relaxed text-[#d8efe4]/66">{summary}</p> : null}
                    </div>
                    <button
                      onClick={() => setExpandedIds((current) => ({ ...current, [event.id]: !current[event.id] }))}
                      className="rounded-full border border-[#4ECCA3]/16 bg-[#4ECCA3]/8 px-3 py-1 text-[11px] text-[#86f0ca] transition-colors hover:bg-[#4ECCA3]/14"
                    >
                      {isExpanded ? t('WorldDetail.xianxia.v2.timeline.collapse') : t('WorldDetail.xianxia.v2.timeline.expand')}
                    </button>
                  </div>

                  {isExpanded ? (
                    <div className="mt-4 grid gap-3">
                      {event.cause ? <DataFactCard label={t('WorldDetail.xianxia.v2.timeline.cause')} value={event.cause} /> : null}
                      {event.process ? <DataFactCard label={t('WorldDetail.xianxia.v2.timeline.process')} value={event.process} /> : null}
                      {event.result ? <DataFactCard label={t('WorldDetail.xianxia.v2.timeline.result')} value={event.result} /> : null}
                      {event.characterRefs.length || event.locationRefs.length ? (
                        <div className="flex flex-wrap gap-2 text-xs text-[#d8efe4]/62">
                          {event.characterRefs.length ? (
                            <div className="flex flex-wrap gap-2">
                              {event.characterRefs.map((name) => (
                                <button
                                  key={`${event.id}-char-${name}`}
                                  type="button"
                                  onClick={() => onSelectAgentName?.(name)}
                                  className="rounded-full border border-[#4ECCA3]/14 bg-[#4ECCA3]/10 px-3 py-1 text-xs text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/16"
                                >
                                  {name}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {event.locationRefs.length ? (
                            <div className="flex flex-wrap gap-2">
                              {event.locationRefs.map((name) => (
                                <button
                                  key={`${event.id}-loc-${name}`}
                                  type="button"
                                  onClick={() => onSelectSceneName?.(name)}
                                  className="rounded-full border border-[#4ECCA3]/14 bg-black/16 px-3 py-1 text-xs text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/24 hover:text-[#effff8]"
                                >
                                  {name}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {event.evidenceRefs.length ? (
                        <div className="rounded-xl border border-[#4ECCA3]/10 bg-black/16 p-3">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">{t('WorldDetail.xianxia.v2.timeline.evidence')}</div>
                          <div className="mt-2 grid gap-2">
                            {event.evidenceRefs.slice(0, 2).map((evidence) => (
                              <div key={`${event.id}-${evidence.segmentId}-${evidence.offsetStart}`} className="rounded-lg border border-[#4ECCA3]/8 bg-[#0a0f0c]/55 p-3 text-sm leading-relaxed text-[#d8efe4]/66">
                                {evidence.excerpt}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#4ECCA3]/14 bg-black/12 p-6 text-sm text-[#d8efe4]/46">
          {t('WorldDetail.xianxia.v2.timeline.empty')}
        </div>
      )}

      {filteredEvents.length > visibleCount ? (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setVisibleCount((current) => current + 8)}
            className="rounded-full border border-[#4ECCA3]/18 bg-[#4ECCA3]/10 px-4 py-2 text-sm text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/16"
          >
            {t('WorldDetail.xianxia.v2.common.loadMore')}
          </button>
        </div>
      ) : null}
    </SectionShell>
  );
}

export function WorldScenesSection({
  scenes,
  onSelectScene,
}: {
  scenes: WorldPublicAssetsData['scenes'];
  onSelectScene?: (sceneId: string) => void;
}) {
  const { t } = useTranslation();
  if (!scenes.length) {
    return null;
  }

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.scenes.title')}
      subtitle={t('WorldDetail.xianxia.v2.scenes.subtitle')}
      dataTestId="world-detail-scenes"
    >
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {scenes.slice(0, 9).map((scene) => (
          <button
            key={scene.id}
            type="button"
            onClick={() => onSelectScene?.(scene.id)}
            className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4 text-left transition-all hover:border-[#4ECCA3]/22 hover:bg-[#0d1511]/70"
          >
            <div className="text-base font-semibold text-[#effff8]">{scene.name}</div>
            <div className="mt-2 text-sm leading-relaxed text-[#d8efe4]/66">{scene.description || t('WorldDetail.xianxia.v2.scenes.noDescription')}</div>
            {scene.activeEntities.length ? (
              <div className="mt-3 text-xs text-[#86f0ca]/74">{t('WorldDetail.xianxia.v2.scenes.activeEntities')}: {scene.activeEntities.slice(0, 4).join(' / ')}</div>
            ) : null}
          </button>
        ))}
      </div>
    </SectionShell>
  );
}

function FullAgentCard({
  agent,
  onSelectAgent,
  onChatAgent,
  onVoiceAgent,
}: {
  agent: WorldAgent;
  onSelectAgent?: (agent: WorldAgent) => void;
  onChatAgent?: (agent: WorldAgent) => void;
  onVoiceAgent?: (agent: WorldAgent) => void;
}) {
  const { t } = useTranslation();
  const palette = getSemanticAgentPalette({
    description: agent.bio,
    worldName: agent.name,
  });
  const identityLine = joinParts([agent.role, agent.faction, agent.rank]);
  const locationLine = joinParts([agent.sceneName, agent.location]);

  return (
    <article className="flex h-full flex-col rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/58 p-4">
      <button
        type="button"
        onClick={() => onSelectAgent?.(agent)}
        className="flex flex-1 flex-col text-left transition-opacity hover:opacity-95"
      >
        <div className="flex items-start gap-3">
          <EntityAvatar
            imageUrl={agent.avatarUrl}
            name={agent.name || 'Agent'}
            kind="agent"
            sizeClassName="h-14 w-14"
            radiusClassName="rounded-[10px]"
            innerRadiusClassName="rounded-[8px]"
            textClassName="text-lg font-serif"
          />
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-sm font-semibold text-[#effff8]">{agent.name}</h4>
            <div className="truncate text-xs" style={{ color: palette.accent }}>{agent.handle}</div>
            {identityLine ? <div className="mt-1 text-xs text-[#d8efe4]/62">{identityLine}</div> : null}
          </div>
        </div>

        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-[#d8efe4]/62">{agent.bio}</p>

        {locationLine ? <div className="mt-3 text-xs text-[#86f0ca]/76">{locationLine}</div> : null}

        {agent.stats?.vitalityScore != null ? (
          <div className="mt-3 text-[11px] text-[#d8efe4]/45">{t('WorldDetail.xianxia.v2.agents.vitality')} {agent.stats.vitalityScore}</div>
        ) : null}
      </button>

      {(onChatAgent || onVoiceAgent) ? (
        <div className="mt-4 flex gap-2">
          {onChatAgent ? (
            <button
              onClick={() => onChatAgent(agent)}
              className="rounded-full border border-[#4ECCA3]/18 bg-[#4ECCA3]/10 px-3 py-1 text-xs text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/16"
            >
              {t('WorldDetail.xianxia.v2.agents.chat')}
            </button>
          ) : null}
          {onVoiceAgent ? (
            <button
              onClick={() => onVoiceAgent(agent)}
              className="rounded-full border border-[#4ECCA3]/18 bg-black/18 px-3 py-1 text-xs text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/28 hover:text-[#effff8]"
            >
              {t('WorldDetail.xianxia.v2.agents.voice')}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function WorldAgentsSection({
  agents,
  agentsLoading,
  onCreateAgent,
  onSelectAgent,
  onChatAgent,
  onVoiceAgent,
}: {
  agents: WorldAgent[];
  agentsLoading?: boolean;
  onCreateAgent?: () => void;
  onSelectAgent?: (agent: WorldAgent) => void;
  onChatAgent?: (agent: WorldAgent) => void;
  onVoiceAgent?: (agent: WorldAgent) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleGroups = useMemo(() => buildVisibleAgentGroups(agents, 9, expanded), [agents, expanded]);
  const totalCount = agents.length;

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.agents.title')}
      subtitle={t('WorldDetail.xianxia.v2.agents.subtitle')}
      dataTestId="world-detail-agents"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-[#d8efe4]/58">{t('WorldDetail.xianxia.v2.agents.totalCount', { count: totalCount })}</div>
        {onCreateAgent ? (
          <button
            onClick={onCreateAgent}
            className="rounded-full border border-[#4ECCA3]/20 bg-[#4ECCA3]/12 px-4 py-2 text-sm text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/18"
          >
            {t('WorldDetail.xianxia.v2.agents.createAgent')}
          </button>
        ) : null}
      </div>

      {agentsLoading ? (
        <div className="flex min-h-[260px] items-center justify-center text-sm text-[#d8efe4]/42">{t('WorldDetail.xianxia.v2.agents.loading')}</div>
      ) : totalCount ? (
        <div className="grid gap-6">
          {visibleGroups.map((group) => (
            <div key={group.importance}>
              <div className="mb-3 inline-flex rounded-full border border-[#4ECCA3]/18 bg-[#4ECCA3]/10 px-3 py-1 text-xs font-medium text-[#86f0ca]">
                {group.importance === 'PRIMARY'
                  ? t('WorldDetail.xianxia.v2.agents.groupPrimary')
                  : group.importance === 'SECONDARY'
                    ? t('WorldDetail.xianxia.v2.agents.groupSecondary')
                    : t('WorldDetail.xianxia.v2.agents.groupBackground')}
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.items.map((agent) => (
                  <FullAgentCard
                    key={agent.id}
                    agent={agent}
                    onSelectAgent={onSelectAgent}
                    onChatAgent={onChatAgent}
                    onVoiceAgent={onVoiceAgent}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#4ECCA3]/14 bg-black/12 p-6 text-sm text-[#d8efe4]/46">
          {t('WorldDetail.xianxia.v2.agents.empty')}
        </div>
      )}

      {!expanded && totalCount > 9 ? (
        <div className="mt-5 flex justify-center">
          <button
            onClick={() => setExpanded(true)}
            className="rounded-full border border-[#4ECCA3]/18 bg-[#4ECCA3]/10 px-4 py-2 text-sm text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/16"
          >
            {t('WorldDetail.xianxia.v2.common.loadMore')}
          </button>
        </div>
      ) : null}
    </SectionShell>
  );
}

function WorldEvolutionSection({ semantic }: { semantic: WorldSemanticData }) {
  const { t } = useTranslation();
  if (!semantic.worldviewEvents.length && !semantic.worldviewSnapshots.length) {
    return null;
  }

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.extended.evolutionTitle')}
      subtitle={t('WorldDetail.xianxia.v2.extended.evolutionSubtitle')}
      dataTestId="world-detail-extended-evolution"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {semantic.worldviewEvents.length ? (
          <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
            <div className="mb-3 text-xs font-semibold tracking-[0.12em] text-[#86f0ca]">{t('WorldDetail.xianxia.v2.extended.recentChanges')}</div>
            <div className="grid gap-3">
              {semantic.worldviewEvents.slice(0, 5).map((item) => (
                <div key={item.id} className="rounded-xl border border-[#4ECCA3]/10 bg-black/16 p-3">
                  <div className="text-sm font-semibold text-[#effff8]">{item.title}</div>
                  {item.summary ? <div className="mt-1 text-sm leading-relaxed text-[#d8efe4]/64">{item.summary}</div> : null}
                  <div className="mt-2 text-[11px] text-[#86f0ca]/74">{joinParts([item.eventType, formatDateTime(item.createdAt)])}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {semantic.worldviewSnapshots.length ? (
          <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
            <div className="mb-3 text-xs font-semibold tracking-[0.12em] text-[#86f0ca]">{t('WorldDetail.xianxia.v2.extended.snapshots')}</div>
            <div className="grid gap-3">
              {semantic.worldviewSnapshots.slice(0, 5).map((snapshot) => (
                <div key={snapshot.id} className="rounded-xl border border-[#4ECCA3]/10 bg-black/16 p-3">
                  <div className="text-sm font-semibold text-[#effff8]">{snapshot.versionLabel}</div>
                  {snapshot.summary ? <div className="mt-1 text-sm leading-relaxed text-[#d8efe4]/64">{snapshot.summary}</div> : null}
                  <div className="mt-2 text-[11px] text-[#86f0ca]/74">{formatDateTime(snapshot.createdAt) || 'N/A'}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}

function WorldKnowledgeCard({ lorebooks }: { lorebooks: WorldPublicAssetsData['lorebooks'] }) {
  const { t } = useTranslation();
  if (!lorebooks.length) {
    return null;
  }

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.extended.knowledgeTitle')}
      subtitle={t('WorldDetail.xianxia.v2.extended.knowledgeSubtitle')}
      className="h-full"
      dataTestId="world-detail-knowledge-card"
    >
      <div className="grid gap-3 md:grid-cols-2">
        {lorebooks.slice(0, 8).map((lorebook) => (
          <div key={lorebook.id} className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
            <div className="text-base font-semibold text-[#effff8]">{lorebook.name || lorebook.key}</div>
            <div className="mt-2 line-clamp-4 text-sm leading-relaxed text-[#d8efe4]/66">{lorebook.content}</div>
            {lorebook.keywords.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {lorebook.keywords.slice(0, 4).map((keyword) => (
                  <span key={`${lorebook.id}-${keyword}`} className="rounded-full border border-[#4ECCA3]/16 bg-[#4ECCA3]/10 px-2.5 py-1 text-[11px] text-[#86f0ca]">
                    {keyword}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

function WorldGovernanceCard({
  audits,
  mutations,
  auditsLoading,
}: {
  audits: WorldAuditItem[];
  mutations: WorldPublicAssetsData['mutations'];
  auditsLoading?: boolean;
}) {
  const { t } = useTranslation();
  if (!audits.length && !mutations.length && !auditsLoading) {
    return null;
  }

  return (
    <div className="grid gap-5" data-testid="world-detail-governance-card">
      {(audits.length || auditsLoading) ? (
        <SectionShell title={t('WorldDetail.xianxia.v2.extended.auditsTitle')} subtitle={t('WorldDetail.xianxia.v2.extended.auditsSubtitle')}>
          {auditsLoading ? (
            <div className="flex min-h-[220px] items-center justify-center text-sm text-[#d8efe4]/42">{t('WorldDetail.xianxia.v2.extended.auditsLoading')}</div>
          ) : (
            <div className="grid gap-3">
              {audits.slice(0, 6).map((audit) => (
                <div key={audit.id} className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[#effff8]">{audit.label}</div>
                    <div className="text-[11px] text-[#86f0ca]/72">{formatDateTime(audit.occurredAt) || 'N/A'}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {audit.prevLevel != null ? <MetricPill label={t('WorldDetail.xianxia.v2.extended.prevLevel')} value={`Lv.${audit.prevLevel}`} /> : null}
                    {audit.nextLevel != null ? <MetricPill label={t('WorldDetail.xianxia.v2.extended.nextLevel')} value={`Lv.${audit.nextLevel}`} /> : null}
                    {audit.ewmaScore != null ? <MetricPill label="EWMA" value={audit.ewmaScore.toFixed(2)} /> : null}
                    {audit.freezeReason ? <MetricPill label={t('WorldDetail.xianxia.v2.runtimeFacts.freezeReason')} value={formatFreezeReason(audit.freezeReason) ?? audit.freezeReason} /> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionShell>
      ) : null}

      {mutations.length ? (
        <SectionShell title={t('WorldDetail.xianxia.v2.extended.mutationsTitle')} subtitle={t('WorldDetail.xianxia.v2.extended.mutationsSubtitle')}>
          <div className="grid gap-3">
            {mutations.slice(0, 8).map((mutation) => (
              <div key={mutation.id} className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[#effff8]">{formatEnum(mutation.mutationType) || mutation.mutationType}</div>
                  <div className="text-[11px] text-[#86f0ca]/72">{formatDateTime(mutation.createdAt) || 'N/A'}</div>
                </div>
                <div className="mt-2 text-xs text-[#d8efe4]/58">{mutation.targetPath}</div>
                {mutation.reason ? <div className="mt-2 text-sm leading-relaxed text-[#d8efe4]/66">{mutation.reason}</div> : null}
              </div>
            ))}
          </div>
        </SectionShell>
      ) : null}
    </div>
  );
}

export function WorldExtendedSection({
  semantic,
  audits,
  publicAssets,
  auditsLoading,
}: {
  semantic: WorldSemanticData;
  audits: WorldAuditItem[];
  publicAssets: WorldPublicAssetsData;
  auditsLoading?: boolean;
}) {
  const layout = resolveExtendedLayout({
    hasKnowledge: publicAssets.lorebooks.length > 0,
    hasGovernance: audits.length > 0 || publicAssets.mutations.length > 0 || Boolean(auditsLoading),
  });

  if (!layout.cards.length && !semantic.worldviewEvents.length && !semantic.worldviewSnapshots.length) {
    return null;
  }

  return (
    <div className="grid gap-5" data-testid="world-detail-extended">
      <WorldEvolutionSection semantic={semantic} />
      {layout.cards.length ? (
        <div className="grid gap-5 xl:grid-cols-12">
          {layout.cards.map((card) => (
            <div key={card.key} className={BENTO_SPAN_CLASS[card.span]}>
              {card.key === 'knowledge' ? <WorldKnowledgeCard lorebooks={publicAssets.lorebooks} /> : null}
              {card.key === 'governance' ? (
                <WorldGovernanceCard audits={audits} mutations={publicAssets.mutations} auditsLoading={auditsLoading} />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
