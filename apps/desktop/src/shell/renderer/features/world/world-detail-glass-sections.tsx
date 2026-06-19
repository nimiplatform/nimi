import { useTranslation } from 'react-i18next';
import type { WorldCharacter, WorldDetailData, WorldHistoryBundle, WorldHistoryItem, WorldSceneItem, WorldSemanticData } from './world-detail-types.js';
import { detailHeroBackground, detailSceneBackground, characterMeta, currentWorldTime, displayTags, formatNum, personaCount, relationLabel, sourceCount, topRules, worldCharacterCount, worldStatus, worldSummary } from './world-detail-template-model';
import { GLASS_STYLE, GLASS_STRONG_STYLE, GLASS_STRONG_SURFACE_CLASS, GLASS_SURFACE_CLASS, GlassButton, IconArrowLeft, IconArrowRight, IconDots, IconShare, InfoTile, PanelTitle, Pill, Seal, SectionCard } from './world-detail-glass-primitives';
import { worldInitial } from './world-list-atoms';

export function DetailHero({
  world,
  characters,
  onBack,
  onScrollTo,
}: {
  world: WorldDetailData;
  characters: readonly WorldCharacter[];
  onBack?: () => void;
  onScrollTo: (id: string) => void;
}) {
  const { t } = useTranslation();
  const tags = displayTags(world).slice(0, 4);
  const banner = world.bannerUrl;
  const tabs = [
    { id: 'world-detail-lore', label: t('WorldDetail.glass.nav.lore') },
    { id: 'world-detail-rules', label: t('WorldDetail.glass.nav.rules') },
    { id: 'world-detail-characters', label: t('WorldDetail.glass.nav.characters') },
    { id: 'world-detail-scenes', label: t('WorldDetail.glass.nav.scenes') },
    { id: 'world-detail-timeline', label: t('WorldDetail.glass.nav.timeline') },
  ];
  return (
    <section
      className={GLASS_STRONG_SURFACE_CLASS}
      data-nimi-material="glass-thick"
      data-nimi-tone="hero"
      style={{
        ...GLASS_STRONG_STYLE,
        position: 'relative',
        minHeight: 302,
        borderRadius: 24,
        overflow: 'hidden',
        background: detailHeroBackground(banner),
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(9,21,40,0.58), rgba(9,21,40,0.10) 56%, rgba(9,21,40,0.34))' }} />
      {banner ? null : (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'rgba(255,255,255,0.20)',
            fontSize: 150,
            fontWeight: 950,
          }}
        >
          {worldInitial(world.name)}
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 18 }}>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          {onBack ? (
            <button
              type="button"
              aria-label={t('WorldDetail.glass.backToAtlas')}
              onClick={onBack}
              style={{
                width: 42,
                height: 42,
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.24)',
                background: 'rgba(8,23,36,0.36)',
                color: '#8ff0d0',
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
              }}
            >
              <IconArrowLeft />
            </button>
          ) : null}
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onScrollTo(tab.id)}
              style={{
                height: 38,
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(8,23,36,0.42)',
                color: '#ffffff',
                padding: '0 14px',
                fontSize: 13,
                fontWeight: 850,
                fontFamily: 'var(--nimi-font-sans)',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 9 }}>
          <GlassButton label={t('World.atlas.actions.shareWorld')}><IconShare /></GlassButton>
          <GlassButton label={t('World.atlas.actions.moreWorldActions')}><IconDots /></GlassButton>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          zIndex: 1,
          left: 30,
          right: 30,
          bottom: 28,
          display: 'grid',
          gridTemplateColumns: '72px minmax(0,1fr)',
          gap: 18,
          alignItems: 'end',
        }}
      >
        <Seal name={world.name} imageUrl={world.iconUrl} size={72} />
        <div style={{ minWidth: 0, color: '#ffffff' }}>
          <div style={{ color: '#8ff0d0', fontSize: 11, lineHeight: 1.2, fontWeight: 950, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 12 }}>
            {world.tagline || world.motto || t('WorldDetail.glass.publicSettingBackground')}
          </div>
          <h1 style={{ margin: 0, fontSize: 40, lineHeight: 1, fontWeight: 950, letterSpacing: 0 }}>{world.name}</h1>
          <p style={{ margin: '12px 0 0', maxWidth: 740, color: 'rgba(255,255,255,0.88)', fontSize: 14, lineHeight: 1.48, fontWeight: 650 }}>
            {worldSummary(world)}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            <Pill tone="mint">{worldStatus(world)}</Pill>
            <Pill tone="blue">{t('WorldDetail.glass.sourcesCount', { value: formatNum(sourceCount(characters)) })}</Pill>
            <Pill tone="violet">{t('WorldDetail.glass.timeflowValue', { value: world.flowRatio.toFixed(2) })}</Pill>
            {tags.map((tag) => <Pill key={tag}>{tag}</Pill>)}
          </div>
        </div>
      </div>
    </section>
  );
}

export function HeroStats({
  world,
  characters,
  history,
}: {
  world: WorldDetailData;
  characters: readonly WorldCharacter[];
  history: WorldHistoryBundle;
}) {
  const { t } = useTranslation();
  const stats = [
    { label: t('WorldDetail.glass.stats.sources'), value: formatNum(sourceCount(characters)) },
    { label: t('WorldDetail.glass.stats.worldOwned'), value: formatNum(worldCharacterCount(characters)) },
    { label: t('WorldDetail.glass.stats.userPersonas'), value: formatNum(personaCount(characters)) },
    { label: t('WorldDetail.glass.stats.worldTime'), value: currentWorldTime(world) },
    { label: t('WorldDetail.glass.stats.events'), value: formatNum(history.summary?.totalCount ?? history.items.length) },
    { label: t('WorldDetail.glass.stats.flow'), value: `${world.flowRatio.toFixed(2)}x` },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 10 }}>
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={GLASS_SURFACE_CLASS}
          data-nimi-material="glass-regular"
          data-nimi-tone="card"
          style={{
            ...GLASS_STYLE,
            borderRadius: 16,
            padding: '14px 12px',
            minWidth: 0,
          }}
        >
          <div style={{ color: '#111827', fontSize: 15, fontWeight: 950, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stat.value}</div>
          <div style={{ marginTop: 5, color: '#7a8799', fontSize: 10, fontWeight: 850, textTransform: 'uppercase' }}>{stat.label}</div>
        </div>
      ))}
    </div>
  );
}

export function LorePanel({
  world,
  semantic,
}: {
  world: WorldDetailData;
  semantic: WorldSemanticData;
}) {
  const { t } = useTranslation();
  const rules = topRules(semantic);
  return (
    <SectionCard
      id="world-detail-lore"
      testId="world-detail-lore-panel"
      title={t('WorldDetail.glass.lore.title')}
      subtitle={t('WorldDetail.glass.lore.subtitle')}
    >
      <p style={{ margin: 0, color: '#40506a', fontSize: 14, lineHeight: 1.65, fontWeight: 650 }}>
        {worldSummary(world)}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 18 }}>
        <InfoTile label={t('WorldDetail.glass.lore.primaryLanguage')} value={world.primaryLanguage || world.commonLanguages?.[0] || t('WorldDetail.glass.notSpecified')} />
        <InfoTile label={t('WorldDetail.glass.lore.era')} value={world.eraLabel || world.era || t('WorldDetail.glass.openEra')} />
        <InfoTile label={t('WorldDetail.glass.lore.contentRating')} value={world.contentRating || t('World.atlas.publicWorld')} />
      </div>
      <div id="world-detail-rules" style={{ display: 'grid', gap: 10, marginTop: 18 }}>
        <h3 style={{ margin: 0, color: '#111827', fontSize: 14, fontWeight: 950 }}>{t('WorldDetail.glass.lore.rulesTitle')}</h3>
        {rules.length > 0 ? rules.map((rule) => (
          <div key={rule.key} style={{ borderRadius: 14, padding: 14, background: 'rgba(255,255,255,0.48)', border: '1px solid rgba(113,132,158,0.12)' }}>
            <div style={{ color: '#111827', fontSize: 13, fontWeight: 900 }}>{rule.title}</div>
            <p style={{ margin: '6px 0 0', color: '#5b6a80', fontSize: 12, lineHeight: 1.55, fontWeight: 650 }}>{rule.value}</p>
          </div>
        )) : (
          <div style={{ borderRadius: 14, padding: 14, color: '#64748b', background: 'rgba(255,255,255,0.44)', fontSize: 13, fontWeight: 650 }}>
            {t('WorldDetail.glass.lore.emptyRules')}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

export function CharacterGallery({
  characters,
  loading,
  onSelect,
  onConnectSource,
}: {
  characters: readonly WorldCharacter[];
  loading?: boolean;
  onSelect: (characterId: string) => void;
  onConnectSource?: (character: WorldCharacter) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const featured = characters.slice(0, 6);
  return (
    <SectionCard
      id="world-detail-characters"
      testId="world-detail-character-gallery"
      title={t('WorldDetail.glass.characters.title')}
      subtitle={t('WorldDetail.glass.characters.subtitle')}
      action={<Pill tone="blue">{t('WorldDetail.glass.sourcesCount', { value: formatNum(characters.length) })}</Pill>}
    >
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-[108px] animate-pulse rounded-2xl bg-white/50" />
          ))}
        </div>
      ) : featured.length === 0 ? (
        <div style={{ borderRadius: 16, padding: 22, color: '#64748b', background: 'rgba(255,255,255,0.42)', fontSize: 13, fontWeight: 650 }}>
          {t('WorldDetail.glass.characters.empty')}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
          {featured.map((character) => (
            <article key={character.id} style={{ display: 'grid', gridTemplateColumns: '54px minmax(0,1fr)', gap: 12, borderRadius: 16, padding: 12, background: 'rgba(255,255,255,0.48)', border: '1px solid rgba(113,132,158,0.10)' }}>
              <Seal name={character.name} imageUrl={character.avatarUrl} size={54} />
              <div style={{ minWidth: 0 }}>
                <button
                  type="button"
                  onClick={() => onSelect(character.id)}
                  style={{ display: 'block', maxWidth: '100%', border: 0, background: 'transparent', color: '#111827', fontSize: 13, fontWeight: 950, padding: 0, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {character.name}
                </button>
                <div style={{ marginTop: 4, color: '#64748b', fontSize: 11, lineHeight: 1.35, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {characterMeta(character)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <Pill tone={character.ownership === 'userOwned' ? 'violet' : 'mint'}>
                    {character.ownership === 'userOwned' ? t('WorldDetail.glass.characters.persona') : t('WorldDetail.glass.characters.character')}
                  </Pill>
                  <button
                    type="button"
                    disabled={character.relation?.state !== 'connectable'}
                    onClick={() => onConnectSource?.(character)}
                    style={{
                      border: 0,
                      background: character.relation?.state === 'connectable' ? 'rgba(76,125,245,0.12)' : 'rgba(148,163,184,0.13)',
                      color: character.relation?.state === 'connectable' ? '#315fd6' : '#7a8799',
                      borderRadius: 999,
                      padding: '6px 10px',
                      fontSize: 11,
                      fontWeight: 900,
                      cursor: character.relation?.state === 'connectable' ? 'pointer' : 'default',
                    }}
                  >
                    {relationLabel(character)}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function TimelinePanel({
  history,
  loading,
}: {
  history: WorldHistoryBundle;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const items = history.items.slice(0, 5);
  return (
    <SectionCard
      id="world-detail-timeline"
      testId="world-detail-timeline-panel"
      title={t('WorldDetail.glass.timeline.title')}
      subtitle={t('WorldDetail.glass.timeline.subtitle')}
    >
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-2xl bg-white/50" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div style={{ borderRadius: 16, padding: 22, color: '#64748b', background: 'rgba(255,255,255,0.42)', fontSize: 13, fontWeight: 650 }}>
          {t('WorldDetail.glass.timeline.empty')}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {items.map((item) => <TimelineItem key={item.id} item={item} />)}
        </div>
      )}
    </SectionCard>
  );
}

export function TimelineItem({ item }: { item: WorldHistoryItem }) {
  return (
    <article style={{ display: 'grid', gridTemplateColumns: '78px minmax(0,1fr)', gap: 14, borderRadius: 16, padding: 14, background: 'rgba(255,255,255,0.46)', border: '1px solid rgba(113,132,158,0.10)' }}>
      <div>
        <div style={{ color: '#4c7df5', fontSize: 12, fontWeight: 950 }}>{item.tag}</div>
        <div style={{ color: '#7a8799', fontSize: 11, fontWeight: 750, marginTop: 5 }}>{item.time}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <h3 style={{ margin: 0, color: '#111827', fontSize: 13, fontWeight: 950 }}>{item.title}</h3>
        <p style={{ margin: '5px 0 0', color: '#5b6a80', fontSize: 12, lineHeight: 1.5, fontWeight: 650 }}>{item.summary || item.description}</p>
      </div>
    </article>
  );
}

export function ScenesPanel({
  scenes,
  highlightImages,
  onSelectScene,
}: {
  scenes: readonly WorldSceneItem[];
  highlightImages: readonly string[];
  onSelectScene: (sceneId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <SectionCard
      id="world-detail-scenes"
      title={t('WorldDetail.glass.scenes.title')}
      subtitle={t('WorldDetail.glass.scenes.subtitle')}
    >
      {scenes.length === 0 ? (
        <div style={{ borderRadius: 16, padding: 22, color: '#64748b', background: 'rgba(255,255,255,0.42)', fontSize: 13, fontWeight: 650 }}>
          {t('WorldDetail.glass.scenes.empty')}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
          {scenes.slice(0, 4).map((scene, index) => {
            const highlightImage = highlightImages[index % Math.max(1, highlightImages.length)] ?? null;
            return (
              <button
                key={scene.id}
                type="button"
                onClick={() => onSelectScene(scene.id)}
                style={{
                  minHeight: 130,
                  border: '1px solid rgba(113,132,158,0.10)',
                  borderRadius: 16,
                  padding: 14,
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: '#ffffff',
                  background: detailSceneBackground(highlightImage),
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 950 }}>{scene.name}</div>
                <div style={{ marginTop: 5, color: 'rgba(255,255,255,0.84)', fontSize: 12, lineHeight: 1.45, fontWeight: 650 }}>
                  {scene.description || t('WorldDetail.glass.scenes.defaultContext')}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

export function SourceDiscoveryPanel({
  world,
  characters,
  highlightImages,
  onSelectCharacter,
  onConnectSource,
}: {
  world: WorldDetailData;
  characters: readonly WorldCharacter[];
  highlightImages: readonly string[];
  onSelectCharacter: (characterId: string) => void;
  onConnectSource?: (character: WorldCharacter) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const primarySource = characters.find((character) => character.relation?.state === 'connectable') ?? characters[0] ?? null;
  return (
    <aside
      className={`world-detail-side-panel ${GLASS_STRONG_SURFACE_CLASS}`}
      data-nimi-material="glass-thick"
      data-nimi-tone="panel"
      data-testid="world-detail-source-discovery"
      style={{
        ...GLASS_STRONG_STYLE,
        position: 'sticky',
        top: 12,
        borderRadius: 24,
        padding: 22,
        alignSelf: 'start',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Seal name={world.name} imageUrl={world.iconUrl} size={72} />
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, color: '#111827', fontSize: 22, fontWeight: 950, letterSpacing: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{world.name}</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>
            <Pill tone="mint">{worldStatus(world)}</Pill>
            <Pill tone="blue">{world.type === 'OASIS' ? t('World.sidebar.filters.main') : t('World.sidebar.filters.sub')}</Pill>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10, marginTop: 22 }}>
        <InfoTile label={t('WorldDetail.glass.stats.sources')} value={formatNum(sourceCount(characters))} />
        <InfoTile label={t('WorldDetail.glass.stats.timeflow')} value={`${world.flowRatio.toFixed(2)}x`} />
        <InfoTile label={t('WorldDetail.glass.stats.characters')} value={formatNum(worldCharacterCount(characters))} />
        <InfoTile label={t('WorldDetail.glass.stats.personas')} value={formatNum(personaCount(characters))} />
      </div>

      <div style={{ marginTop: 24 }}>
        <PanelTitle title={t('WorldDetail.glass.sourceDiscovery.primarySource')} />
        {primarySource ? (
          <div style={{ marginTop: 12, borderRadius: 18, padding: 14, background: 'rgba(255,255,255,0.48)', border: '1px solid rgba(113,132,158,0.11)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '48px minmax(0,1fr)', gap: 12, alignItems: 'center' }}>
              <Seal name={primarySource.name} imageUrl={primarySource.avatarUrl} size={48} />
              <div style={{ minWidth: 0 }}>
                <button
                  type="button"
                  onClick={() => onSelectCharacter(primarySource.id)}
                  style={{ display: 'block', maxWidth: '100%', border: 0, background: 'transparent', color: '#111827', fontSize: 14, fontWeight: 950, padding: 0, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {primarySource.name}
                </button>
                <div style={{ color: '#64748b', fontSize: 11, fontWeight: 750, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {characterMeta(primarySource)}
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={primarySource.relation?.state !== 'connectable'}
              onClick={() => onConnectSource?.(primarySource)}
              style={{
                width: '100%',
                height: 48,
                marginTop: 14,
                border: 0,
                borderRadius: 14,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 9,
                color: '#ffffff',
                background: primarySource.relation?.state === 'connectable'
                  ? 'linear-gradient(135deg, #5fc9ea, #9b72ee)'
                  : 'rgba(148,163,184,0.35)',
                boxShadow: primarySource.relation?.state === 'connectable' ? '0 16px 30px rgba(104,123,238,0.24)' : 'none',
                fontSize: 14,
                fontWeight: 950,
                cursor: primarySource.relation?.state === 'connectable' ? 'pointer' : 'default',
              }}
            >
              {relationLabel(primarySource)}
              <IconArrowRight />
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 12, borderRadius: 16, padding: 16, color: '#64748b', background: 'rgba(255,255,255,0.42)', fontSize: 13, fontWeight: 650 }}>
            {t('WorldDetail.glass.sourceDiscovery.empty')}
          </div>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <PanelTitle title={t('WorldDetail.glass.sourceDiscovery.featuredSources')} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          {characters.slice(0, 7).map((character, index) => (
            <button
              key={character.id}
              type="button"
              title={character.name}
              onClick={() => onSelectCharacter(character.id)}
              style={{
                width: 30,
                height: 30,
                borderRadius: 999,
                border: '2px solid rgba(255,255,255,0.78)',
                background: character.avatarUrl
                  ? `url(${character.avatarUrl}) center/cover no-repeat`
                  : 'linear-gradient(135deg, #67d8c2, #8a78ff)',
                color: '#ffffff',
                fontSize: 11,
                fontWeight: 950,
                display: 'grid',
                placeItems: 'center',
                marginLeft: index === 0 ? 0 : -9,
                cursor: 'pointer',
              }}
            >
              {character.avatarUrl ? null : worldInitial(character.name)}
            </button>
          ))}
          {characters.length > 7 ? <span style={{ color: '#53637a', fontSize: 12, fontWeight: 850 }}>+{formatNum(characters.length - 7)}</span> : null}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <PanelTitle title={t('WorldDetail.glass.sourceDiscovery.settingHighlights')} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginTop: 12 }}>
          {(highlightImages.length > 0 ? highlightImages.slice(0, 3) : [null, null, null]).map((image, index) => (
            <div
              key={image ?? `setting-highlight-pending-${index}`}
              style={{
                height: 62,
                borderRadius: 12,
                background: detailSceneBackground(image),
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.34)',
                display: 'grid',
                placeItems: 'center',
                color: 'rgba(255,255,255,0.78)',
                fontSize: 17,
                fontWeight: 950,
              }}
            >
              {image ? null : worldInitial(world.name)}
            </div>
          ))}
        </div>
      </div>

      <p style={{ margin: '24px 0 0', color: '#64748b', fontSize: 12, lineHeight: 1.55, fontWeight: 650 }}>
        {t('WorldDetail.glass.sourceDiscovery.note')}
      </p>
    </aside>
  );
}
