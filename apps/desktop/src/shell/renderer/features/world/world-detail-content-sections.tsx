import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { getSemanticSourcePalette } from '@renderer/components/source-theme.js';
import {
  buildVisibleCharacterGroups,
  DataFactCard,
  formatAuditEventType,
  formatDateTime,
  formatFreezeReason,
  formatCreationState,
  joinParts,
  MetricPill,
  SectionShell,
} from './world-detail-primitives.js';
import type {
  WorldCharacter,
  WorldAuditItem,
  WorldDetailData,
  WorldPublicAssetsData,
  WorldSemanticData,
} from './world-detail-types.js';
export { WorldTimelineSection } from './world-detail-timeline-section.js';

export function WorldScenesSection({
  scenes,
  onSelectScene,
  title,
  subtitle,
}: {
  scenes: WorldPublicAssetsData['scenes'];
  onSelectScene?: (sceneId: string) => void;
  title?: string;
  subtitle?: string;
}) {
  const { t } = useTranslation();
  if (!scenes.length) {
    return null;
  }

  return (
    <SectionShell
      title={title ?? t('WorldDetail.xianxia.v2.scenes.title')}
      subtitle={subtitle ?? t('WorldDetail.xianxia.v2.scenes.subtitle')}
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

function FullCharacterTile({
  character,
  onSelectCharacter,
}: {
  character: WorldCharacter;
  onSelectCharacter?: (character: WorldCharacter) => void;
}) {
  const { t } = useTranslation();
  const palette = getSemanticSourcePalette({
    description: character.bio,
    worldName: character.name,
  });
  const identityLine = joinParts([character.role, character.faction, character.rank]);
  const locationLine = joinParts([character.sceneName, character.location]);

  return (
    <article className="flex h-full flex-col rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/58 p-4">
      <button
        type="button"
        onClick={() => onSelectCharacter?.(character)}
        className="flex flex-1 flex-col text-left transition-opacity hover:opacity-95"
      >
        <div className="flex items-start gap-3">
          <EntityAvatar
            imageUrl={character.avatarUrl}
            name={character.name || 'Character'}
            kind="source"
            sizeClassName="h-14 w-14"
            radiusClassName="rounded-[10px]"
            innerRadiusClassName="rounded-[8px]"
            textClassName="text-lg font-serif"
          />
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-sm font-semibold text-[#effff8]">{character.name}</h4>
            <div className="truncate text-xs" style={{ color: palette.accent }}>{character.handle}</div>
            {identityLine ? <div className="mt-1 text-xs text-[#d8efe4]/62">{identityLine}</div> : null}
          </div>
        </div>

        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-[#d8efe4]/62">{character.bio}</p>

        {locationLine ? <div className="mt-3 text-xs text-[#86f0ca]/76">{locationLine}</div> : null}

        {character.stats?.vitalityScore != null ? (
          <div className="mt-3 text-[11px] text-[#d8efe4]/45">{t('WorldDetail.xianxia.v2.characters.vitality')} {character.stats.vitalityScore}</div>
        ) : null}
      </button>
      {/* No chat/voice action on a WorldCharacter card. Source direct chat is
          not admitted; the card opens the quick-sheet whose only action is
          View profile. */}
    </article>
  );
}

export function WorldCharactersSection({
  characters,
  charactersLoading,
  onSelectCharacter,
}: {
  characters: WorldCharacter[];
  charactersLoading?: boolean;
  onSelectCharacter?: (character: WorldCharacter) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleGroups = useMemo(() => buildVisibleCharacterGroups(characters, 9, expanded), [characters, expanded]);
  const totalCount = characters.length;

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.characters.title')}
      subtitle={t('WorldDetail.xianxia.v2.characters.subtitle')}
      dataTestId="world-detail-characters"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-[#d8efe4]/58">{t('WorldDetail.xianxia.v2.characters.totalCount', { count: totalCount })}</div>
      </div>

      {charactersLoading ? (
        <div className="flex min-h-[260px] items-center justify-center text-sm text-[#d8efe4]/42">{t('WorldDetail.xianxia.v2.characters.loading')}</div>
      ) : totalCount ? (
        <div className="grid gap-6">
          {visibleGroups.map((group) => (
            <div key={group.importance}>
              <div className="mb-3 inline-flex rounded-full border border-[#4ECCA3]/18 bg-[#4ECCA3]/10 px-3 py-1 text-xs font-medium text-[#86f0ca]">
                {group.importance === 'PRIMARY'
                  ? t('WorldDetail.xianxia.v2.characters.groupPrimary')
                  : group.importance === 'SECONDARY'
                    ? t('WorldDetail.xianxia.v2.characters.groupSecondary')
                    : t('WorldDetail.xianxia.v2.characters.groupBackground')}
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.items.map((character) => (
                  <FullCharacterTile
                    key={character.id}
                    character={character}
                    onSelectCharacter={onSelectCharacter}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#4ECCA3]/14 bg-black/12 p-6 text-sm text-[#d8efe4]/46">
          {t('WorldDetail.xianxia.v2.characters.empty')}
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

function WorldRuntimeSummaryCard({
  world,
  lorebookCount,
  sceneCount,
}: {
  world: WorldDetailData;
  lorebookCount: number;
  sceneCount: number;
}) {
  const { t } = useTranslation();
  const facts = [
    { label: t('WorldDetail.xianxia.v2.runtimeFacts.characterCount'), value: `${world.characterCount}` },
    { label: t('WorldDetail.xianxia.v2.runtimeFacts.lorebookCount'), value: `${lorebookCount}` },
    { label: t('WorldDetail.xianxia.v2.runtimeFacts.sceneCount'), value: `${sceneCount}` },
    {
      label: t('WorldDetail.xianxia.v2.runtimeFacts.creationState'),
      value: formatCreationState(world.nativeCreationState, t) ?? t('WorldDetail.xianxia.v2.common.notAvailable'),
    },
    {
      label: t('WorldDetail.xianxia.v2.runtimeFacts.contentRating'),
      value: world.contentRating ?? t('WorldDetail.xianxia.v2.common.notAvailable'),
    },
  ];

  if (world.freezeReason) {
    facts.push({
      label: t('WorldDetail.xianxia.v2.runtimeFacts.freezeReason'),
      value: formatFreezeReason(world.freezeReason, t) ?? world.freezeReason,
    });
  }

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.runtimeFacts.title')}
      subtitle={t('WorldDetail.xianxia.v2.runtimeFacts.subtitle')}
      className="h-full"
      dataTestId="world-detail-runtime-facts-card"
    >
      <div className="mb-4 rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-white/54">
        {t('WorldDetail.xianxia.v2.runtimeFacts.intro')}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {facts.map((fact) => (
          <DataFactCard key={fact.label} label={fact.label} value={fact.value} />
        ))}
      </div>
    </SectionShell>
  );
}

function WorldGovernanceCard({
  audits,
  auditsLoading,
}: {
  audits: WorldAuditItem[];
  auditsLoading?: boolean;
}) {
  const { t } = useTranslation();
  if (!audits.length && !auditsLoading) {
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
                    <div className="text-sm font-semibold text-[#effff8]">{formatAuditEventType(audit.eventType, t) ?? audit.label}</div>
                    <div className="text-[11px] text-[#86f0ca]/72">{formatDateTime(audit.occurredAt) || 'N/A'}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {audit.prevLevel != null ? <MetricPill label={t('WorldDetail.xianxia.v2.extended.prevLevel')} value={`Lv.${audit.prevLevel}`} /> : null}
                    {audit.nextLevel != null ? <MetricPill label={t('WorldDetail.xianxia.v2.extended.nextLevel')} value={`Lv.${audit.nextLevel}`} /> : null}
                    {audit.ewmaScore != null ? <MetricPill label="EWMA" value={audit.ewmaScore.toFixed(2)} /> : null}
                    {audit.freezeReason ? <MetricPill label={t('WorldDetail.xianxia.v2.runtimeFacts.freezeReason')} value={formatFreezeReason(audit.freezeReason, t) ?? audit.freezeReason} /> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionShell>
      ) : null}
    </div>
  );
}

export function WorldExtendedSection({
  world,
  semantic,
  audits,
  publicAssets,
  auditsLoading,
}: {
  world: WorldDetailData;
  semantic: WorldSemanticData;
  audits: WorldAuditItem[];
  publicAssets: WorldPublicAssetsData;
  auditsLoading?: boolean;
}) {
  const hasKnowledge = publicAssets.lorebooks.length > 0;
  const hasGovernance = audits.length > 0 || Boolean(auditsLoading);
  const hasRuntimeOrGovernance = hasGovernance || world.characterCount > 0 || publicAssets.lorebooks.length > 0 || publicAssets.scenes.length > 0;

  if (!hasKnowledge && !hasRuntimeOrGovernance && !semantic.worldviewEvents.length && !semantic.worldviewSnapshots.length) {
    return null;
  }

  return (
    <div className="grid gap-5" data-testid="world-detail-extended">
      <WorldEvolutionSection semantic={semantic} />
      {hasKnowledge ? <WorldKnowledgeCard lorebooks={publicAssets.lorebooks} /> : null}
      {hasRuntimeOrGovernance ? (
        <div className="grid gap-5 xl:grid-cols-12">
          <div className={hasGovernance ? 'xl:col-span-5' : 'xl:col-span-12'}>
            <WorldRuntimeSummaryCard
              world={world}
              lorebookCount={publicAssets.lorebooks.length}
              sceneCount={publicAssets.scenes.length}
            />
          </div>
          {hasGovernance ? (
            <div className="xl:col-span-7">
              <WorldGovernanceCard audits={audits} auditsLoading={auditsLoading} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
