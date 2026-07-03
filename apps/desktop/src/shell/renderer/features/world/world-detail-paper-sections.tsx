import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, NimiText, Statistic, Surface, cn } from '@nimiplatform/kit/ui';
import type { WorldAssetExternalRef, WorldCharacter, WorldHistoryBundle, WorldSceneItem } from './world-detail-types.js';
import { characterMeta, sceneImageRef } from './world-detail-template-model';
import {
  PAPER,
  PAPER_RADIUS,
  PAPER_SERIF,
  type PaperMaterial,
  type PaperMaterialKey,
  type PaperMetric,
  type PaperPath,
  formatNum,
} from './world-detail-paper-model';
import {
  IconArrow,
  IconBook,
  IconChat,
  IconClock,
  IconCompass,
  IconFile,
  IconLayers,
  IconScene,
  IconUsers,
  PaperAvatar,
  PaperSection,
  PaperViewAll,
} from './world-detail-paper-primitives';

const WARM_PANEL_BG = 'linear-gradient(135deg, color-mix(in srgb, var(--nimi-surface-panel) 72%, #e4d6ba), color-mix(in srgb, var(--nimi-action-primary-bg) 12%, #d6c4a3))';

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
        background: PAPER.cardSoft,
        borderColor: PAPER.borderSoft,
        borderRadius: PAPER_RADIUS.md,
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
  people: <IconUsers size={22} color={PAPER.ink} strokeWidth={1.5} />,
  materials: <IconBook size={22} color={PAPER.ink} strokeWidth={1.5} />,
  scenes: <IconScene size={22} color={PAPER.ink} strokeWidth={1.5} />,
  events: <IconCompass size={22} color={PAPER.ink} strokeWidth={1.5} />,
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
        background: PAPER.card,
        borderColor: PAPER.border,
        borderRadius: PAPER_RADIUS.lg,
        boxShadow: PAPER.cardShadow,
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
              style={{ background: PAPER.avatarGradient, color: PAPER.ink }}
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
              borderRadius: PAPER_RADIUS.md,
              borderColor: PAPER.borderSoft,
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
                background: PAPER.green,
                color: '#f6f2e7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: PAPER_SERIF,
                fontWeight: 700,
                fontSize: 15,
                boxShadow: '0 3px 8px rgba(0,0,0,.2)',
              }}
            >
              {index + 1}
            </div>
            <div style={{ position: 'relative', padding: '34px 16px 16px', background: 'linear-gradient(to top,#fbf8f1 58%,rgba(251,248,241,.85) 78%,rgba(251,248,241,0))' }}>
              <div style={{ fontFamily: PAPER_SERIF, fontSize: 16, fontWeight: 700, color: PAPER.inkStrong, marginBottom: 5 }}>
                {path.key === 'lead' && path.leadName
                  ? t('WorldDetail.paper.paths.lead.titleNamed', { name: path.leadName })
                  : t(`WorldDetail.paper.paths.${path.key}.title`)}
              </div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: PAPER.bodySoft }}>
                {t(`WorldDetail.paper.paths.${path.key}.desc`)}
              </p>
              <span aria-hidden="true" style={{ display: 'inline-flex', marginTop: 13 }}>
                <IconArrow size={15} color={PAPER.green} />
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
    <div style={{ display: 'flex', gap: 18, margin: '14px 0 13px', padding: '10px 0', borderTop: `1px solid ${PAPER.borderInner}`, borderBottom: `1px solid ${PAPER.borderInner}` }}>
      {stats.map((stat) => (
        <div key={stat.label}>
          <span style={{ fontSize: 11, color: PAPER.faint }}>{stat.label} </span>
          <span style={{ fontFamily: PAPER_SERIF, fontSize: 15, fontWeight: 700, color: PAPER.ink }}>{stat.value}</span>
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
            <div key={index} style={{ height: 150, borderRadius: 14, background: 'rgba(255,255,255,0.5)' }} className="animate-pulse" />
          ))}
        </div>
      ) : featured.length === 0 ? (
        <PaperCardSurface className="p-5 text-[length:var(--nimi-type-body-sm-size)]" >
          {t('WorldDetail.paper.characters.empty')}
        </PaperCardSurface>
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
                        style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: PAPER_SERIF, fontSize: 17, fontWeight: 700, color: PAPER.inkStrong, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {character.name}
                      </button>
                    </div>
                    <NimiText as="div" role="helper" className="mt-1 truncate" style={{ color: PAPER.bodySoft }}>
                      {characterMeta(character)}
                    </NimiText>
                  </div>
                </div>
                {characterStatRow(character, t) ?? <div style={{ height: 14 }} />}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    type="button"
                    tone="primary"
                    size="sm"
                    fullWidth
                    disabled={!connectable}
                    onClick={() => onMaterializeSource?.(character)}
                    className="flex-1"
                    style={{
                      background: connectable ? PAPER.green : 'rgba(120,108,80,.18)',
                      borderColor: connectable ? PAPER.green : 'rgba(120,108,80,.18)',
                      color: connectable ? '#f6f2e7' : PAPER.muted,
                      cursor: connectable ? 'pointer' : 'default',
                    }}
                  >
                    {paperRelationLabel(character, t)}
                  </Button>
                  <Button
                    type="button"
                    tone="secondary"
                    size="sm"
                    fullWidth
                    onClick={() => onSelect(character.id)}
                    leadingIcon={<IconChat size={14} color="currentColor" strokeWidth={1.7} />}
                    className="flex-1"
                    style={{
                      background: PAPER.card,
                      borderColor: PAPER.borderSoft,
                      color: PAPER.ink,
                    }}
                  >
                    {t('WorldDetail.paper.characters.chat')}
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
// Materials
// ---------------------------------------------------------------------------

const MATERIAL_ICON: Record<PaperMaterialKey, ReactNode> = {
  people: <IconUsers size={16} color="#fbf8f1" strokeWidth={1.7} />,
  scenes: <IconScene size={16} color="#fbf8f1" strokeWidth={1.7} />,
  events: <IconClock size={16} color="#fbf8f1" strokeWidth={1.7} />,
  resources: <IconLayers size={16} color="#fbf8f1" strokeWidth={1.7} />,
  lore: <IconFile size={16} color="#fbf8f1" strokeWidth={1.7} />,
};

export function PaperMaterialsSection({
  materials,
  onOpen,
  onOpenLibrary,
}: {
  materials: readonly PaperMaterial[];
  onOpen: (material: PaperMaterial) => void;
  onOpenLibrary: () => void;
}) {
  const { t } = useTranslation();
  if (materials.length === 0) {
    return null;
  }
  return (
    <PaperSection
      id="world-detail-materials"
      testId="world-detail-paper-materials"
      title={t('WorldDetail.paper.materials.title')}
      subtitle={t('WorldDetail.paper.materials.subtitle')}
      action={<PaperViewAll label={t('WorldDetail.paper.viewAll')} onClick={onOpenLibrary} />}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 13 }}>
        {materials.map((material) => (
          <Surface
            as="button"
            key={material.key}
            type="button"
            tone="card"
            material="solid"
            elevation="base"
            padding="none"
            interactive
            onClick={() => onOpen(material)}
            className="overflow-hidden text-left"
            style={{
              background: PAPER.cardSoft,
              borderColor: PAPER.borderSoft,
              borderRadius: PAPER_RADIUS.md,
              boxShadow: 'none',
            }}
          >
            <div style={{ position: 'relative', height: 96, background: WARM_PANEL_BG, display: 'flex', alignItems: 'flex-end', padding: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: PAPER.green, color: '#f6f2e7' }}>
                {MATERIAL_ICON[material.key]}
                {t(`WorldDetail.paper.materials.cat.${material.key}.tag`)}
              </span>
            </div>
            <div style={{ padding: '13px 14px' }}>
              <div style={{ fontFamily: PAPER_SERIF, fontSize: 15, fontWeight: 700, color: PAPER.inkStrong, marginBottom: 4 }}>
                {t(`WorldDetail.paper.materials.cat.${material.key}.title`)}
              </div>
              <div style={{ fontSize: 12, color: PAPER.muted, lineHeight: 1.5, minHeight: 34 }}>
                {t(`WorldDetail.paper.materials.cat.${material.key}.desc`)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 9, borderTop: `1px solid ${PAPER.borderInner}` }}>
                <span style={{ fontSize: 12, color: PAPER.faint }}>
                  <span style={{ fontFamily: PAPER_SERIF, fontWeight: 700, color: PAPER.ink }}>{formatNum(material.count)}</span>
                  {' '}
                  {t('WorldDetail.paper.materials.records')}
                </span>
                <IconArrow size={15} color={PAPER.green} />
              </div>
            </div>
          </Surface>
        ))}
      </div>
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
            <div key={index} style={{ height: 64, borderRadius: 12, background: 'rgba(255,255,255,0.5)' }} className="animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <PaperCardSurface className="p-5 text-[length:var(--nimi-type-body-sm-size)]">
          {t('WorldDetail.paper.timeline.empty')}
        </PaperCardSurface>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((item, index) => (
            <div key={item.id} style={{ display: 'flex', gap: 16 }}>
              <div style={{ position: 'relative', width: 13, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                {index < items.length - 1 ? <div style={{ position: 'absolute', top: 8, bottom: 0, width: 2, background: '#e6ddca' }} /> : null}
                <div style={{ position: 'relative', width: 11, height: 11, borderRadius: '50%', marginTop: 6, background: PAPER.green, border: `2px solid ${PAPER.card}`, boxShadow: '0 0 0 3px rgba(29,95,67,.12)' }} />
              </div>
              <div style={{ flex: 1, paddingBottom: 20, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: PAPER_SERIF, fontSize: 19, fontWeight: 700, color: PAPER.green }}>{item.time}</span>
                  <span style={{ fontFamily: PAPER_SERIF, fontSize: 16, fontWeight: 700, color: PAPER.inkStrong }}>{item.title}</span>
                </div>
                <p style={{ margin: '5px 0 0', fontSize: 13.5, lineHeight: 1.7, color: PAPER.bodySoft, maxWidth: 620 }}>{item.summary || item.description}</p>
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
  scenes,
  highlightRefs,
  onSelectScene,
  onGoScenes,
}: {
  scenes: readonly WorldSceneItem[];
  highlightRefs: readonly WorldAssetExternalRef[];
  onSelectScene: (sceneId: string) => void;
  onGoScenes: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PaperSection
      id="world-detail-scenes"
      testId="world-detail-paper-scenes"
      title={t('WorldDetail.paper.scenes.title')}
      subtitle={t('WorldDetail.paper.scenes.subtitle')}
      action={<PaperViewAll label={t('WorldDetail.paper.viewAll')} onClick={onGoScenes} />}
    >
      {scenes.length === 0 ? (
        <PaperCardSurface className="p-5 text-[length:var(--nimi-type-body-sm-size)]">
          {t('WorldDetail.paper.scenes.empty')}
        </PaperCardSurface>
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
                  background: PAPER.cardSoft,
                  borderColor: PAPER.borderSoft,
                  borderRadius: PAPER_RADIUS.md,
                  boxShadow: 'none',
                }}
              >
                <div style={{ background: highlightRef ? `url(${highlightRef.uri}) center/cover no-repeat` : WARM_PANEL_BG }} />
                <div style={{ padding: '15px 16px 16px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div style={{ fontFamily: PAPER_SERIF, fontSize: 18, lineHeight: 1.35, fontWeight: 700, color: PAPER.inkStrong }}>
                    {scene.name}
                  </div>
                  <p style={{ margin: '9px 0 15px', fontSize: 12.5, lineHeight: 1.65, color: PAPER.bodySoft }}>
                    {scene.description || t('WorldDetail.glass.scenes.defaultContext')}
                  </p>
                  <span style={{ marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: PAPER.green, fontSize: 12.5, fontWeight: 800 }}>
                    {t('WorldDetail.paper.scenes.enter')}
                    <IconArrow size={13} color={PAPER.green} />
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
