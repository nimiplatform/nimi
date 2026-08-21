import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { OverlayShell, ScrollArea } from '@nimiplatform/kit/ui';
import { joinParts } from './world-detail-primitives.js';
import type { WorldCharacter } from './world-detail-types.js';

export function WorldCharacterQuickSheet({
  character,
  onClose,
  onViewCharacter,
  onMaterializeSource,
}: {
  character: WorldCharacter;
  onClose: () => void;
  onViewCharacter?: (character: WorldCharacter) => void;
  onMaterializeSource?: (character: WorldCharacter) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const relationState = character.relation?.state ?? 'connectable';
  const connectDisabled = relationState !== 'connectable';
  const connectLabel = relationState === 'connected'
    ? t('WorldDetail.xianxia.v2.characters.sourceMaterialized')
    : relationState === 'unavailable'
      ? t('WorldDetail.xianxia.v2.characters.sourceUnavailable')
      : t('WorldDetail.xianxia.v2.characters.materializeSource');
  const profileCoverUrl = character.profileCoverUrl ?? character.mediaAssets?.profileCover?.url ?? null;
  const referenceImageUrl = character.referenceImageUrl ?? character.mediaAssets?.referenceImage?.url ?? null;
  const voiceSample = character.mediaAssets?.voiceSample ?? null;
  const voiceSampleUrl = character.voiceSampleUrl ?? voiceSample?.url ?? null;
  const voiceDuration = typeof voiceSample?.durationSec === 'number' && Number.isFinite(voiceSample.durationSec)
    ? Math.round(voiceSample.durationSec)
    : null;
  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={onClose}
      panelStyle={{ maxWidth: 620, maxHeight: 'calc(100vh - 3rem)' }}
      panelClassName="flex flex-col overflow-hidden"
      contentClassName="flex min-h-0 flex-1 flex-col px-0 py-0"
      title={(
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-[var(--nimi-text-muted)]">
              {t('WorldDetail.xianxia.v2.characters.quickSheetTitle')}
            </div>
            <h3 className="mt-2 text-2xl font-semibold text-[var(--nimi-text-primary)]">{character.name}</h3>
            <div className="mt-1 text-sm text-[var(--nimi-action-primary-bg)]">{character.handle}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-1.5 text-xs text-[var(--nimi-text-secondary)] transition-colors hover:border-[var(--nimi-action-primary-bg)] hover:text-[var(--nimi-text-primary)]"
          >
            {t('WorldDetail.xianxia.v2.characters.quickSheetClose')}
          </button>
        </div>
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--nimi-action-primary-bg)]/50 to-transparent" />
      <ScrollArea className="min-h-0 flex-1" contentClassName="px-6 pb-6 pt-3">
            {profileCoverUrl ? (
              <div data-testid="world-character-profile-cover" className="mb-5 overflow-hidden rounded-[20px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]">
                <img
                  src={profileCoverUrl}
                  alt=""
                  className="h-40 w-full object-cover"
                />
              </div>
            ) : null}

            <div className="grid gap-5 md:grid-cols-[120px_minmax(0,1fr)]">
              <div className="flex justify-center md:justify-start">
                <EntityAvatar
                  imageUrl={character.avatarUrl}
                  name={character.name}
                  kind="source"
                  sizeClassName="h-28 w-28"
                  radiusClassName="rounded-[20px]"
                  innerRadiusClassName="rounded-[16px]"
                  textClassName="text-3xl"
                />
              </div>

              <div className="grid gap-3">
                {joinParts([character.role, character.faction, character.rank]) ? (
                  <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                      {t('WorldDetail.xianxia.v2.characters.quickSheetIdentity')}
                    </div>
                    <div className="mt-2 text-sm leading-relaxed text-[var(--nimi-text-primary)]">
                      {joinParts([character.role, character.faction, character.rank])}
                    </div>
                  </div>
                ) : null}

                {joinParts([character.sceneName, character.location]) ? (
                  <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                      {t('WorldDetail.xianxia.v2.characters.quickSheetLocation')}
                    </div>
                    <div className="mt-2 text-sm leading-relaxed text-[var(--nimi-text-primary)]">
                      {joinParts([character.sceneName, character.location])}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                    {t('WorldDetail.xianxia.v2.characters.quickSheetBio')}
                  </div>
                  <div className="mt-2 text-sm leading-relaxed text-[var(--nimi-text-secondary)]">
                    {character.bio || t('WorldDetail.noDescription')}
                  </div>
                </div>

                {character.stats?.vitalityScore != null ? (
                  <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-3 text-sm text-[var(--nimi-text-secondary)]">
                    {t('WorldDetail.xianxia.v2.characters.vitality')} {character.stats.vitalityScore}
                  </div>
                ) : null}

                {referenceImageUrl ? (
                  <div data-testid="world-character-reference-image" className="overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]">
                    <img
                      src={referenceImageUrl}
                      alt=""
                      className="max-h-72 w-full object-cover"
                    />
                  </div>
                ) : null}

                {voiceSampleUrl ? (
                  <div data-testid="world-character-voice-sample" className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                      {t('WorldDetail.xianxia.v2.characters.voiceSample', { defaultValue: 'Voice sample' })}
                    </div>
                    <div className="mt-2 text-xs text-[var(--nimi-text-secondary)]">
                      {voiceSample?.mimeType ?? t('WorldDetail.xianxia.v2.characters.voiceReady', { defaultValue: 'Ready audio resource' })}
                      {voiceDuration ? ` · ${voiceDuration}s` : ''}
                    </div>
                    <audio
                      data-testid="world-character-voice-sample-audio"
                      className="mt-3 w-full"
                      controls
                      preload="metadata"
                      src={voiceSampleUrl}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            {onViewCharacter ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {onMaterializeSource ? (
                  <button
                    type="button"
                    onClick={() => void onMaterializeSource(character)}
                    disabled={connectDisabled}
                    className="rounded-full border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_26%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)] px-4 py-2 text-sm font-semibold text-[var(--nimi-action-primary-bg)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] disabled:cursor-default disabled:opacity-55"
                  >
                    {connectLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onViewCharacter(character)}
                  className="rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-2 text-sm text-[var(--nimi-text-secondary)] transition-colors hover:border-[var(--nimi-action-primary-bg)] hover:text-[var(--nimi-text-primary)]"
                >
                  {t('WorldDetail.xianxia.v2.characters.quickSheetViewProfile')}
                </button>
              </div>
            ) : null}
          </ScrollArea>
    </OverlayShell>
  );
}
