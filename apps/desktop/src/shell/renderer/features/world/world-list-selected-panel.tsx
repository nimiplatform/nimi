import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNum, sealGradientFor, worldInitial } from './world-list-atoms';
import { dayLabel, displayTags, GLASS_CARD_CLASS, GLASS_CARD_STYLE, sourceCount, statusLabel, worldThumbBackground } from './world-list-catalog-model';
import { IconArrow, IconDots, IconShare, Pill, Seal } from './world-list-catalog-primitives';
import type { WorldListItem } from './world-list-model';

export function SelectedWorldPanel({
  world,
  onOpen,
}: {
  world: WorldListItem;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const banner = world.bannerUrl;
  const tags = displayTags(world, 6);
  const characters = world.characters?.slice(0, 6) ?? [];
  const highlights = world.highlightUrls.slice(0, 3);
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
      <div style={{ position: 'relative', height: 218, background: worldThumbBackground(banner) }}>
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
              fontSize: 74,
              fontWeight: 950,
            }}
          >
            {worldInitial(world.name)}
          </div>
        )}
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
        <div style={{ display: 'flex', alignItems: 'end', gap: 14, marginTop: -45 }}>
          <div style={{ border: '4px solid rgba(255,255,255,0.82)', borderRadius: 24, boxShadow: '0 14px 30px rgba(54,80,125,0.16)' }}>
            <Seal world={world} size={82} radius={20} />
          </div>
          <div style={{ minWidth: 0, paddingBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, color: '#111827', fontSize: 22, fontWeight: 950, letterSpacing: 0 }}>{world.name}</h2>
              <Pill tone="mint">{statusLabel(world)}</Pill>
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 18 }}>
          <PanelStat label={t('World.stats.sources')} value={formatNum(sourceCount(world))} />
          <PanelStat label={t('World.stats.personas')} value={formatNum(world.personaCount)} />
          <PanelStat label={t('World.stats.day')} value={dayLabel(world)} />
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
        <section style={{ marginTop: 24 }}>
          <PanelHeading title={t('WorldDetail.about')} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {tags.length > 0 ? tags.map((tag, index) => (
              <Pill key={tag} tone={index % 3 === 0 ? 'violet' : index % 3 === 1 ? 'blue' : 'mint'}>{tag}</Pill>
            )) : <Pill>{t('World.atlas.publicWorld')}</Pill>}
          </div>
        </section>
        <section style={{ marginTop: 24 }}>
          <PanelHeading title={t('World.atlas.sourceDiscovery')} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            {characters.length > 0 ? characters.map((character, index) => (
              <div
                key={character.id}
                title={character.name}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  display: 'grid',
                  placeItems: 'center',
                  color: '#ffffff',
                  fontSize: 11,
                  fontWeight: 900,
                  background: character.avatarUrl
                    ? `url(${character.avatarUrl}) center/cover no-repeat`
                    : sealGradientFor(`${world.id}-${index}`),
                  border: '2px solid rgba(255,255,255,0.70)',
                  marginLeft: index === 0 ? 0 : -8,
                }}
              >
                {character.avatarUrl ? null : worldInitial(character.name)}
              </div>
            )) : (
              <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700 }}>
                {t('World.atlas.emptySources')}
              </span>
            )}
            {sourceCount(world) > characters.length ? (
              <span style={{ marginLeft: 4, color: '#50617a', fontSize: 12, fontWeight: 800 }}>
                +{formatNum(sourceCount(world) - characters.length)}
              </span>
            ) : null}
          </div>
        </section>
        <section style={{ marginTop: 24 }}>
          <PanelHeading title={t('World.atlas.recentHighlights')} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 12 }}>
            {(highlights.length > 0 ? highlights : [null, null, null]).map((src, index) => (
              <div
                key={src ?? `highlight-pending-${index}`}
                style={{
                  height: 58,
                  borderRadius: 10,
                  background: worldThumbBackground(src),
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.34)',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'rgba(255,255,255,0.78)',
                  fontSize: 16,
                  fontWeight: 950,
                }}
              >
                {src ? null : worldInitial(world.name)}
              </div>
            ))}
          </div>
        </section>
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
      <div style={{ marginTop: 4, color: '#7a8799', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}
