import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { prefetchWorldDetailAndHistory } from './world-detail-queries';
import { prefetchWorldDetailPanel } from './world-detail-route-state';
import type { WorldListItem } from './world-list-model';
import { WorldChronoPanel } from './world-list-chrono-panel';
import { Chip, Pulse, Seal, Stat, formatNum, pulseFromId, sealGradientFor } from './world-list-atoms';
const FROZEN_STATUS = 'FROZEN';
function initialLetter(name: string): string {
  const letter = name.trim().charAt(0).toUpperCase();
  return letter || 'W';
}
function worldTagline(world: WorldListItem): string {
  return world.description || world.tagline || '';
}
// D-EXPL-003 `lineage`: World type / lineage label. Reads the Realm world
// projection's `type` only; never synthesizes a value.
function worldLineageLabel(world: WorldListItem): string | null {
  const raw = world.type?.trim();
  return raw ? raw : null;
}
function worldTags(world: WorldListItem): string[] {
  const out: string[] = [];
  if (world.genre) out.push(world.genre);
  if (world.era) out.push(world.era);
  for (const theme of world.themes) {
    if (!out.includes(theme)) out.push(theme);
  }
  return out;
}

function CoverBand({
  world,
  height,
}: {
  world: WorldListItem;
  height: number;
}) {
  if (!world.bannerUrl) return null;
  const backgroundStyle: CSSProperties = {
    position: 'relative',
    height,
    overflow: 'hidden',
    background: `linear-gradient(135deg, rgba(15,23,42,0.25), rgba(15,23,42,0.15)), url(${world.bannerUrl}) center/cover no-repeat`,
  };
  return <div style={backgroundStyle} />;
}
export function FeaturedWorldCard({ world, onOpen }: { world: WorldListItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const tags = worldTags(world).slice(0, 6);
  return (
    <section
      className="nimi-material-glass-thick backdrop-blur-[var(--nimi-backdrop-blur-strong)]"
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 'var(--nimi-radius-xl)',
        border: '1px solid var(--nimi-material-glass-thick-border)',
        boxShadow: 'var(--nimi-elevation-raised)',
      }}
      data-nimi-material="glass-thick"
      data-nimi-tone="card"
    >
      <CoverBand world={world} height={180} />
      <div
        style={{
          position: 'relative',
          marginTop: world.bannerUrl ? -36 : 0,
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--nimi-material-glass-thick-bg)',            maskImage: world.bannerUrl
              ? 'linear-gradient(to bottom, transparent 0, black 36px)'
              : undefined,
            WebkitMaskImage: world.bannerUrl
              ? 'linear-gradient(to bottom, transparent 0, black 36px)'
              : undefined,
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative', padding: 24, paddingTop: 56 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 28,
              alignItems: 'start',
            }}
          >
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', minWidth: 0 }}>
            <Seal
              letter={initialLetter(world.name)}
              gradient={sealGradientFor(world.id)}
              imageUrl={world.iconUrl}
              size={68}
              radius={16}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  marginBottom: 6,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <h1
                    style={{
                      margin: 0,
                      fontFamily: 'var(--nimi-font-display)',
                      fontSize: 30,
                      fontWeight: 700,
                      letterSpacing: '-0.02em',
                      color: 'var(--nimi-text-primary)',
                    }}
                  >
                    {world.name}
                  </h1>
                  {world.status !== FROZEN_STATUS && (
                    <span
                      className="desktop-world-pulse-dot"
                      aria-label={t('World.status.active')}
                      title={t('World.status.active')}
                      style={{ marginTop: 10 }}
                    />
                  )}
                </div>
                {/* D-EXPL-003 `lineage`: conditional, shrinks when absent. */}
                {worldLineageLabel(world) ? <Chip>{worldLineageLabel(world)}</Chip> : null}
              </div>
              {tags.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {tags.map((tag) => (
                    <Chip key={tag}>{tag}</Chip>
                  ))}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={onOpen}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '9px 16px',
                    borderRadius: 10,
                    border: '1px solid var(--nimi-action-primary-bg)',
                    background: 'var(--nimi-action-primary-bg)',
                    color: 'var(--nimi-action-primary-text)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 160ms, box-shadow 160ms',
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = 'var(--nimi-action-primary-bg-hover)';
                    event.currentTarget.style.borderColor = 'var(--nimi-action-primary-bg-hover)';
                    event.currentTarget.style.boxShadow = 'var(--nimi-elevation-raised)';
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'var(--nimi-action-primary-bg)';
                    event.currentTarget.style.borderColor = 'var(--nimi-action-primary-bg)';
                    event.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14" />
                    <path d="M13 6l6 6-6 6" />
                  </svg>
                  {t('World.card.enter')}
                </button>
              </div>
            </div>
          </div>
          <div
            className="nimi-world-featured-chrono"
            style={{ minWidth: 260, maxWidth: 340 }}
          >
            <WorldChronoPanel world={world} />
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}
export function WorldCard({ world, onOpen }: { world: WorldListItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const tags = worldTags(world).slice(0, 3);
  const extraTagCount = Math.max(0, worldTags(world).length - tags.length);
  const pulse = useMemo(() => pulseFromId(world.id), [world.id]);
  const tagline = worldTagline(world);
  const hasCover = Boolean(world.bannerUrl);
  return (
    <article
      className="nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
      onClick={onOpen}
      onMouseEnter={(event) => {
        prefetchWorldDetailPanel();
        prefetchWorldDetailAndHistory(world.id);
        event.currentTarget.style.boxShadow = 'var(--nimi-elevation-raised)';
        event.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.boxShadow = 'var(--nimi-elevation-base)';
        event.currentTarget.style.transform = 'translateY(0)';
      }}
      style={{
        padding: 0,
        cursor: 'pointer',
        transition: 'transform 200ms, box-shadow 200ms',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 244,
        border: '1px solid var(--nimi-material-glass-regular-border)',
        borderRadius: 'var(--nimi-radius-lg)',
        boxShadow: 'var(--nimi-elevation-base)',
      }}
      data-nimi-material="glass-regular"
      data-nimi-tone="card"
    >
      <CoverBand world={world} height={72} />
      <div
        style={{
          position: 'relative',
          marginTop: hasCover ? -20 : 0,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--nimi-material-glass-regular-bg)',            maskImage: hasCover
              ? 'linear-gradient(to bottom, transparent 0, black 20px)'
              : undefined,
            WebkitMaskImage: hasCover
              ? 'linear-gradient(to bottom, transparent 0, black 20px)'
              : undefined,
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'relative',
            padding: 16,
            paddingTop: 32,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            flex: 1,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
          <Seal
            letter={initialLetter(world.name)}
            gradient={sealGradientFor(world.id)}
            imageUrl={world.iconUrl}
            size={44}
            radius={12}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
                marginBottom: 3,
                minWidth: 0,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontFamily: 'var(--nimi-font-display)',
                  fontSize: 16,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  color: 'var(--nimi-text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
                title={world.name}
              >
                {world.name}
              </h3>
              {world.status !== FROZEN_STATUS && (
                <span
                  className="desktop-world-pulse-dot"
                  aria-label={t('World.status.active')}
                  title={t('World.status.active')}
                  style={{ marginTop: 6 }}
                />
              )}
            </div>
            {/* D-EXPL-003 `lineage`: conditional, shrinks when absent. */}
            {worldLineageLabel(world) ? (
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--nimi-text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    fontWeight: 600,
                  }}
                >
                  {worldLineageLabel(world)}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        {tagline ? (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.55,
              color: 'var(--nimi-text-secondary)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {tagline}
          </p>
        ) : null}
        {(tags.length > 0 || extraTagCount > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tags.map((tag) => (
              <Chip key={tag}>{tag}</Chip>
            ))}
            {extraTagCount > 0 ? <Chip muted>+{extraTagCount}</Chip> : null}
          </div>
        )}
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 12,
            borderTop: '1px solid var(--nimi-border-subtle)',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 16 }}>
            <Stat label={t('World.stats.online')} value={formatNum(world.characterCount)} valueSize={13} />
            <Stat label={t('World.stats.day')} value={String(world.level)} valueSize={13} />
            <Stat
              label={t('World.stats.flow')}
              value={`${world.computed.time.flowRatio.toFixed(2)}×`}
              valueSize={13}
            />
          </div>
          <Pulse data={pulse} width={84} height={24} gradientId={`pulse-${world.id}`} />
        </div>
        </div>
      </div>
    </article>
  );
}
export function WorldListRow({ world, onOpen }: { world: WorldListItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const tags = worldTags(world).slice(0, 2);
  const pulse = useMemo(() => pulseFromId(world.id), [world.id]);
  return (
    <article
      className="nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
      onClick={onOpen}
      onMouseEnter={(event) => {
        prefetchWorldDetailPanel();
        prefetchWorldDetailAndHistory(world.id);
        event.currentTarget.style.boxShadow = 'var(--nimi-elevation-raised)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.boxShadow = 'var(--nimi-elevation-base)';
      }}
      style={{
        padding: '14px 18px',
        cursor: 'pointer',
        display: 'grid',
        gridTemplateColumns: '44px 1.4fr 1fr 0.8fr 0.8fr 0.8fr 100px 24px',
        gap: 18,
        alignItems: 'center',
        transition: 'box-shadow 160ms',
        background: 'var(--nimi-material-glass-regular-bg)',
        border: '1px solid var(--nimi-material-glass-regular-border)',        borderRadius: 'var(--nimi-radius-lg)',
        boxShadow: 'var(--nimi-elevation-base)',
      }}
      data-nimi-material="glass-regular"
      data-nimi-tone="card"
    >
      <Seal
        letter={initialLetter(world.name)}
        gradient={sealGradientFor(world.id)}
        imageUrl={world.iconUrl}
        size={40}
        radius={10}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--nimi-font-display)',
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            marginBottom: 2,
            color: 'var(--nimi-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {world.name}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--nimi-text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {worldTagline(world)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', overflow: 'hidden' }}>
        {tags.map((tag) => (
          <Chip key={tag}>{tag}</Chip>
        ))}
      </div>
      <Stat label={t('World.stats.online')} value={formatNum(world.characterCount)} valueSize={13} />
      <Stat label={t('World.stats.day')} value={String(world.level)} valueSize={13} />
      <Stat
        label={t('World.stats.flow')}
        value={`${world.computed.time.flowRatio.toFixed(2)}×`}
        valueSize={13}
      />
      <Pulse data={pulse} width={92} height={26} gradientId={`pulse-row-${world.id}`} />
      <svg
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: 'var(--nimi-text-muted)' }}
        aria-hidden="true"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </article>
  );
}
