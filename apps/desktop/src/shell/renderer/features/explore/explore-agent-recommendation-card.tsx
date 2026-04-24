import { useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { i18n } from '@renderer/i18n';
import { DesktopCardSurface } from '@renderer/components/surface';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import type { ExploreAgentCardData } from './explore-cards';

// Hash an identifier into a stable 12-point curve in [0.3, 1]. This powers the
// decorative activity sparkline on the agent card — we have no time-series
// engagement data, so the curve is deterministic per-agent rather than
// synthesized per render (which would flicker) or mocked as uniform fake data.
function deterministicPulse(seed: string, points = 12): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const out: number[] = [];
  for (let i = 0; i < points; i += 1) {
    h = (h * 1664525 + 1013904223) >>> 0;
    out.push(0.3 + ((h % 1000) / 1000) * 0.7);
  }
  return out;
}
function MiniSparkline({ seed, width = 52, height = 18 }: { seed: string; width?: number; height?: number }) {
  const id = useMemo(() => `agent-pulse-${Math.random().toString(36).slice(2, 10)}`, []);
  const data = useMemo(() => deterministicPulse(seed), [seed]);
  const max = Math.max(...data, 1);
  const step = width / Math.max(data.length - 1, 1);
  const points = data
    .map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * height * 0.9 - 2).toFixed(1)}`)
    .join(' ');
  const area = `0,${height} ${points} ${width},${height}`;
  return (
    <svg width={width} height={height} style={{ display: 'block' }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--nimi-accent)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--nimi-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={points} fill="none" stroke="var(--nimi-accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
function friendPillStyle(state: 'none' | 'pending' | 'friend'): CSSProperties {
  if (state === 'friend') {
    return {
      background: 'var(--nimi-accent-soft)',
      color: 'var(--nimi-accent-onAccent)',
      borderColor: 'color-mix(in srgb, var(--nimi-accent) 35%, transparent)',
    };
  }
  if (state === 'pending') {
    return {
      background: 'transparent',
      color: 'var(--nimi-fg-3)',
      borderColor: 'var(--nimi-border-subtle)',
    };
  }
  return {
    background: 'transparent',
    color: 'var(--nimi-fg-1)',
    borderColor: 'var(--nimi-border-strong)',
  };
}
function formatCompact(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(2).replace(/\.?0+$/, '')}k`;
  return String(n);
}
// Compact Agent Card for horizontal scrolling recommendation section.
// Layout: rank kicker + Public pill · aurora blob · glyph tile + name/role ·
// Origin meta row · footer (sparkline + count + stateful friend pill). Every
// color uses fg-*/accent-*/border-* tokens, every font uses the three font
// tokens. The sparkline is decorative — see deterministicPulse comment.
export function AgentRecommendationCard({
  agent,
  onAddFriend,
  onOpen,
}: {
  agent: ExploreAgentCardData;
  onAddFriend?: () => void;
  onOpen?: () => void;
}) {
  const [friendship, setFriendship] = useState<'none' | 'pending' | 'friend'>('none');
  const palette = getSemanticAgentPalette({
    category: agent.category,
    origin: agent.origin,
    description: agent.bio || null,
    worldName: agent.worldName,
    tags: agent.tags,
  });
  const roleText = agent.bio
    || agent.category
    || agent.tags[0]
    || i18n.t('Explore.defaultRole', { defaultValue: 'Companion' });
  const originText = agent.origin || agent.worldName || agent.category || i18n.t('Profile.unknownWorld', { defaultValue: 'Unknown world' });
  const postsCount = typeof agent.postsCount === 'number' ? agent.postsCount : 0;
  const isPublic = agent.accountVisibility === 'PUBLIC';
  const glyph = agent.name ? agent.name.trim().charAt(0).toUpperCase() : '·';
  const handleFriendClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (friendship === 'none') {
      setFriendship('pending');
      onAddFriend?.();
      return;
    }
    if (friendship === 'pending') {
      setFriendship('friend');
      return;
    }
    setFriendship('none');
  };
  const pillLabel = friendship === 'friend'
    ? i18n.t('Explore.friendshipFriends', { defaultValue: 'Friends' })
    : friendship === 'pending'
      ? i18n.t('Explore.friendshipRequested', { defaultValue: 'Requested' })
      : i18n.t('Explore.friendshipAdd', { defaultValue: 'Add friend' });
  return (
    <DesktopCardSurface
      kind="promoted-glass"
      className="group relative flex h-full w-full min-w-0 cursor-pointer flex-col gap-3.5 overflow-hidden p-4 transition-all duration-200"
      style={{ background: palette.background }}
      onClick={() => onOpen?.()}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.transform = 'translateY(-2px)';
        el.style.boxShadow = 'var(--nimi-elevation-raised)';
        el.style.borderColor = 'var(--nimi-border-strong)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.transform = 'translateY(0)';
        el.style.boxShadow = 'var(--nimi-elevation-base)';
        el.style.borderColor = 'var(--nimi-border-subtle)';
      }}
    >
      {/* Aurora wash tied to agent palette */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-[120px] w-[120px] rounded-full"
        style={{ background: palette.ring, opacity: 0.14, filter: 'blur(32px)' }}
      />
      {/* Glyph tile + name + role + public pill */}
      <div className="relative flex items-start gap-3">
        {agent.avatarUrl ? (
          <div
            className="shrink-0 overflow-hidden"
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 8px rgba(0,0,0,0.18), var(--nimi-elevation-base)',
            }}
          >
            <EntityAvatar
              imageUrl={agent.avatarUrl}
              name={agent.name}
              kind="agent"
              sizeClassName="h-12 w-12"
              textClassName="text-base font-semibold"
            />
          </div>
        ) : (
          <div
            className="grid shrink-0 place-items-center"
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: palette.ring,
              color: 'var(--nimi-fg-inverse)',
              fontFamily: 'var(--nimi-font-display)',
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 8px rgba(0,0,0,0.18), var(--nimi-elevation-base)',
            }}
          >
            {glyph}
          </div>
        )}
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="min-w-0 truncate"
              style={{
                fontFamily: 'var(--nimi-font-display)',
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                color: 'var(--nimi-fg-1)',
                lineHeight: 1.2,
              }}
            >
              {agent.name}
            </span>
            {isPublic && (
              <span
                aria-label={i18n.t('AgentDetail.publicBadge', { defaultValue: 'Public' })}
                title={i18n.t('AgentDetail.publicBadge', { defaultValue: 'Public' })}
                className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background: 'var(--nimi-accent)',
                  boxShadow: '0 0 0 3px var(--nimi-accent-soft)',
                }}
              />
            )}
          </div>
          <div
            className="truncate"
            style={{
              fontFamily: 'var(--nimi-font-sans)',
              fontSize: 11,
              color: 'var(--nimi-fg-3)',
              marginTop: 2,
            }}
          >
            {roleText}
          </div>
        </div>
      </div>
      {/* Origin meta row */}
      <div className="relative flex items-baseline justify-between gap-2">
        <span
          style={{
            fontFamily: 'var(--nimi-font-mono)',
            fontSize: 11,
            color: 'var(--nimi-fg-3)',
            letterSpacing: '0.04em',
          }}
        >
          {i18n.t('Explore.originLabel', { defaultValue: 'Origin' })}
        </span>
        <span
          className="min-w-0 truncate text-right"
          style={{
            fontFamily: 'var(--nimi-font-sans)',
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--nimi-fg-2)',
          }}
        >
          {originText}
        </span>
      </div>
      {/* Footer: sparkline + count + friend pill */}
      <div
        className="relative mt-auto flex items-center justify-between border-t pt-3"
        style={{ borderColor: 'var(--nimi-border-subtle)' }}
      >
        <div className="flex items-center gap-2.5">
          <MiniSparkline seed={agent.id} />
          <div className="flex flex-col leading-tight">
            <span
              style={{
                fontFamily: 'var(--nimi-font-mono)',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--nimi-fg-1)',
              }}
            >
              {formatCompact(postsCount)}
            </span>
            <span
              style={{
                fontFamily: 'var(--nimi-font-mono)',
                fontSize: 9,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontWeight: 600,
                color: 'var(--nimi-fg-3)',
              }}
            >
              {i18n.t('Explore.chatsLabel', { defaultValue: 'Posts' })}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleFriendClick}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors"
          style={{
            fontFamily: 'var(--nimi-font-sans)',
            fontSize: 11,
            fontWeight: 600,
            ...friendPillStyle(friendship),
          }}
          title={pillLabel}
          aria-label={pillLabel}
        >
          {friendship === 'friend' ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : friendship === 'pending' ? null : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          )}
          {pillLabel}
        </button>
      </div>
    </DesktopCardSurface>
  );
}
