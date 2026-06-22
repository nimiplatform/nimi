import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNum, sealGradientFor, worldInitial } from './world-list-atoms';
import { displayTags, GLASS_CARD_CLASS, GLASS_CARD_STYLE, sourceCount, statusLabel, worldThumbBackground } from './world-list-catalog-model';
import { IconArrow, IconDots, IconShare, Pill } from './world-list-catalog-primitives';
import type { WorldListItem } from './world-list-model';

type AtlasPanelMode = 'overview' | 'entities' | 'characters';

export function SelectedWorldPanel({
  world,
  onOpen,
}: {
  world: WorldListItem;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AtlasPanelMode>('overview');
  const banner = world.bannerUrl;
  const tags = displayTags(world, 6);
  const characters = world.characters?.slice(0, 6) ?? [];
  const worldCharacters = characters.filter((character) => character.sourceKind !== 'realmPersona');
  const personaSources = characters.filter((character) => character.sourceKind === 'realmPersona');
  const entityKinds = world.entityKinds.slice(0, 6);
  const relationshipTypes = world.relationshipTypes.slice(0, 4);
  const schemaTabs: readonly { id: AtlasPanelMode; label: string }[] = [
    { id: 'overview', label: t('World.atlas.schemaTabs.overview') },
    { id: 'entities', label: t('World.atlas.schemaTabs.entities') },
    { id: 'characters', label: t('World.atlas.schemaTabs.characters') },
  ];
  return (
    <aside
      className={GLASS_CARD_CLASS}
      data-nimi-material="glass-regular"
      data-nimi-tone="panel"
      data-testid="world-atlas-selected-panel"
      style={{
        ...GLASS_CARD_STYLE,
        position: 'sticky',
        top: 12,
        alignSelf: 'start',
        minWidth: 0,
        borderRadius: 22,
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative', height: 212, background: worldThumbBackground(banner) }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(12,24,42,0.05), rgba(12,24,42,0.26))' }} />
        {banner ? null : (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: 'rgba(255,255,255,0.78)',
              fontSize: 76,
              fontWeight: 950,
              transform: 'translateY(-18px)',
            }}
          >
            {worldInitial(world.name)}
          </div>
        )}
        <div
          data-testid="world-atlas-hero-title"
          style={{
            position: 'absolute',
            left: 18,
            right: 18,
            bottom: 24,
            display: 'grid',
            justifyItems: 'center',
            gap: 8,
            textAlign: 'center',
          }}
        >
          <h2
            style={{
              margin: 0,
              maxWidth: '100%',
              color: '#ffffff',
              fontSize: 22,
              fontWeight: 950,
              letterSpacing: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textShadow: '0 8px 24px rgba(38,49,86,0.28)',
              whiteSpace: 'nowrap',
            }}
          >
            {world.name}
          </h2>
          <Pill tone="mint">{statusLabel(world)}</Pill>
        </div>
        <div style={{ position: 'absolute', right: 13, top: 13, display: 'flex', gap: 9 }}>
          <button
            type="button"
            aria-label={t('World.atlas.actions.shareWorld')}
            style={{
              width: 38,
              height: 38,
              border: '1px solid rgba(255,255,255,0.20)',
              borderRadius: 999,
              background: 'rgba(23,45,70,0.34)',
              color: '#ffffff',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
            }}
          >
            <IconShare />
          </button>
          <button
            type="button"
            aria-label={t('World.atlas.actions.moreWorldActions')}
            style={{
              width: 38,
              height: 38,
              border: '1px solid rgba(255,255,255,0.20)',
              borderRadius: 999,
              background: 'rgba(23,45,70,0.34)',
              color: '#ffffff',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
            }}
          >
            <IconDots />
          </button>
        </div>
      </div>
      <div style={{ padding: '0 24px 24px' }}>
        <div
          data-testid="world-atlas-schema-tabs"
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 5,
            marginTop: -18,
            padding: 4,
            borderRadius: 14,
            background: 'rgba(232,238,252,0.84)',
            border: '1px solid rgba(129,145,169,0.10)',
            boxShadow: '0 12px 28px rgba(64,82,125,0.10)',
          }}
        >
          {schemaTabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              style={{
                height: 31,
                border: 0,
                borderRadius: 10,
                background: mode === item.id ? 'rgba(255,255,255,0.92)' : 'transparent',
                color: mode === item.id ? '#2563eb' : '#66758b',
                boxShadow: mode === item.id ? '0 8px 16px rgba(74,103,165,0.10)' : 'none',
                fontSize: 11,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6, marginTop: 14 }}>
          <PanelStat label={t('World.stats.sources')} value={formatNum(sourceCount(world))} />
          <PanelStat label={t('World.stats.entities')} value={formatNum(world.entityCount)} />
          <PanelStat label={t('World.stats.characters')} value={formatNum(world.characterCount)} />
          <PanelStat label={t('World.stats.scenes')} value={formatNum(world.sceneCount)} />
        </div>
        <section style={{ marginTop: 22 }}>
          <PanelHeading title={t('World.stats.flow')} action={t('World.atlas.actions.details')} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <Pill tone="violet">{`${world.computed.time.flowRatio.toFixed(2)}x`}</Pill>
            <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'rgba(148,163,184,0.16)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(10, Math.min(92, world.computed.time.flowRatio * 48))}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: 'linear-gradient(90deg, #5fc9ea, #8f73ff)',
                }}
              />
            </div>
          </div>
        </section>
        {mode === 'overview' ? (
          <div style={{ display: 'grid', gap: 22, marginTop: 22 }}>
            <section>
              <PanelHeading title={t('WorldDetail.about')} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {tags.length > 0 ? tags.map((tag, index) => (
                  <Pill key={tag} tone={index % 3 === 0 ? 'violet' : index % 3 === 1 ? 'blue' : 'mint'}>{tag}</Pill>
                )) : <Pill>{t('World.atlas.publicWorld')}</Pill>}
              </div>
            </section>
            <section>
              <PanelHeading title={t('World.atlas.entityKinds')} action={`${formatNum(world.entityCount)} ${t('World.stats.entities')}`} />
              <SchemaPillRow
                emptyLabel={t('World.atlas.noEntityKinds')}
                values={entityKinds}
              />
            </section>
            <RelationshipGraphPreview
              detailsLabel={t('World.atlas.actions.details')}
              relationshipCount={world.relationshipCount}
              relationshipTypes={relationshipTypes}
              emptyLabel={t('World.atlas.noRelationshipTypes')}
              title={t('World.atlas.relationshipGraph')}
              worldName={world.name}
            />
            <SourceDiscoveryPreview
              characters={characters}
              detailsLabel={t('World.atlas.actions.details')}
              emptyLabel={t('World.atlas.emptySources')}
              personaCount={world.personaCount}
              personaSources={personaSources.length}
              personaLabel={t('World.atlas.sourceKinds.persona')}
              sourceCountValue={sourceCount(world)}
              title={t('World.atlas.sourceDiscovery')}
              totalLabel={t('World.atlas.totalSources')}
              worldCharacterCount={world.characterCount}
              worldCharacterLabel={t('World.atlas.sourceKinds.worldCharacter')}
              worldCharacters={worldCharacters.length}
              note={t('World.atlas.sourceBoundaryNote', {
                characters: formatNum(world.characterCount),
                personas: formatNum(world.personaCount),
              })}
            />
          </div>
        ) : null}

        {mode === 'entities' ? (
          <div style={{ display: 'grid', gap: 18, marginTop: 22 }}>
            <section>
              <PanelHeading title={t('World.atlas.entityKinds')} action={`${formatNum(world.entityCount)} ${t('World.stats.entities')}`} />
              <SchemaPillRow emptyLabel={t('World.atlas.noEntityKinds')} values={entityKinds} />
            </section>
            <RelationshipGraphPreview
              detailsLabel={t('World.atlas.actions.details')}
              relationshipCount={world.relationshipCount}
              relationshipTypes={relationshipTypes}
              emptyLabel={t('World.atlas.noRelationshipTypes')}
              title={t('World.atlas.relationshipGraph')}
              worldName={world.name}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <PanelStat label={t('World.stats.scenes')} value={formatNum(world.sceneCount)} />
              <PanelStat label={t('World.stats.timelineEvents')} value={formatNum(world.timelineEventCount)} />
            </div>
          </div>
        ) : null}

        {mode === 'characters' ? (
          <div style={{ display: 'grid', gap: 18, marginTop: 22 }}>
            <SourceDiscoveryPreview
              characters={characters}
              detailsLabel={t('World.atlas.actions.details')}
              emptyLabel={t('World.atlas.emptySources')}
              personaCount={world.personaCount}
              personaSources={personaSources.length}
              personaLabel={t('World.atlas.sourceKinds.persona')}
              sourceCountValue={sourceCount(world)}
              title={t('World.atlas.worldCharacters')}
              totalLabel={t('World.atlas.totalSources')}
              worldCharacterCount={world.characterCount}
              worldCharacterLabel={t('World.atlas.sourceKinds.worldCharacter')}
              worldCharacters={worldCharacters.length}
              note={t('World.atlas.sourceBoundaryNote', {
                characters: formatNum(world.characterCount),
                personas: formatNum(world.personaCount),
              })}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <PanelStat label={t('World.atlas.worldCharacters')} value={formatNum(world.characterCount)} />
              <PanelStat label={t('World.stats.personas')} value={formatNum(world.personaCount)} />
            </div>
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 52px', gap: 12, marginTop: 24 }}>
          <button
            type="button"
            onClick={onOpen}
            style={{
              height: 54,
              border: 0,
              borderRadius: 14,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              color: '#ffffff',
              background: 'linear-gradient(135deg, #5fc9ea, #9b72ee)',
              boxShadow: '0 16px 30px rgba(104,123,238,0.28)',
              fontSize: 15,
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            {t('World.card.view')}
            <span style={{ width: 26, height: 26, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.18)' }}>
              <IconArrow />
            </span>
          </button>
          <button
            type="button"
            aria-label={t('World.atlas.actions.bookmarkWorld')}
            style={{
              border: '1px solid rgba(129,145,169,0.14)',
              borderRadius: 14,
              background: 'rgba(255,255,255,0.66)',
              color: '#53637a',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
            }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 4h12v16l-6-3-6 3z" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}

function SchemaPillRow({ emptyLabel, values }: { emptyLabel: string; values: string[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
      {values.length > 0 ? values.map((value, index) => (
        <Pill key={value} tone={index % 3 === 0 ? 'mint' : index % 3 === 1 ? 'violet' : 'blue'}>
          {value}
        </Pill>
      )) : (
        <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700 }}>{emptyLabel}</span>
      )}
    </div>
  );
}

function RelationshipGraphPreview({
  detailsLabel,
  emptyLabel,
  relationshipCount,
  relationshipTypes,
  title,
  worldName,
}: {
  detailsLabel: string;
  emptyLabel: string;
  relationshipCount: number;
  relationshipTypes: string[];
  title: string;
  worldName: string;
}) {
  const visibleTypes = relationshipTypes.slice(0, 4);
  return (
    <section data-testid="world-atlas-relationship-graph-compact">
      <PanelHeading title={title} action={detailsLabel} />
      <div
        data-testid="world-atlas-relationship-graph-map"
        style={{
          display: 'grid',
          gap: 7,
          marginTop: 10,
          borderRadius: 14,
          background: 'rgba(255,255,255,0.28)',
          padding: 10,
        }}
      >
        {visibleTypes.length > 0 ? (
          <div data-testid="world-atlas-relationship-graph-lanes" style={{ display: 'grid', gap: 7, minWidth: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 54px minmax(0, 1fr)', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <RelationshipPill label={visibleTypes[0] ?? emptyLabel} tone="mint" />
              <RelationshipCount value={formatNum(relationshipCount)} />
              <RelationshipPill label={worldName} tone="blue" />
            </div>
            {visibleTypes.length > 1 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
                {visibleTypes.slice(1).map((value, index) => (
                  <RelationshipPill key={value} label={value} tone={index % 3 === 0 ? 'violet' : index % 3 === 1 ? 'mint' : 'blue'} />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700 }}>{emptyLabel}</span>
        )}
      </div>
    </section>
  );
}

function RelationshipCount({ value }: { value: string }) {
  return (
    <span style={{ display: 'grid', justifyItems: 'center', gap: 3, minWidth: 0 }}>
      <span style={{ width: 38, height: 2, borderRadius: 999, background: 'linear-gradient(90deg, #45d0aa, #8f73ff)' }} />
      <span style={{ color: '#64748b', fontSize: 10, fontWeight: 850, whiteSpace: 'nowrap' }}>{value}</span>
    </span>
  );
}

function RelationshipPill({
  label,
  tone,
}: {
  label: string;
  tone: 'mint' | 'blue' | 'violet';
}) {
  const color = tone === 'mint' ? '#0f7d68' : tone === 'blue' ? '#3156d8' : '#6b45da';
  const background = tone === 'mint' ? 'rgba(69,208,170,0.13)' : tone === 'blue' ? 'rgba(92,137,255,0.13)' : 'rgba(143,115,255,0.13)';
  return (
    <span
      title={label}
      style={{
        minWidth: 0,
        borderRadius: 999,
        padding: '7px 10px',
        color,
        background,
        fontSize: 11,
        fontWeight: 900,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        textAlign: 'center',
      }}
    >
      {label}
    </span>
  );
}

function SourceDiscoveryPreview({
  characters,
  detailsLabel,
  emptyLabel,
  note,
  personaCount,
  personaLabel,
  personaSources,
  sourceCountValue,
  title,
  totalLabel,
  worldCharacterCount,
  worldCharacterLabel,
  worldCharacters,
}: {
  characters: NonNullable<WorldListItem['characters']>;
  detailsLabel: string;
  emptyLabel: string;
  note: string;
  personaCount: number;
  personaLabel: string;
  personaSources: number;
  sourceCountValue: number;
  title: string;
  totalLabel: string;
  worldCharacterCount: number;
  worldCharacterLabel: string;
  worldCharacters: number;
}) {
  return (
    <section data-testid="world-atlas-source-discovery-compact">
      <PanelHeading title={title} action={detailsLabel} />
      <p style={{ margin: '9px 0 0', color: '#64748b', fontSize: 11, lineHeight: 1.45, fontWeight: 750 }}>
        {note}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        {sourceCountValue === 0 ? (
          <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700 }}>
            {emptyLabel}
          </span>
        ) : characters.length > 0 ? characters.map((character, index) => (
          <SourceAvatar key={character.id} character={character} index={index} />
        )) : null}
        {characters.length > 0 && sourceCountValue > characters.length ? (
          <span style={{ marginLeft: 4, color: '#50617a', fontSize: 12, fontWeight: 800 }}>
            +{formatNum(sourceCountValue - characters.length)}
          </span>
        ) : null}
      </div>
      <div
        data-testid="world-atlas-source-breakdown"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 6,
          marginTop: 10,
        }}
      >
        <SourceMetric label={totalLabel} tone="blue" value={formatNum(sourceCountValue)} />
        <SourceMetric label={worldCharacterLabel} tone="mint" value={formatNum(Math.max(worldCharacterCount, worldCharacters))} />
        <SourceMetric label={personaLabel} tone="violet" value={formatNum(Math.max(personaCount, personaSources))} />
      </div>
    </section>
  );
}

function SourceMetric({
  label,
  tone,
  value,
}: {
  label: string;
  tone: 'blue' | 'mint' | 'violet';
  value: string;
}) {
  const color = tone === 'mint' ? '#0f7d68' : tone === 'blue' ? '#3156d8' : '#6b45da';
  const background = tone === 'mint' ? 'rgba(69,208,170,0.12)' : tone === 'blue' ? 'rgba(92,137,255,0.12)' : 'rgba(143,115,255,0.12)';
  return (
    <span
      title={`${value} ${label}`}
      style={{
        minWidth: 0,
        borderRadius: 11,
        padding: '7px 6px',
        background,
        color,
        display: 'grid',
        gap: 2,
        justifyItems: 'center',
      }}
    >
      <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, fontWeight: 950 }}>{value}</span>
      <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 9, fontWeight: 850 }}>{label}</span>
    </span>
  );
}

function SourceAvatar({
  character,
  index,
}: {
  character: NonNullable<WorldListItem['characters']>[number];
  index: number;
}) {
  return (
    <div
      title={character.sourceKind === 'realmPersona' ? `${character.name} · Persona` : `${character.name} · WorldCharacter`}
      style={{
        width: 30,
        height: 30,
        borderRadius: 999,
        display: 'grid',
        placeItems: 'center',
        color: '#ffffff',
        fontSize: 11,
        fontWeight: 900,
        background: character.avatarUrl
          ? `url(${character.avatarUrl}) center/cover no-repeat`
          : sealGradientFor(`${character.id}-${index}`),
        border: character.sourceKind === 'realmPersona'
          ? '2px solid rgba(143,115,255,0.70)'
          : '2px solid rgba(255,255,255,0.72)',
        marginLeft: index === 0 ? 0 : -8,
      }}
    >
      {character.avatarUrl ? null : worldInitial(character.name)}
    </div>
  );
}

function PanelHeading({ title, action }: { title: string; action?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <h3 style={{ margin: 0, color: '#111827', fontSize: 14, fontWeight: 950, letterSpacing: 0 }}>{title}</h3>
      {action ? <span style={{ color: '#7a8799', fontSize: 11, fontWeight: 800 }}>{action} &gt;</span> : null}
    </div>
  );
}

function PanelStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        borderRadius: 13,
        background: 'rgba(255,255,255,0.40)',
        padding: '10px 8px',
        textAlign: 'center',
        minWidth: 0,
      }}
    >
      <div style={{ color: '#334155', fontSize: 12, fontWeight: 950, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      <div style={{ marginTop: 4, color: '#7a8799', fontSize: 10, fontWeight: 800, letterSpacing: 0 }}>{label}</div>
    </div>
  );
}
