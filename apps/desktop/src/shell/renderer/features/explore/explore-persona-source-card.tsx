import { useDesktopI18nResource } from '../../i18n/i18n-context';
import type { CSSProperties, MouseEvent } from 'react';

import { AppCardSurface } from '@nimiplatform/kit/ui';
import { getSemanticSourcePalette } from '../../components/source-theme.js';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { E2E_IDS } from '../../testability/e2e-ids';
import type { ExplorePersonaSourceCardData } from './explore-cards';
import {
  describeCharacterPrimaryAction,
  type CharacterSourceState,
} from './character-source-materialization';

function sourcePillStyle(state: CharacterSourceState): CSSProperties {
  if (state === 'source_materialization_available' || state === 'local_agent_available') {
    return {
      background: 'var(--nimi-accent-soft)',
      color: 'var(--nimi-accent)',
      borderColor: 'var(--nimi-accent)',
    };
  }
  return {
    background: 'transparent',
    color: 'var(--nimi-fg-3)',
    borderColor: 'var(--nimi-border-subtle)',
  };
}
function formatCompact(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(2).replace(/\.?0+$/, '')}k`;
  return String(n);
}
function PrimaryActionIcon({ action: _action }: { action: CharacterPrimaryActionGlyph }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
type CharacterPrimaryActionGlyph = ReturnType<typeof describeCharacterPrimaryAction>['action'];
// Compact Persona Source Card for horizontal scrolling recommendation section.
// Layout: rank kicker + Public pill · aurora blob · glyph tile + name/role ·
// Origin meta row · footer (optional server count + source action). Every
// color uses fg-*/accent-*/border-* tokens, every font uses the three font
// tokens.
export function PersonaSourceCard({
  source,
  onPrimaryAction,
  onOpen,
}: {
  source: ExplorePersonaSourceCardData;
  onPrimaryAction?: () => Promise<void> | void;
  onOpen?: () => void;
}) {
  const i18n = useDesktopI18nResource().instance;
  const palette = getSemanticSourcePalette({
    archetype: source.archetype,
    description: source.bio || source.role || source.archetype || null,
    worldName: source.worldName,
    tags: source.tags,
  });
  const roleText = source.role
    || source.bio
    || source.archetype
    || source.cadence
    || source.tags[0]
    || i18n.t('Explore.defaultRole', { defaultValue: 'Companion' });
  const ownershipText = source.ownership === 'worldOwned'
    ? i18n.t('Explore.worldOwnedSource', { defaultValue: 'World-owned' })
    : i18n.t('Explore.userOwnedSource', { defaultValue: 'User-owned' });
  const worldText = `${source.worldName} · ${ownershipText}`;
  const postsCount = typeof source.postsCount === 'number' ? source.postsCount : null;
  const isPublic = source.visibility === 'public';
  const glyph = source.name ? source.name.trim().charAt(0).toUpperCase() : '·';
  const sourceState: CharacterSourceState = source.sourceState ?? 'source_materialization_unavailable';
  const primaryAction = describeCharacterPrimaryAction(sourceState, i18n.t);
  const handlePrimaryActionClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void onPrimaryAction?.();
  };
  const pillLabel = primaryAction.label;
  return (
    <AppCardSurface
      kind="promoted-glass"
      className="group relative flex h-full w-full min-w-0 cursor-pointer flex-col gap-3.5 overflow-hidden p-4 transition-all duration-200"
      style={{ background: palette.background }}
      data-testid={E2E_IDS.explorePersonaSourceCard(source.id)}
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
      {/* Aurora wash tied to source palette */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-[120px] w-[120px] rounded-full"
        style={{ background: palette.ring, opacity: 0.14, filter: 'blur(32px)' }}
      />
      {/* Glyph tile + name + role + public pill */}
      <div className="relative flex items-start gap-3">
        {source.avatarUrl ? (
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
              imageUrl={source.avatarUrl}
              name={source.name}
              kind="source"
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
              {source.name}
            </span>
            {isPublic && (
              <span
                aria-label={i18n.t('SourceDetail.publicBadge', { defaultValue: 'Public' })}
                title={i18n.t('SourceDetail.publicBadge', { defaultValue: 'Public' })}
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
      {/* World and ownership meta row */}
      <div className="relative flex items-baseline justify-between gap-2">
        <span
          style={{
            fontFamily: 'var(--nimi-font-mono)',
            fontSize: 11,
            color: 'var(--nimi-fg-3)',
            letterSpacing: '0.04em',
          }}
        >
          {i18n.t('Explore.worldLabel', { defaultValue: 'World' })}
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
          {worldText}
        </span>
      </div>
      {/* Footer: real server count when present + source action */}
      <div
        className="relative mt-auto flex items-center justify-between border-t pt-3"
        style={{ borderColor: 'var(--nimi-border-subtle)' }}
      >
        {postsCount !== null ? (
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
        ) : null}
        <button
          type="button"
          onClick={handlePrimaryActionClick}
          disabled={primaryAction.disabled}
          data-testid={E2E_IDS.explorePersonaSourcePrimaryAction(source.id)}
          data-source-state={sourceState}
          data-primary-action={primaryAction.action}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors disabled:cursor-default"
          style={{
            fontFamily: 'var(--nimi-font-sans)',
            fontSize: 11,
            fontWeight: 600,
            ...sourcePillStyle(sourceState),
          }}
          title={pillLabel}
          aria-label={pillLabel}
        >
          <PrimaryActionIcon action={primaryAction.action} />
          {pillLabel}
        </button>
      </div>
    </AppCardSurface>
  );
}
