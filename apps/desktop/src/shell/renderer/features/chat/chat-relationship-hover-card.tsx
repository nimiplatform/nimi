import { type KeyboardEvent } from 'react';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { type ProfileDetailSeed } from '@renderer/features/relationship/profile-detail-modal.js';
import {
  readCharacterSourceRefV3,
  type CharacterSourceRefV3,
} from '@renderer/features/realm-source/realm-source-identity.js';

export type RelationshipHoverCardPosition = {
  top: number;
  right: number;
};

export function clampHoverCardTop(top: number): number {
  const minTop = 78;
  const maxTop = Math.max(minTop, window.innerHeight - 78);
  return Math.min(Math.max(top, minTop), maxTop);
}

function getSourceLabel(source: ConversationTargetSummary['source'], t: TFunction): string {
  switch (source) {
    case 'ai':
      return t('Chat.hoverCardAi', { defaultValue: 'AI' });
    case 'agent':
      return t('Chat.hoverCardLocalAgent', { defaultValue: 'localAgent' });
    case 'group':
      return t('Chat.hoverCardGroup', { defaultValue: 'Group' });
    case 'human':
    default:
      return t('Chat.hoverCardHuman', { defaultValue: 'Human' });
  }
}

function getIdentityLabel(target: ConversationTargetSummary, sourceLabel: string): string {
  if (target.handle) {
    return target.handle.replace(/^@+/, '');
  }
  if (target.source === 'ai') {
    return 'nimi';
  }
  const fallbackId = String(target.canonicalSessionId || target.id || '').trim();
  if (fallbackId) {
    return fallbackId;
  }
  return sourceLabel;
}

function getProfileOpenLabel(source: ConversationTargetSummary['source'], title: string, t: TFunction): string {
  const action = source === 'agent'
    ? t('Chat.composerAvatarOpenSource', { defaultValue: 'Open persona profile' })
    : t('Chat.composerAvatarOpenContact', { defaultValue: 'Open profile' });
  return `${action}: ${title}`;
}

function getMetadataText(target: ConversationTargetSummary, key: string): string {
  const value = target.metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function getMetadataValue(target: ConversationTargetSummary, key: string): unknown {
  return target.metadata?.[key];
}

function resolveProfileTargetId(target: ConversationTargetSummary): string {
  if (target.source === 'human') {
    return getMetadataText(target, 'otherUserId') || target.id;
  }
  return resolveProfileSourceRef(target)?.id ?? '';
}

function resolveProfileSourceRef(target: ConversationTargetSummary): CharacterSourceRefV3 | null {
  if (target.source !== 'agent') {
    return null;
  }
  return readCharacterSourceRefV3(getMetadataValue(target, 'sourceRef'));
}

export function buildRelationshipProfileSeed(target: ConversationTargetSummary): { profileId: string; seed: ProfileDetailSeed } | null {
  if (target.source !== 'human' && target.source !== 'agent') {
    return null;
  }
  const sourceRef = resolveProfileSourceRef(target);
  if (target.source === 'agent' && !sourceRef) {
    return null;
  }
  const profileId = resolveProfileTargetId(target).trim();
  if (!profileId) {
    return null;
  }
  const ownershipType = getMetadataText(target, 'ownershipType');
  const runtimeSourceRef = target.source === 'agent'
    ? getMetadataText(target, 'runtimeSourceRef')
    : '';
  return {
    profileId,
    seed: {
      id: profileId,
      displayName: target.title,
      handle: target.handle?.replace(/^@/, '').trim() || '',
      avatarUrl: target.avatarUrl || null,
      bio: target.bio || null,
      isSource: target.source === 'agent',
      isOnline: target.isOnline ?? undefined,
      worldName: getMetadataText(target, 'worldName') || null,
      sourceWorldId: sourceRef?.worldId ?? null,
      sourceKind: sourceRef?.kind,
      sourceId: sourceRef?.id,
      sourceHash: sourceRef?.sourceHash,
      runtimeSourceRef: runtimeSourceRef || undefined,
      ...(sourceRef ? { sourceRef } : {}),
      sourceOwnershipType: ownershipType || null,
    },
  };
}

function LocalAgentGlyphIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5l1.45 4.05L17.5 9l-4.05 1.45L12 14.5l-1.45-4.05L6.5 9l4.05-1.45L12 3.5z" />
      <path d="M18.5 13.5l.75 2.25 2.25.75-2.25.75-.75 2.25-.75-2.25-2.25-.75 2.25-.75.75-2.25z" />
    </svg>
  );
}

export function RelationshipHoverCard({
  target,
  selected,
  pos,
  onMouseEnter,
  onMouseLeave,
  onSelect,
  onOpenProfile,
}: {
  target: ConversationTargetSummary;
  selected: boolean;
  pos: RelationshipHoverCardPosition;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onSelect: () => void;
  onOpenProfile?: () => void;
}) {
  const { t } = useTranslation();
  const sourceLabel = getSourceLabel(target.source, t);
  const identity = getIdentityLabel(target, sourceLabel);
  const preview = target.previewText || target.bio || t('Chat.hoverCardNoPreview', { defaultValue: 'No recent message' });
  const isSource = target.source === 'agent';
  const sourcePillLabel = t('Chat.hoverCardLocalAgent', { defaultValue: 'localAgent' });

  const avatarVisual = isSource ? (
    <EntityAvatar
      imageUrl={target.avatarUrl || null}
      name={target.avatarFallback || target.title || '?'}
      kind="source"
      sizeClassName="h-[74px] w-[74px]"
      textClassName="text-xl font-semibold"
    />
  ) : (
    <EntityAvatar
      imageUrl={target.avatarUrl || null}
      name={target.avatarFallback || target.title || '?'}
      kind="human"
      sizeClassName="h-[74px] w-[74px]"
      textClassName="text-xl font-semibold"
    />
  );

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      data-chat-contact-hover-card="true"
      role="button"
      tabIndex={0}
      aria-label={`${t('Chat.hoverCardOpenChat', { defaultValue: 'Open chat' })}: ${target.title}`}
      className="nimi-material-glass-chrome group fixed z-[9999] w-[min(430px,calc(100vw-96px))] overflow-hidden rounded-[22px] border border-white/75 bg-white/82 px-5 py-4 text-left shadow-[0_22px_70px_rgba(80,95,130,0.2)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] transition duration-200 hover:border-white hover:bg-white/88 hover:shadow-[0_24px_76px_rgba(80,95,130,0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/80"
      style={{ top: pos.top, right: pos.right, transform: 'translateY(-50%)' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onSelect}
      onKeyDown={handleCardKeyDown}
    >
      <span
        aria-hidden="true"
        className={`absolute right-1.5 top-1/2 w-1 rounded-full bg-emerald-500 shadow-[0_0_16px_rgba(16,185,129,0.36)] transition-all duration-200 ${
          selected ? 'h-[92px] -translate-y-1/2 opacity-100' : 'h-0 -translate-y-1/2 opacity-0'
        }`}
      />
      <div className="flex min-w-0 items-center gap-4">
        {onOpenProfile ? (
          <button
            type="button"
            aria-label={getProfileOpenLabel(target.source, target.title, t)}
            onClick={(event) => {
              event.stopPropagation();
              onOpenProfile();
            }}
            className="shrink-0 rounded-[12px] transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/80"
          >
            {avatarVisual}
          </button>
        ) : (
          <div className="shrink-0">
            {avatarVisual}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 truncate text-[16px] font-semibold leading-6 tracking-normal text-slate-950">
              {target.title}
            </h3>
            {isSource ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-violet-700"
                aria-label={sourcePillLabel}
                title={sourcePillLabel}
              >
                <LocalAgentGlyphIcon className="h-3 w-3" />
                {sourcePillLabel}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-[12px] font-normal leading-4 text-slate-500">
            {identity}
          </div>
          <div className="mt-3 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-slate-500">
            <span className="shrink-0 font-medium text-slate-600">
              {t('Chat.hoverCardLast', { defaultValue: 'Last:' })}
            </span>
            <span className="min-w-0 flex-1 truncate">{preview}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
