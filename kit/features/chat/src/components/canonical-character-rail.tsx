import type { RefObject } from 'react';
import { Avatar, cn } from '@nimiplatform/kit/ui';
import {
  AvatarStage,
  createAvatarStageSnapshot,
} from '@nimiplatform/kit/features/avatar';
import type { ConversationCharacterData, ConversationTargetSummary } from '../types.js';
import { DEFAULT_CHAT_COPY, resolveChatCopy, type ChatCopy } from '../copy.js';

/** Default bio fallback copy; the resolved value comes from `DEFAULT_CHAT_COPY`. */
export const CANONICAL_NO_BIO_FALLBACK = DEFAULT_CHAT_COPY.characterRailNoBioFallback;

export const CANONICAL_HEADER_ICON_CLASS = cn(
  'inline-flex h-10 w-10 items-center justify-center rounded-full',
  'border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,transparent)] text-[var(--nimi-text-secondary)]',
  'shadow-[var(--nimi-elevation-base)] transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)]',
  'hover:border-[var(--nimi-action-primary-bg)]/50 hover:text-[var(--nimi-action-primary-bg)] active:scale-[var(--nimi-motion-pressed-scale)]',
);

export type CanonicalCharacterRailProps = {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  avatarAnchorRef?: RefObject<HTMLButtonElement | null>;
  onBackToTargets: () => void;
  onOpenProfile?: () => void;
  /** When true, the back button is hidden (e.g. when navigation is handled by an external sidebar). */
  hideBackButton?: boolean;
  /** Optional copy overrides merged over the default English strings. */
  copy?: ChatCopy;
};

function resolvePresenceState(
  characterData: ConversationCharacterData | null | undefined,
  target: ConversationTargetSummary,
  copy: Required<ChatCopy>,
): { label: string; busy: boolean } {
  const interactionState = characterData?.interactionState;
  const explicitLabel = String(interactionState?.label || characterData?.presenceLabel || '').trim();
  const phase = interactionState?.phase || null;
  if (explicitLabel) {
    return {
      label: explicitLabel,
      busy: Boolean(interactionState?.busy ?? characterData?.presenceBusy),
    };
  }
  if (phase === 'loading') {
    return { label: copy.characterRailPresenceMovingCloserLabel, busy: false };
  }
  if (phase === 'speaking') {
    return { label: copy.characterRailPresenceSpeakingLabel, busy: true };
  }
  if (phase === 'painting') {
    return { label: copy.characterRailPresencePaintingLabel, busy: true };
  }
  if (phase === 'filming') {
    return { label: copy.characterRailPresenceFilmingLabel, busy: true };
  }
  if (phase === 'thinking') {
    return { label: copy.characterRailPresenceThinkingLabel, busy: true };
  }
  if (phase === 'listening') {
    return { label: copy.characterRailPresenceListeningLabel, busy: false };
  }
  return {
    label: target.isOnline === false ? copy.characterRailPresenceOfflineLabel : copy.characterRailPresenceOnlineLabel,
    busy: Boolean(interactionState?.busy ?? characterData?.presenceBusy),
  };
}

function relationshipBadgeClass(value: ConversationCharacterData['relationshipState']): string {
  if (value === 'friendly') {
    return 'border-[var(--nimi-status-info-soft-border)] bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]';
  }
  if (value === 'warm') {
    return 'border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]';
  }
  if (value === 'intimate') {
    return 'border-[var(--nimi-status-danger-soft-border)] bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger-soft-text)]';
  }
  return 'border-[var(--nimi-status-neutral-soft-border)] bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]';
}

function relationshipStateLabel(
  value: ConversationCharacterData['relationshipState'],
  copy: Required<ChatCopy>,
): string {
  if (value === 'friendly') {
    return copy.characterRailRelationshipFriendlyLabel;
  }
  if (value === 'warm') {
    return copy.characterRailRelationshipWarmLabel;
  }
  if (value === 'intimate') {
    return copy.characterRailRelationshipIntimateLabel;
  }
  return copy.characterRailRelationshipNewLabel;
}

export function CanonicalCharacterRail(props: CanonicalCharacterRailProps) {
  const copy = resolveChatCopy(props.copy);
  const theme = props.characterData?.theme;
  const supportingCopy = String(props.characterData?.bio || props.selectedTarget.bio || '').trim() || copy.characterRailNoBioFallback;
  const presenceState = resolvePresenceState(props.characterData, props.selectedTarget, copy);
  const presenceTextColor = theme?.text || 'var(--nimi-text-primary)';
  const presenceBorder = theme?.border || 'color-mix(in srgb, var(--nimi-status-success) 28%, transparent)';
  const presenceBackground = 'color-mix(in srgb, var(--nimi-surface-card) 86%, transparent)';
  const presenceDot = theme?.accentStrong || 'var(--nimi-status-success)';
  const relationshipState = props.characterData?.relationshipState || 'new';
  const avatarPresentationProfile = props.characterData?.avatarPresentationProfile || null;
  const avatarImageUrl = props.characterData?.avatarUrl || null;
  const avatarFallbackLabel = props.characterData?.avatarFallback || props.selectedTarget.avatarFallback || props.selectedTarget.title;
  const avatarSnapshot = avatarPresentationProfile
    ? createAvatarStageSnapshot(avatarPresentationProfile, {
      phase: props.characterData?.interactionState?.phase === 'loading'
        ? 'transitioning'
        : props.characterData?.interactionState?.phase === 'thinking'
          ? 'thinking'
          : props.characterData?.interactionState?.phase === 'listening'
            ? 'listening'
            : props.characterData?.interactionState?.phase === 'speaking'
              ? 'speaking'
              : 'idle',
      emotion: props.characterData?.interactionState?.emotion || undefined,
      actionCue: presenceState.label,
      amplitude: typeof props.characterData?.interactionState?.amplitude === 'number'
        ? props.characterData.interactionState.amplitude
        : props.characterData?.interactionState?.busy
          ? 0.42
          : 0.08,
      visemeId: props.characterData?.interactionState?.visemeId || undefined,
    })
    : null;

  return (
    <aside
      className="relative flex min-h-0 w-[clamp(360px,30vw,600px)] shrink-0 flex-col overflow-hidden border-r border-[var(--nimi-border-subtle)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--nimi-surface-panel)_98%,transparent),color-mix(in_srgb,var(--nimi-surface-panel)_96%,transparent))]"
      data-canonical-character-rail="true"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-64px] top-[-52px] h-48 w-48 rounded-full bg-[radial-gradient(circle,var(--nimi-status-success-soft-bg)_0%,transparent_70%)]" />
        <div className="absolute bottom-16 right-[-56px] h-56 w-56 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)_0%,transparent_70%)]" />
      </div>
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        {props.hideBackButton ? null : (
          <div className="shrink-0 border-b border-[var(--nimi-border-subtle)] px-6 py-3" data-canonical-rail-header="true">
            <button
              type="button"
              onClick={props.onBackToTargets}
              className={CANONICAL_HEADER_ICON_CLASS}
              aria-label={copy.characterRailBackLabel}
              title={copy.characterRailBackLabel}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
          <div className="flex min-h-0 flex-1 items-center justify-center pb-8">
            <button
              type="button"
              ref={(node) => {
                if (props.avatarAnchorRef) {
                  props.avatarAnchorRef.current = node;
                }
              }}
              onClick={props.onOpenProfile}
              className="group relative rounded-full outline-none transition-transform duration-[var(--nimi-motion-slow)] hover:scale-[1.02] focus-visible:ring-4 focus-visible:ring-[var(--nimi-focus-ring-color)]"
              aria-label={copy.characterRailOpenProfileLabel}
              title={copy.characterRailOpenProfileLabel}
              data-canonical-rail-avatar-anchor="true"
            >
              <span
                className="absolute inset-[-28px] rounded-full opacity-75"
                style={{ background: `radial-gradient(circle, ${theme?.accentSoft || 'color-mix(in srgb, var(--nimi-status-success) 35%, transparent)'}, transparent 70%)` }}
              />
              <span
                className="absolute inset-[-12px] rounded-full border border-[var(--nimi-border-subtle)]"
                style={{ boxShadow: `0 22px 56px ${theme?.accentSoft || 'color-mix(in srgb, var(--nimi-status-success) 18%, transparent)'}` }}
              />
              {avatarSnapshot ? (
                <AvatarStage
                  snapshot={avatarSnapshot}
                  label={props.characterData?.name || props.selectedTarget.title}
                  imageUrl={avatarImageUrl}
                  fallbackLabel={avatarFallbackLabel}
                  statusLabel={presenceState.label}
                  size="lg"
                  className="relative"
                />
              ) : (
                <span
                  className="relative inline-flex items-center justify-center"
                  data-avatar-presentation-state="unavailable"
                  data-avatar-static-portrait={avatarImageUrl || undefined}
                >
                  <Avatar
                    src={avatarImageUrl}
                    alt={props.characterData?.name || props.selectedTarget.title}
                    size="lg"
                    fallback={avatarFallbackLabel.trim().charAt(0).toUpperCase() || '?'}
                    className="h-44 w-44 border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_86%,transparent)] text-2xl shadow-[var(--nimi-elevation-floating)]"
                    fallbackClassName="text-2xl font-semibold text-[var(--nimi-text-muted)]"
                  />
                  <span
                    className="absolute bottom-[-10px] left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,transparent)] px-3.5 py-2 text-xs font-semibold text-[var(--nimi-text-secondary)] shadow-[var(--nimi-elevation-raised)]"
                    data-avatar-presentation-status="unavailable"
                  >
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-current opacity-70" />
                    <span>{copy.characterRailAvatarUnavailableLabel}</span>
                  </span>
                </span>
              )}
            </button>
          </div>
          <div className="shrink-0 space-y-4 pb-4 text-center">
            <div className="space-y-2">
              <p className="text-[length:var(--nimi-type-hero-title-size)] font-black leading-none tracking-tight text-[var(--nimi-text-primary)]">
                {props.characterData?.name || props.selectedTarget.title}
              </p>
              {props.characterData?.handle || props.selectedTarget.handle ? (
                <p className="text-sm font-medium text-[var(--nimi-text-muted)]">
                  {props.characterData?.handle || props.selectedTarget.handle}
                </p>
              ) : null}
              <p className="line-clamp-3 min-h-[72px] text-sm leading-6 text-[var(--nimi-text-muted)]">
                {supportingCopy}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span
                data-canonical-presence-badge="true"
                className="inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-semibold shadow-[var(--nimi-elevation-raised)]"
                style={{
                  borderColor: presenceBorder,
                  background: presenceBackground,
                  color: presenceTextColor,
                }}
              >
                <span
                  className={cn('inline-block h-2.5 w-2.5 rounded-full', presenceState.busy ? 'animate-pulse' : '')}
                  style={{ background: props.selectedTarget.isOnline === false ? 'var(--nimi-status-neutral)' : presenceDot }}
                />
                <span>{presenceState.label}</span>
              </span>
              <span
                data-canonical-relationship-badge="true"
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-[var(--nimi-elevation-raised)] ${relationshipBadgeClass(relationshipState)}`}
              >
                <span className="inline-block h-2 w-2 rounded-full bg-current opacity-70" />
                <span>{relationshipStateLabel(relationshipState, copy)}</span>
              </span>
              {props.characterData?.badges?.map((badge) => (
                <span
                  key={`${badge.label}-${badge.variant}`}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--nimi-status-neutral-soft-border)] bg-[var(--nimi-status-neutral-soft-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--nimi-status-neutral-soft-text)] shadow-[var(--nimi-elevation-raised)]"
                >
                  <span className={cn('inline-block h-2 w-2 rounded-full bg-current opacity-70', badge.pulse ? 'animate-pulse' : '')} />
                  <span>{badge.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
