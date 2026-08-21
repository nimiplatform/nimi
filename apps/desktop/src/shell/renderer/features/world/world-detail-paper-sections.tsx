import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, NimiText, Statistic, Surface, cn } from '@nimiplatform/kit/ui';
import type { WorldAssetExternalRef, WorldCharacter, WorldHistoryBundle, WorldSceneItem, WorldSemanticData } from './world-detail-types.js';
import { characterMeta, sceneImageRef } from './world-detail-template-model';
import {
  buildWorldLoreEntries,
  type WorldLoreEntry,
} from './world-detail-lore-library';
import {
  type PaperMetric,
  type PaperPath,
  formatNum,
} from './world-detail-paper-model';
import {
  IconArrow,
  IconBook,
  IconCompass,
  IconLanguages,
  IconLayers,
  IconMilestone,
  IconScene,
  IconScrollText,
  IconShield,
  IconStamp,
  IconUsers,
  PaperAvatar,
  PaperSection,
  PaperViewAll,
} from './world-detail-paper-primitives';

const WARM_PANEL_BG = 'var(--nimi-surface-panel)';

/** Localized connect-state label for the paper surface (mirrors relation state). */
function paperRelationLabel(character: WorldCharacter, t: ReturnType<typeof useTranslation>['t']): string {
  if (character.relation?.state === 'connected') return t('WorldDetail.paper.characters.connected');
  if (character.relation?.state === 'unavailable') return t('WorldDetail.paper.characters.unavailable');
  return t('WorldDetail.paper.characters.connect');
}

const paperCardClassName = 'border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)]';

function PaperCardSurface({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <Surface
      tone="card"
      material="solid"
      elevation="base"
      padding="none"
      interactive={interactive}
      className={cn(paperCardClassName, className)}
      style={{
        background: 'var(--nimi-surface-panel)',
        borderColor: 'var(--nimi-border-subtle)',
        borderRadius: 'var(--nimi-radius-md)',
        boxShadow: 'none',
      }}
    >
      {children}
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Metric strip
// ---------------------------------------------------------------------------

const METRIC_ICON: Record<PaperMetric['key'], ReactNode> = {
  people: <IconUsers size={22} color="var(--nimi-text-primary)" strokeWidth={1.5} />,
  materials: <IconBook size={22} color="var(--nimi-text-primary)" strokeWidth={1.5} />,
  scenes: <IconScene size={22} color="var(--nimi-text-primary)" strokeWidth={1.5} />,
  events: <IconCompass size={22} color="var(--nimi-text-primary)" strokeWidth={1.5} />,
};

export function PaperMetricStrip({ metrics }: { metrics: readonly PaperMetric[] }) {
  const { t } = useTranslation();
  return (
    <Surface
      as="section"
      tone="card"
      material="solid"
      elevation="base"
      padding="none"
      className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] p-1.5"
      style={{
        background: 'var(--nimi-surface-card)',
        borderColor: 'var(--nimi-border-subtle)',
        borderRadius: 'var(--nimi-radius-lg)',
        boxShadow: 'var(--nimi-elevation-base)',
      }}
    >
      {metrics.map((metric, index) => (
        <Statistic
          key={metric.key}
          label={t(`WorldDetail.paper.metrics.${metric.key}.label`)}
          value={metric.value}
          suffix={t(`WorldDetail.paper.metrics.${metric.key}.unit`)}
          helper={t(`WorldDetail.paper.metrics.${metric.key}.sub`)}
          prefix={(
            <span
              aria-hidden="true"
              className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[var(--nimi-radius-md)]"
              style={{ background: 'color-mix(in srgb, var(--nimi-action-primary-bg) 10%, var(--nimi-surface-panel))', color: 'var(--nimi-text-primary)' }}
            >
              {METRIC_ICON[metric.key]}
            </span>
          )}
          tone="neutral"
          className={cn(
            'min-h-[126px] border-0 bg-transparent p-[18px] shadow-none [&_.nimi-statistic__helper]:leading-relaxed [&_.nimi-statistic__label]:normal-case [&_.nimi-statistic__value]:gap-2',
            index < metrics.length - 1 && 'border-r border-[color:var(--nimi-border-subtle)]',
          )}
        />
      ))}
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Exploration paths
// ---------------------------------------------------------------------------

export function PaperPathsSection({
  paths,
  onEnterPath,
}: {
  paths: readonly PaperPath[];
  onEnterPath: (path: PaperPath) => void;
}) {
  const { t } = useTranslation();
  if (paths.length === 0) {
    return null;
  }
  return (
    <PaperSection
      id="world-detail-paths"
      testId="world-detail-paper-paths"
      title={t('WorldDetail.paper.paths.title')}
      subtitle={t('WorldDetail.paper.paths.subtitle')}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 13 }}>
        {paths.map((path, index) => (
          <Surface
            as="button"
            key={path.key}
            type="button"
            tone="card"
            material="solid"
            elevation="base"
            padding="none"
            interactive
            onClick={() => onEnterPath(path)}
            className="relative flex min-h-[200px] flex-col justify-end overflow-hidden text-left"
            style={{
              borderRadius: 'var(--nimi-radius-md)',
              borderColor: 'var(--nimi-border-subtle)',
              background: WARM_PANEL_BG,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 13,
                left: 13,
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: 'var(--nimi-action-primary-bg)',
                color: 'var(--nimi-action-primary-text)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 15,
                boxShadow: 'var(--nimi-elevation-raised)',
              }}
            >
              {index + 1}
            </div>
            <div style={{ position: 'relative', padding: '34px 16px 16px', background: 'linear-gradient(to top, var(--nimi-surface-card) 58%, color-mix(in srgb, var(--nimi-surface-card) 85%, transparent) 78%, transparent)' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--nimi-text-primary)', marginBottom: 5 }}>
                {path.key === 'lead' && path.leadName
                  ? t('WorldDetail.paper.paths.lead.titleNamed', { name: path.leadName })
                  : t(`WorldDetail.paper.paths.${path.key}.title`)}
              </div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: 'var(--nimi-text-secondary)' }}>
                {t(`WorldDetail.paper.paths.${path.key}.desc`)}
              </p>
              <span aria-hidden="true" style={{ display: 'inline-flex', marginTop: 13 }}>
                <IconArrow size={15} color="var(--nimi-action-primary-bg)" />
              </span>
            </div>
          </Surface>
        ))}
      </div>
    </PaperSection>
  );
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

function characterStatRow(character: WorldCharacter, t: ReturnType<typeof useTranslation>['t']): ReactNode {
  const stats: { label: string; value: string }[] = [];
  if (typeof character.stats?.engagementCount === 'number' && character.stats.engagementCount > 0) {
    stats.push({ label: t('WorldDetail.paper.characters.engagement'), value: formatNum(character.stats.engagementCount) });
  }
  if (typeof character.stats?.vitalityScore === 'number' && character.stats.vitalityScore > 0) {
    stats.push({ label: t('WorldDetail.paper.characters.vitality'), value: formatNum(Math.round(character.stats.vitalityScore)) });
  }
  if (stats.length === 0) {
    return null;
  }
  return (
    <div style={{ display: 'flex', gap: 18, margin: '14px 0 13px', padding: '10px 0', borderTop: '1px solid var(--nimi-border-subtle)', borderBottom: '1px solid var(--nimi-border-subtle)' }}>
      {stats.map((stat) => (
        <div key={stat.label}>
          <span style={{ fontSize: 11, color: 'var(--nimi-text-muted)' }}>{stat.label} </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--nimi-text-primary)' }}>{stat.value}</span>
        </div>
      ))}
    </div>
  );
}

export function PaperCharactersSection({
  characters,
  loading,
  onSelect,
  onViewCharacter,
  onMaterializeSource,
  onViewAll,
}: {
  characters: readonly WorldCharacter[];
  loading?: boolean;
  onSelect: (characterId: string) => void;
  onViewCharacter?: (character: WorldCharacter) => void;
  onMaterializeSource?: (character: WorldCharacter) => Promise<void> | void;
  onViewAll: () => void;
}) {
  const { t } = useTranslation();
  const featured = characters.slice(0, 6);
  return (
    <PaperSection
      id="world-detail-characters"
      testId="world-detail-paper-characters"
      title={t('WorldDetail.paper.characters.title')}
      subtitle={t('WorldDetail.paper.characters.subtitle')}
      action={characters.length > 0 ? <PaperViewAll label={t('WorldDetail.paper.viewAll')} onClick={onViewAll} /> : undefined}
    >
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(232px,1fr))', gap: 13 }}>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} style={{ height: 150, borderRadius: 14, background: 'color-mix(in srgb, var(--nimi-surface-card) 60%, transparent)' }} className="animate-pulse" />
          ))}
        </div>
      ) : featured.length === 0 ? (
        <EmptyState title={t('WorldDetail.paper.characters.empty')} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(232px,1fr))', gap: 13 }}>
          {featured.map((character) => {
            const connectable = character.relation?.state === 'connectable';
            return (
              <PaperCardSurface key={character.id} className="p-4">
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <button
                    type="button"
                    aria-label={t('WorldDetail.paper.characters.openProfile', {
                      name: character.name,
                      defaultValue: `Open ${character.name} profile`,
                    })}
                    onClick={() => (onViewCharacter ? onViewCharacter(character) : onSelect(character.id))}
                    style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }}
                  >
                    <PaperAvatar name={character.name} imageUrl={character.avatarUrl} size={54} />
                  </button>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        aria-label={t('WorldDetail.paper.characters.openProfile', {
                          name: character.name,
                          defaultValue: `Open ${character.name} profile`,
                        })}
                        onClick={() => (onViewCharacter ? onViewCharacter(character) : onSelect(character.id))}
                        style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontSize: 17, fontWeight: 700, color: 'var(--nimi-text-primary)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {character.name}
                      </button>
                    </div>
                    <NimiText as="div" role="helper" className="mt-1 truncate" style={{ color: 'var(--nimi-text-secondary)' }}>
                      {characterMeta(character)}
                    </NimiText>
                  </div>
                </div>
                {characterStatRow(character, t) ?? <div style={{ height: 14 }} />}
                <div style={{ display: 'flex' }}>
                  <Button
                    type="button"
                    tone="primary"
                    size="sm"
                    fullWidth
                    disabled={!connectable}
                    onClick={() => onMaterializeSource?.(character)}
                    className="flex-1"
                    style={{
                      background: connectable ? 'var(--nimi-action-primary-bg)' : 'var(--nimi-border-subtle)',
                      borderColor: connectable ? 'var(--nimi-action-primary-bg)' : 'var(--nimi-border-subtle)',
                      color: connectable ? 'var(--nimi-action-primary-text)' : 'var(--nimi-text-muted)',
                      cursor: connectable ? 'pointer' : 'default',
                    }}
                  >
                    {paperRelationLabel(character, t)}
                  </Button>
                </div>
              </PaperCardSurface>
            );
          })}
        </div>
      )}
    </PaperSection>
  );
}

// ---------------------------------------------------------------------------
// Lore overview
// ---------------------------------------------------------------------------

const LORE_OVERVIEW_ICON: Record<WorldLoreEntry['icon'], ReactNode> = {
  rule: <IconScrollText size={19} color="var(--nimi-action-primary-bg)" strokeWidth={1.75} />,
  institution: <IconStamp size={19} color="var(--nimi-action-primary-bg)" strokeWidth={1.75} />,
  pathway: <IconMilestone size={19} color="var(--nimi-action-primary-bg)" strokeWidth={1.75} />,
  system: <IconLayers size={19} color="var(--nimi-action-primary-bg)" strokeWidth={1.75} />,
  taboo: <IconShield size={19} color="var(--nimi-action-primary-bg)" strokeWidth={1.75} />,
  language: <IconLanguages size={19} color="var(--nimi-action-primary-bg)" strokeWidth={1.75} />,
};

function PaperLoreOverviewCard({ entry }: { entry: WorldLoreEntry }) {
  return (
    <PaperCardSurface className="p-4">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-grid',
            placeItems: 'center',
            width: 36,
            height: 36,
            flex: '0 0 auto',
            borderRadius: 'var(--nimi-radius-sm)',
            background: 'color-mix(in srgb, var(--nimi-action-primary-bg) 14%, transparent)',
            border: '1px solid var(--nimi-border-subtle)',
          }}
        >
          {LORE_OVERVIEW_ICON[entry.icon]}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 18, lineHeight: 1.28, fontWeight: 900, color: 'var(--nimi-text-primary)' }}>
            {entry.title}
          </h3>
        </div>
      </div>
    </PaperCardSurface>
  );
}

export function PaperLoreOverviewSection({
  semantic,
  loading,
}: {
  semantic: WorldSemanticData;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const entries = useMemo(() => buildWorldLoreEntries(semantic), [semantic]);
  if (!loading && entries.length === 0) {
    return null;
  }
  return (
    <PaperSection
      id="world-detail-lore-overview"
      testId="world-detail-paper-lore-overview"
      title={t('WorldDetail.paper.loreOverview.title')}
      subtitle={t('WorldDetail.paper.loreOverview.subtitle')}
    >
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 13 }}>
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} style={{ height: 70, borderRadius: 14, background: 'color-mix(in srgb, var(--nimi-surface-card) 60%, transparent)' }} className="animate-pulse" />
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 13 }}>
          {entries.map((entry) => (
            <PaperLoreOverviewCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </PaperSection>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export function PaperTimelineSection({
  history,
  loading,
}: {
  history: WorldHistoryBundle;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const items = history.items.slice(0, 6);
  return (
    <PaperSection
      id="world-detail-timeline"
      testId="world-detail-paper-timeline"
      title={t('WorldDetail.paper.timeline.title')}
      subtitle={t('WorldDetail.paper.timeline.subtitle')}
    >
      {loading ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} style={{ height: 64, borderRadius: 12, background: 'color-mix(in srgb, var(--nimi-surface-card) 60%, transparent)' }} className="animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t('WorldDetail.paper.timeline.empty')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((item, index) => (
            <div key={item.id} style={{ display: 'flex', gap: 16 }}>
              <div style={{ position: 'relative', width: 13, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                {index < items.length - 1 ? <div style={{ position: 'absolute', top: 8, bottom: 0, width: 2, background: 'var(--nimi-border-subtle)' }} /> : null}
                <div style={{ position: 'relative', width: 11, height: 11, borderRadius: '50%', marginTop: 6, background: 'var(--nimi-action-primary-bg)', border: '2px solid var(--nimi-surface-card)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--nimi-action-primary-bg) 18%, transparent)' }} />
              </div>
              <div style={{ flex: 1, paddingBottom: 20, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--nimi-action-primary-bg)' }}>{item.time}</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--nimi-text-primary)' }}>{item.title}</span>
                </div>
                <p style={{ margin: '5px 0 0', fontSize: 13.5, lineHeight: 1.7, color: 'var(--nimi-text-secondary)', maxWidth: 620 }}>{item.summary || item.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </PaperSection>
  );
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export function PaperScenesSection({
  sectionId = 'world-detail-scenes',
  scenes,
  highlightRefs,
  onSelectScene,
  onGoScenes,
}: {
  sectionId?: string;
  scenes: readonly WorldSceneItem[];
  highlightRefs: readonly WorldAssetExternalRef[];
  onSelectScene: (sceneId: string) => void;
  onGoScenes: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PaperSection
      id={sectionId}
      testId="world-detail-paper-scenes"
      title={t('WorldDetail.paper.scenes.title')}
      subtitle={t('WorldDetail.paper.scenes.subtitle')}
      action={<PaperViewAll label={t('WorldDetail.paper.viewAll')} onClick={onGoScenes} />}
    >
      {scenes.length === 0 ? (
        <EmptyState title={t('WorldDetail.paper.scenes.empty')} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 13 }}>
          {scenes.slice(0, 4).map((scene, index) => {
            const highlightRef = sceneImageRef(scene, highlightRefs, index);
            return (
              <Surface
                as="button"
                key={scene.id}
                type="button"
                tone="card"
                material="solid"
                elevation="base"
                padding="none"
                interactive
                data-testid="world-detail-paper-scene-entry-card"
                onClick={() => onSelectScene(scene.id)}
                className="grid min-h-[300px] grid-rows-[120px_1fr] overflow-hidden text-left"
                style={{
                  background: 'var(--nimi-surface-panel)',
                  borderColor: 'var(--nimi-border-subtle)',
                  borderRadius: 'var(--nimi-radius-md)',
                  boxShadow: 'none',
                }}
              >
                <div style={{ background: highlightRef ? `url(${highlightRef.uri}) center/cover no-repeat` : WARM_PANEL_BG }} />
                <div style={{ padding: '15px 16px 16px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div style={{ fontSize: 18, lineHeight: 1.35, fontWeight: 700, color: 'var(--nimi-text-primary)' }}>
                    {scene.name}
                  </div>
                  <p style={{ margin: '9px 0 15px', fontSize: 12.5, lineHeight: 1.65, color: 'var(--nimi-text-secondary)' }}>
                    {scene.description || t('WorldDetail.glass.scenes.defaultContext')}
                  </p>
                  <span style={{ marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--nimi-action-primary-bg)', fontSize: 12.5, fontWeight: 800 }}>
                    {t('WorldDetail.paper.scenes.enter')}
                    <IconArrow size={13} color="var(--nimi-action-primary-bg)" />
                  </span>
                </div>
              </Surface>
            );
          })}
        </div>
      )}
    </PaperSection>
  );
}
