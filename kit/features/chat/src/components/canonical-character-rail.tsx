import type { RefObject } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import type { ConversationCharacterData, ConversationTargetSummary } from '../types.js';
export const CANONICAL_NO_BIO_FALLBACK = 'This Agent has no public bio.';

export const CANONICAL_HEADER_ICON_CLASS = cn(
  'inline-flex h-10 w-10 items-center justify-center rounded-full',
  'border border-slate-200/80 bg-white/90 text-slate-700',
  'shadow-[0_2px_8px_rgba(15,23,42,0.05)] transition-all duration-150',
  'hover:-translate-y-px hover:border-emerald-300 hover:text-teal-700',
);

export type CanonicalCharacterRailProps = {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  avatarAnchorRef?: RefObject<HTMLButtonElement | null>;
  onBackToTargets: () => void;
  onOpenProfile?: () => void;
  /** When true, the back button is hidden (e.g. when navigation is handled by an external sidebar). */
  hideBackButton?: boolean;
};

function resolvePresenceState(characterData: ConversationCharacterData | null | undefined, target: ConversationTargetSummary): { label: string; busy: boolean } {
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
    return { label: 'Moving closer...', busy: false };
  }
  if (phase === 'speaking') {
    return { label: 'Speaking...', busy: true };
  }
  if (phase === 'painting') {
    return { label: 'Drawing something...', busy: true };
  }
  if (phase === 'filming') {
    return { label: 'Cutting together a scene...', busy: true };
  }
  if (phase === 'thinking') {
    return { label: 'Thinking...', busy: true };
  }
  if (phase === 'listening') {
    return { label: 'Listening to you...', busy: false };
  }
  return {
    label: target.isOnline === false ? 'Offline' : 'Quietly here with you',
    busy: Boolean(interactionState?.busy ?? characterData?.presenceBusy),
  };
}

function relationshipBadgeClass(value: ConversationCharacterData['relationshipState']): string {
  if (value === 'friendly') {
    return 'border-sky-200 bg-sky-50 text-sky-700';
  }
  if (value === 'warm') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (value === 'intimate') {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function relationshipStateLabel(value: ConversationCharacterData['relationshipState']): string {
  if (value === 'friendly') {
    return 'Friendly';
  }
  if (value === 'warm') {
    return 'Warm';
  }
  if (value === 'intimate') {
    return 'Intimate';
  }
  return 'New';
}

export function CanonicalCharacterRail(props: CanonicalCharacterRailProps) {
  const theme = props.characterData?.theme;
  const supportingCopy = String(props.characterData?.bio || props.selectedTarget.bio || '').trim() || CANONICAL_NO_BIO_FALLBACK;
  const presenceState = resolvePresenceState(props.characterData, props.selectedTarget);
  const presenceTextColor = theme?.text || '#1f2937';
  const presenceBorder = theme?.border || 'rgba(16, 185, 129, 0.28)';
  const presenceBackground = 'rgba(255,255,255,0.86)';
  const presenceDot = theme?.accentStrong || '#34d399';
  const relationshipState = props.characterData?.relationshipState || 'new';

  return (
    <aside
      className="relative flex min-h-0 w-[clamp(360px,30vw,600px)] shrink-0 flex-col overflow-hidden border-r border-white/70 bg-[linear-gradient(180deg,rgba(250,252,252,0.98),rgba(244,247,248,0.96))]"
      data-canonical-character-rail="true"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-64px] top-[-52px] h-48 w-48 rounded-full bg-mint-100/70 blur-3xl" />
        <div className="absolute bottom-16 right-[-56px] h-56 w-56 rounded-full bg-sky-100/70 blur-3xl" />
      </div>
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        {props.hideBackButton ? null : (
          <div className="shrink-0 border-b border-white/70 px-6 py-3" data-canonical-rail-header="true">
            <button
              type="button"
              onClick={props.onBackToTargets}
              className={CANONICAL_HEADER_ICON_CLASS}
              aria-label="Back to character space"
              title="Back to character space"
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
              className="group relative rounded-full outline-none transition-transform duration-300 hover:scale-[1.02] focus-visible:ring-4 focus-visible:ring-white/85"
              aria-label="Open profile"
              title="Open profile"
              data-canonical-rail-avatar-anchor="true"
            >
              <span
                className="absolute inset-[-28px] rounded-full opacity-75 blur-3xl"
                style={{ background: theme?.accentSoft || 'rgba(167, 243, 208, 0.55)' }}
              />
              <span
                className="absolute inset-[-12px] rounded-full border border-white/75"
                style={{ boxShadow: `0 22px 56px ${theme?.accentSoft || 'rgba(16,185,129,0.18)'}` }}
              />
              <span className="relative flex h-44 w-44 items-center justify-center overflow-hidden rounded-full border border-white/90 bg-white/82 shadow-[0_24px_60px_rgba(15,23,42,0.12)]">
                {props.characterData?.avatarUrl ? (
                  <img src={props.characterData.avatarUrl} alt={props.characterData.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-6xl font-black text-slate-900">
                    {props.characterData?.avatarFallback || props.selectedTarget.avatarFallback || props.selectedTarget.title.charAt(0) || '?'}
                  </span>
                )}
              </span>
            </button>
          </div>
          <div className="shrink-0 space-y-4 pb-4 text-center">
            <div className="space-y-2">
              <p className="text-[34px] font-black leading-none tracking-tight text-slate-950">
                {props.characterData?.name || props.selectedTarget.title}
              </p>
              {props.characterData?.handle || props.selectedTarget.handle ? (
                <p className="text-sm font-medium text-slate-500">
                  {props.characterData?.handle || props.selectedTarget.handle}
                </p>
              ) : null}
              <p className="line-clamp-3 min-h-[72px] text-sm leading-6 text-slate-500">
                {supportingCopy}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span
                data-canonical-presence-badge="true"
                className="inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-semibold shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
                style={{
                  borderColor: presenceBorder,
                  background: presenceBackground,
                  color: presenceTextColor,
                }}
              >
                <span
                  className={cn('inline-block h-2.5 w-2.5 rounded-full', presenceState.busy ? 'animate-pulse' : '')}
                  style={{ background: props.selectedTarget.isOnline === false ? '#cbd5e1' : presenceDot }}
                />
                <span>{presenceState.label}</span>
              </span>
              <span
                data-canonical-relationship-badge="true"
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-[0_10px_24px_rgba(15,23,42,0.05)] ${relationshipBadgeClass(relationshipState)}`}
              >
                <span className="inline-block h-2 w-2 rounded-full bg-current opacity-70" />
                <span>{relationshipStateLabel(relationshipState)}</span>
              </span>
              {props.characterData?.badges?.map((badge) => (
                <span
                  key={`${badge.label}-${badge.variant}`}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
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
