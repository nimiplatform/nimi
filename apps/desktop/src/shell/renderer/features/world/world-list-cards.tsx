import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { prefetchWorldDetailAndHistory } from './world-detail-queries';
import { prefetchWorldDetailPanel } from './world-detail-route-state';
import type { WorldListItem } from './world-list-model';
import { WorldChronoPanel } from './world-list-chrono-panel';
import { Chip, Pulse, Seal, Stat, StatusDot, formatNum, pulseFromId, sealGradientFor } from './world-list-atoms';
const FROZEN_STATUS = 'FROZEN';
function initialLetter(name: string): string {
  const letter = name.trim().charAt(0).toUpperCase();
  return letter || 'W';
}
function worldTagline(world: WorldListItem): string {
  return world.description || world.tagline || '';
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
  fadeStop,
}: {
  world: WorldListItem;
  height: number;
  fadeStop: number;
}) {
  if (!world.bannerUrl) return null;
  const backgroundStyle: CSSProperties = {
    position: 'relative',
    height,
    overflow: 'hidden',
    background: `linear-gradient(135deg, rgba(15,23,42,0.25), rgba(15,23,42,0.15)), url(${world.bannerUrl}) center/cover no-repeat`,
  };
  return (
    <div style={backgroundStyle}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(180deg, transparent 0%, transparent ${fadeStop}%, rgba(255,255,255,0.88) 100%)`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
export function FeaturedWorldCard({ world, onOpen }: { world: WorldListItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const tags = worldTags(world).slice(0, 6);
  const tagline = worldTagline(world);
  return (
    <section
      className="nimi-material-glass-thick"
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 'var(--nimi-radius-xl)',
        border: '1px solid var(--nimi-material-glass-thick-border)',
        background: 'var(--nimi-material-glass-thick-bg)',
        backdropFilter: 'blur(var(--nimi-backdrop-blur-strong))',
        WebkitBackdropFilter: 'blur(var(--nimi-backdrop-blur-strong))',
        boxShadow: 'var(--nimi-elevation-raised)',
      }}
      data-nimi-material="glass-thick"
      data-nimi-tone="card"
    >
      <CoverBand world={world} height={180} fadeStop={40} />
      <div style={{ padding: 24, position: 'relative' }}>
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
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 6,
                  flexWrap: 'wrap',
                }}
              >
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
                <StatusDot
                  active={world.status !== FROZEN_STATUS}
                  activeLabel={t('World.status.active')}
                  idleLabel={t('World.status.idle')}
                />
                <Chip>{world.nativeCreationState}</Chip>
              </div>
              {tagline ? (
                <p
                  style={{
                    margin: '4px 0 12px',
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: 'var(--nimi-text-secondary)',
                    maxWidth: 560,
                  }}
                >
                  {tagline}
                </p>
              ) : null}
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
      className="nimi-material-glass-regular"
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
        background: 'var(--nimi-material-glass-regular-bg)',
        border: '1px solid var(--nimi-material-glass-regular-border)',
        backdropFilter: 'blur(var(--nimi-backdrop-blur-regular))',
        WebkitBackdropFilter: 'blur(var(--nimi-backdrop-blur-regular))',
        borderRadius: 'var(--nimi-radius-lg)',
        boxShadow: 'var(--nimi-elevation-base)',
      }}
      data-nimi-material="glass-regular"
      data-nimi-tone="card"
    >
      <CoverBand world={world} height={72} fadeStop={40} />
      <div
        style={{
          padding: 16,
          paddingTop: hasCover ? 0 : 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          flex: 1,
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            marginTop: hasCover ? -22 : 0,
          }}
        >
          <Seal
            letter={initialLetter(world.name)}
            gradient={sealGradientFor(world.id)}
            imageUrl={world.iconUrl}
            size={44}
            radius={12}
          />
          <div style={{ flex: 1, minWidth: 0, paddingTop: hasCover ? 22 : 0 }}>
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
                marginBottom: 3,
              }}
              title={world.name}
            >
              {world.name}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusDot
                active={world.status !== FROZEN_STATUS}
                activeLabel={t('World.status.active')}
                idleLabel={t('World.status.idle')}
              />
              <span
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: 999,
                  background: 'rgba(148,163,184,0.6)',
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--nimi-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontWeight: 600,
                }}
              >
                {world.nativeCreationState}
              </span>
            </div>
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
            <Stat label={t('World.stats.online')} value={formatNum(world.agentCount)} valueSize={13} />
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
    </article>
  );
}
export function WorldListRow({ world, onOpen }: { world: WorldListItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const tags = worldTags(world).slice(0, 2);
  const pulse = useMemo(() => pulseFromId(world.id), [world.id]);
  return (
    <article
      className="nimi-material-glass-regular"
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
        border: '1px solid var(--nimi-material-glass-regular-border)',
        backdropFilter: 'blur(var(--nimi-backdrop-blur-regular))',
        WebkitBackdropFilter: 'blur(var(--nimi-backdrop-blur-regular))',
        borderRadius: 'var(--nimi-radius-lg)',
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
      <Stat label={t('World.stats.online')} value={formatNum(world.agentCount)} valueSize={13} />
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
